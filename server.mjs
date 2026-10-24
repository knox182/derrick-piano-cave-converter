import http from 'node:http';
import {downloadYoutube,validVideoId} from './youtube.mjs';
import https from 'node:https';
import dns from 'node:dns/promises';
import net from 'node:net';
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID,createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const FORMATS='mp3,wav,flac,ogg,mov,matroska,webm,aac,avi,aiff,asf,mpeg,mpegts,amr,ac3,eac3';
const QUALITY=new Set([128,192,256,320]),ID=/^[a-f0-9-]{36}$/;
const equal=(a,b)=>timingSafeEqual(createHash('sha256').update(String(a||'')).digest(),createHash('sha256').update(String(b||'')).digest());
export const safeFilename=title=>(String(title||'Song').normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim().replace(/[. ]+$/,'').slice(0,100)||'Song')+'.mp3';
export function publicAddress(address){
 if(net.isIP(address)===4){const [a,b]=address.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51)||a===203&&b===0||a===192&&b===2)}
 if(net.isIP(address)===6){const a=address.toLowerCase();return /^[23]/.test(a)&&!a.startsWith('2001:db8:')&&!a.startsWith('2001:0:')&&!a.startsWith('2002:')}
 return false;
}
export async function validateSource(value,allowedHosts,lookup=dns.lookup){
 let url;try{url=new URL(value)}catch{throw Error('Enter a valid direct HTTPS media URL.')}
 if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443'||url.hash)throw Error('Only direct HTTPS media URLs without credentials or fragments are accepted.');
 if(!allowedHosts.has(url.hostname.toLowerCase()))throw Error('This media host is not authorized by the site owner. Upload your file instead.');
 const addresses=net.isIP(url.hostname)?[{address:url.hostname,family:net.isIP(url.hostname)}]:await lookup(url.hostname,{all:true});
 if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw Error('Private, local and reserved network addresses are not allowed.');
 return {url,addresses:addresses.sort((a,b)=>a.family-b.family)};
}
async function downloadSource(value,target,hosts,maxBytes,signal,onBytes){
 for(let redirects=0;redirects<=3;redirects++){
  const {url,addresses}=await validateSource(value,hosts);let response,lastError;for(const address of addresses.slice(0,4)){try{response=await new Promise((resolve,reject)=>{const request=https.get(url,{signal,autoSelectFamily:false,family:address.family,lookup:(_name,options,callback)=>options.all?callback(null,[address]):callback(null,address.address,address.family),timeout:15000,headers:{'User-Agent':'DerrickPianoCave-AuthorizedMedia/1.0','Accept':'audio/*,video/*,application/octet-stream'}},resolve);request.on('timeout',()=>request.destroy(Error('Media source timed out.')));request.on('error',reject)});break}catch(error){lastError=error;if(signal.aborted)throw error}}if(!response)throw lastError;
  if([301,302,303,307,308].includes(response.statusCode)){response.resume();if(!response.headers.location||redirects===3)throw Error('Too many source redirects.');value=new URL(response.headers.location,url).href;continue}
  if(response.statusCode!==200){response.resume();throw Error('The authorized media source is unavailable. Upload the file instead.')}
  if(!/^(audio\/|video\/|application\/octet-stream)/i.test(response.headers['content-type']||'')){response.destroy();throw Error('This URL is a webpage or unsupported media response, not an audio/video file.')}
  if(Number(response.headers['content-length']||0)>maxBytes){response.destroy();throw Error('The source exceeds the upload size limit.')}
  const file=await fs.open(target,'wx');let bytes=0;try{for await(const chunk of response){bytes+=chunk.length;if(bytes>maxBytes)throw Error('The source exceeds the upload size limit.');await file.write(chunk);onBytes?.(bytes)}}finally{response.destroy();await file.close()}
  if(!bytes)throw Error('The source was empty.');return bytes;
 }
}
function run(binary,args,{signal,onProgress,maxOutput=2e6,timeout=60000}={}){
 return new Promise((resolve,reject)=>{const child=spawn(binary,args,{shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']}),timer=setTimeout(()=>child.kill(),timeout);timer.unref?.();let stdout='',stderr='',settled=false;
  const abort=()=>child.kill();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  child.stdout.on('data',data=>{stdout+=data;if(stdout.length>maxOutput){child.kill();return}onProgress?.(data.toString())});child.stderr.on('data',data=>{if(stderr.length<8192)stderr+=data});
  const finish=(error)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(error)reject(error);else resolve(stdout)};
  child.on('error',()=>finish(Error('FFmpeg or FFprobe is not installed on the conversion server.')));child.on('close',code=>finish(code===0&&!signal?.aborted?null:Error(signal?.aborted?'Conversion cancelled.':'Media processing failed. The source may be unsupported, damaged, protected, or contain no usable audio.')));
 });
}
async function probe(binary,file,signal){const info=JSON.parse(await run(binary,['-v','error','-protocol_whitelist','file,pipe','-format_whitelist',FORMATS,'-show_format','-show_streams','-of','json',file],{signal}));const audio=info.streams?.find(s=>s.codec_type==='audio');const duration=Number(info.format?.duration||audio?.duration);if(!audio||!Number.isFinite(duration)||duration<=0)throw Error('No valid audio track or duration was found.');return {duration,codec:audio.codec_name,channels:audio.channels}}
const reply=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data))};
async function bodyJSON(req,limit=16384){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>limit)throw Error('Request metadata is too large.');chunks.push(chunk)}try{return JSON.parse(Buffer.concat(chunks).toString())}catch{throw Error('Invalid conversion request JSON.')}}

export async function createConversionServer(options={}){
 const token=options.token||process.env.CONVERSION_SERVICE_TOKEN;if(!token||token.length<24)throw Error('Set a private CONVERSION_SERVICE_TOKEN of at least 24 characters.');
 const root=path.resolve(options.root||process.env.CONVERSION_DATA_DIR||'conversion-data'),ffmpeg=options.ffmpeg||process.env.FFMPEG_PATH||'ffmpeg',ffprobe=options.ffprobe||process.env.FFPROBE_PATH||'ffprobe';
 const hosts=new Set(options.allowedHosts||String(process.env.MEDIA_ALLOWED_HOSTS||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean)),providers=options.providers||JSON.parse(process.env.AUTHORIZED_MEDIA_CATALOG||'{}');
 const youtubeEnabled=options.youtubeEnabled??process.env.YOUTUBE_DOWNLOAD_ENABLED==='true',youtubeBinary=options.youtubeBinary||process.env.YTDLP_PATH||'yt-dlp';
 const maxBytes=options.maxBytes||50*1024*1024,maxDuration=options.maxDuration||1800,ttl=options.ttlMs||3600000,maxPending=options.maxPending||8,jobs=new Map(),queue=[];let active=0;
 if(youtubeEnabled)await run(youtubeBinary,['--version']);
 await fs.mkdir(root,{recursive:true});await Promise.all([run(ffmpeg,['-version']),run(ffprobe,['-version'])]);
 const jobDir=id=>{if(!ID.test(id))throw Error('Invalid conversion ID.');const result=path.resolve(root,id);if(!result.startsWith(root+path.sep))throw Error('Invalid job path.');return result};
 const persist=job=>fs.writeFile(path.join(jobDir(job.id),'job.json'),JSON.stringify({...job,abort:undefined}));
 const ticket=(job,expires)=>createHmac('sha256',token).update(job.id+'|'+job.owner+'|'+expires).digest('hex');
 const present=job=>{const expires=Math.min(job.expires,Date.now()+600000);return {id:job.id,media:job.media,state:job.state,phase:job.phase,progress:job.progress,bitrate:job.bitrate,bytesReceived:job.bytesReceived||0,duration:job.duration||null,outputBytes:job.outputBytes||0,error:job.error||'',expiresAt:job.expires,engine:'FFmpeg',...(job.state==='completed'?{downloadUrl:'/api/conversions/'+job.id+'/download?expires='+expires+'&ticket='+ticket(job,expires),filename:safeFilename(job.media.title)}:{})}};
 const cleanup=async()=>{for(const job of jobs.values())if(Date.now()>job.expires){job.abort?.abort();jobs.delete(job.id);await fs.rm(jobDir(job.id),{recursive:true,force:true})}};
 for(const name of await fs.readdir(root)){if(!ID.test(name))continue;try{const job=JSON.parse(await fs.readFile(path.join(jobDir(name),'job.json'),'utf8'));if(job.id!==name||!/^[a-f0-9]{64}$/.test(job.owner))continue;if(!['completed','failed','cancelled'].includes(job.state)){job.state='failed';job.error='The conversion server restarted. Retry with your source file.'}jobs.set(name,job)}catch{await fs.rm(jobDir(name),{recursive:true,force:true})}}
 await cleanup();const cleanupTimer=setInterval(()=>cleanup().catch(()=>{}),60000);cleanupTimer.unref?.();
 async function processJob(job){
  try{job.abort=new AbortController();job.state='processing';const dir=jobDir(job.id),input=path.join(dir,'input.media'),output=path.join(dir,'output.mp3');
   if(job.youtubeId){job.phase='Retrieving YouTube audio';await persist(job);job.bytesReceived=await downloadYoutube({id:job.youtubeId,target:input,signal:job.abort.signal,maxBytes,maxDuration,binary:youtubeBinary,onBytes:bytes=>job.bytesReceived=bytes})}
   else if(job.sourceUrl){job.phase='Retrieving authorized media';await persist(job);job.bytesReceived=await downloadSource(job.sourceUrl,input,hosts,maxBytes,job.abort.signal,bytes=>job.bytesReceived=bytes)}
   if(job.abort.signal.aborted)throw Error('Conversion cancelled.');job.phase='Inspecting audio';const original=await probe(ffprobe,input,job.abort.signal);if(original.duration>maxDuration)throw Error('The recording exceeds the 30-minute conversion limit.');job.duration=original.duration;job.phase='Converting to MP3';await persist(job);let progressBuffer='';
   await run(ffmpeg,['-nostdin','-hide_banner','-v','error','-protocol_whitelist','file,pipe','-format_whitelist',FORMATS,'-i',input,'-map','0:a:0','-vn','-c:a','libmp3lame','-b:a',job.bitrate+'k','-ar','44100','-ac','2','-threads','1','-progress','pipe:1','-nostats',output],{signal:job.abort.signal,timeout:900000,maxOutput:2e6,onProgress:chunk=>{progressBuffer+=chunk;const lines=progressBuffer.split(/\r?\n/);progressBuffer=lines.pop();for(const line of lines){const match=line.match(/^out_time_(?:us|ms)=(\d+)$/);if(match)job.progress=Math.min(99,Math.floor(Number(match[1])/1e6/original.duration*100))}}});
   job.phase='Verifying MP3';const result=await probe(ffprobe,output,job.abort.signal),stat=await fs.stat(output);if(result.codec!=='mp3'||stat.size<128||stat.size>100*1024*1024||Math.abs(result.duration-original.duration)>Math.max(1,original.duration*.02))throw Error('The converted MP3 failed duration or format verification.');
   job.outputBytes=stat.size;job.duration=result.duration;job.progress=100;job.state='completed';job.phase='Conversion complete';await fs.rm(input,{force:true});job.sourceUrl=undefined;await persist(job);
  }catch(error){job.state=job.abort?.signal.aborted?'cancelled':'failed';job.phase=job.state==='cancelled'?'Cancelled':'Conversion failed';job.error=error.message;job.sourceUrl=undefined;await fs.rm(path.join(jobDir(job.id),'input.media'),{force:true}).catch(()=>{});await fs.rm(path.join(jobDir(job.id),'output.mp3'),{force:true}).catch(()=>{});await persist(job).catch(()=>{})}finally{active--;pump()}
 }
 function pump(){while(active<1&&queue.length){const job=queue.shift();if(job.state!=='queued')continue;active++;processJob(job)}}
 const server=http.createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://service');if(url.pathname==='/health'&&req.method==='GET')return reply(res,200,{ready:true,engine:'FFmpeg',youtubeEnabled,maxBytes,maxDuration,qualities:[...QUALITY]});
  if(!equal(req.headers.authorization,'Bearer '+token))return reply(res,401,{error:'Service authorization required.'});const owner=req.headers['x-conversion-visitor'];if(!/^[a-f0-9]{64}$/.test(owner||''))return reply(res,401,{error:'Visitor authorization required.'});
  if(url.pathname==='/api/conversions/eligibility'&&req.method==='GET'){const videoId=url.searchParams.get('videoId');if(!validVideoId(videoId))return reply(res,400,{error:'Choose a valid YouTube video.'});const source=providers[videoId];if(!source&&youtubeEnabled)return reply(res,200,{eligible:true,source:'youtube',reason:'Direct YouTube retrieval is enabled. Availability is checked when conversion starts; only convert recordings you own or have permission to download.'});if(!source)return reply(res,200,{eligible:false,reason:'No authorized downloadable source is configured for this video. Attach your own file or permitted direct source.'});try{await validateSource(source,hosts);return reply(res,200,{eligible:true,reason:'An owner-configured authorized source is available.'})}catch{return reply(res,200,{eligible:false,reason:'The owner’s provider source requires valid permitted-host configuration.'})}}
  if(url.pathname==='/api/conversions'&&req.method==='POST'){
   const pending=[...jobs.values()].filter(j=>!['completed','failed','cancelled'].includes(j.state));if(jobs.size>=32||pending.length>=maxPending||pending.filter(j=>j.owner===owner).length>=2)return reply(res,429,{error:'Conversion capacity is busy. Wait for the current job to finish.'});if(Number(req.headers['content-length']||0)>maxBytes)return reply(res,413,{error:'The upload exceeds the 50 MB limit.'});
   const upload=!!req.headers['x-conversion-metadata'];let data;if(upload){try{data=JSON.parse(decodeURIComponent(req.headers['x-conversion-metadata']))}catch{throw Error('Invalid upload metadata.')}}else data=await bodyJSON(req);
   if(!QUALITY.has(Number(data.bitrate)))throw Error('Choose 128, 192, 256 or 320 kbps.');if(data.authorized!==true)throw Error('Confirm you are authorized to process this media.');const media={id:String(data.media?.id||'').slice(0,100),url:String(data.media?.url||'').slice(0,2048),title:String(data.media?.title||'Song').slice(0,300),thumbnail:String(data.media?.thumbnail||'').slice(0,2048)};
   let sourceUrl,youtubeId;if(!upload){sourceUrl=data.source?.type==='provider'?providers[media.id]:data.source?.type==='direct'?data.source.url:null;if(!sourceUrl&&data.source?.type==='provider'&&youtubeEnabled){if(!validVideoId(media.id))throw Error('Choose a valid YouTube video.');youtubeId=media.id}if(!sourceUrl&&!youtubeId)return reply(res,422,{error:'This video has no configured authorized downloadable source. Attach your own audio/video file or an authorized direct media URL.'});if(sourceUrl)await validateSource(sourceUrl,hosts)}
   const id=randomUUID(),job={id,owner,media,bitrate:Number(data.bitrate),sourceUrl,youtubeId,state:'receiving',phase:upload?'Receiving upload':'Preparing conversion',progress:0,created:Date.now(),expires:Date.now()+ttl};jobs.set(id,job);await fs.mkdir(jobDir(id));
   try{if(upload){const file=await fs.open(path.join(jobDir(id),'input.media'),'wx');let size=0;try{for await(const chunk of req){size+=chunk.length;if(size>maxBytes)throw Error('The upload exceeds the 50 MB limit.');await file.write(chunk)}}finally{await file.close()}if(!size)throw Error('The uploaded file is empty.');job.bytesReceived=size}job.state='queued';job.phase='Queued for FFmpeg';await persist(job);queue.push(job);pump();return reply(res,202,present(job))}catch(error){jobs.delete(id);await fs.rm(jobDir(id),{recursive:true,force:true});throw error}
  }
  const match=url.pathname.match(/^\/api\/conversions\/([a-f0-9-]{36})(\/download)?$/);if(!match)return reply(res,404,{error:'Not found.'});const job=jobs.get(match[1]);if(!job||job.owner!==owner)return reply(res,404,{error:'Conversion not found in this session.'});if(Date.now()>job.expires){await cleanup();return reply(res,410,{error:'This conversion expired. Convert the source again.'})}
  if(req.method==='GET'&&match[2]){const expires=Number(url.searchParams.get('expires'));if(job.state!=='completed'||!Number.isFinite(expires)||expires<Date.now()||expires>job.expires||!equal(url.searchParams.get('ticket'),ticket(job,expires)))return reply(res,403,{error:'Download unavailable or expired. Refresh the job to obtain a new download link.'});const output=path.join(jobDir(job.id),'output.mp3'),stat=await fs.stat(output);res.writeHead(200,{'Content-Type':'audio/mpeg','Content-Length':stat.size,'Content-Disposition':"attachment; filename=\"song.mp3\"; filename*=UTF-8''"+encodeURIComponent(safeFilename(job.media.title)),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});const stream=createReadStream(output);stream.on('error',()=>res.destroy());stream.pipe(res);return}
  if(req.method==='GET')return reply(res,200,present(job));if(req.method==='DELETE'){const running=job.state==='processing';job.abort?.abort();job.state='cancelled';job.phase='Cancelled';job.error='';await persist(job);if(!running){await fs.rm(path.join(jobDir(job.id),'input.media'),{force:true});await fs.rm(path.join(jobDir(job.id),'output.mp3'),{force:true})}return reply(res,200,present(job))}return reply(res,405,{error:'Method not allowed.'});
 }catch(error){if(!res.headersSent)reply(res,400,{error:error.message||'Conversion request failed.'});else res.destroy()}});
 server.requestTimeout=120000;server.headersTimeout=15000;server.on('close',()=>{clearInterval(cleanupTimer);for(const job of jobs.values())job.abort?.abort()});
 return {server,jobs,cleanup,root};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const {server}=await createConversionServer();server.listen(Number(process.env.PORT||8080),'0.0.0.0',()=>console.log('FFmpeg conversion service ready.'))}
