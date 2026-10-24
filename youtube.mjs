import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import {ConversionError,youtubeError} from './diagnostics.mjs';
export const validVideoId=id=>/^[A-Za-z0-9_-]{11}$/.test(String(id||''));
export function validateYoutube(value){
 let url;try{url=new URL(value)}catch{throw new ConversionError('INVALID_YOUTUBE_URL','validation','Enter a valid YouTube video URL.')}
 if(url.protocol!=='https:'||url.username||url.password||url.port)throw new ConversionError('INVALID_YOUTUBE_URL','validation','Use a standard HTTPS YouTube video URL.');
 const host=url.hostname.toLowerCase(),id=host==='youtu.be'?url.pathname.slice(1):['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com'].includes(host)?url.pathname==='/watch'?url.searchParams.get('v'):url.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)$/)?.[1]:null;
 if(!validVideoId(id))throw new ConversionError('INVALID_YOUTUBE_URL','validation','Choose one YouTube video; playlists and other hosts are not supported.');return {id,url:'https://www.youtube.com/watch?v='+id};
}
const common=['--ignore-config','--no-plugin-dirs','--no-cache-dir','--no-playlist','--no-progress','--verbose','--js-runtimes','node','--socket-timeout','15','--retries','1','--fragment-retries','1'];
export async function youtubeProcess({binary='yt-dlp',args,stage,signal,target,maxBytes=50*1024*1024,onBytes=()=>{},timeout=120000,spawnProcess=spawn}){
 return new Promise((resolve,reject)=>{
  let stdout='',stderr='',done=false;const child=spawnProcess(binary,args,{shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
  const finish=error=>{if(done)return;done=true;clearTimeout(timer);clearInterval(watch);signal?.removeEventListener('abort',abort);error?reject(error):resolve(stdout)};
  const stop=error=>{child.kill('SIGKILL');finish(error)};
  const abort=()=>stop(new ConversionError('CANCELLED',stage,'Conversion cancelled.'));
  const timer=setTimeout(()=>stop(new ConversionError('CONVERSION_TIMEOUT',stage,'YouTube retrieval timed out. No MP3 was created.')),timeout);
  const watch=target?setInterval(async()=>{try{const stat=await fs.stat(target);onBytes(stat.size);if(stat.size>maxBytes)stop(new ConversionError('SOURCE_LIMIT',stage,'The source exceeds the 50 MB limit.'))}catch{}},500):null;
  child.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.length>16*1024*1024)stop(new ConversionError('METADATA_LIMIT',stage,'YouTube returned too much metadata.'))});
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-32000)});
  child.on('error',error=>finish(new ConversionError('DOWNLOADER_UNAVAILABLE',stage,'The YouTube downloader could not start.',{diagnostic:error.message})));
  child.on('close',code=>finish(code===0?null:youtubeError(stderr,stage,code)));
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 });
}
export function audioSummary(info,maxDuration=1800){
 if(info.is_live||!Number.isFinite(info.duration)||info.duration<=0||info.duration>maxDuration)throw new ConversionError('SOURCE_LIMIT','metadata','Choose a non-live recording under 30 minutes.');
 const formats=(info.formats||[]).filter(f=>f.acodec&&f.acodec!=='none'&&f.vcodec==='none'&&/^[\w.-]+$/.test(String(f.format_id))&&/^https?$|^m3u8_native$|^http_dash_segments$/.test(f.protocol||''));
 if(!formats.length)throw new ConversionError('NO_AUDIO_FORMAT','metadata','No usable audio-only stream was found.');
 formats.sort((a,b)=>(Number(b.abr)||0)-(Number(a.abr)||0));
 return {title:String(info.title||'YouTube Recording').slice(0,300),duration:info.duration,audioFormats:formats.map(f=>({formatId:String(f.format_id),ext:String(f.ext||''),codec:String(f.acodec),bitrate:Number(f.abr)||null})),selectedFormatId:String(formats[0].format_id)};
}
export async function extractStreamInfo({id,binary='yt-dlp',signal,maxDuration=1800,runner=youtubeProcess}){
 if(!validVideoId(id))throw new ConversionError('INVALID_YOUTUBE_URL','validation','Choose a valid YouTube video.');
 const output=await runner({binary,args:[...common,'--skip-download','--dump-single-json','--','https://www.youtube.com/watch?v='+id],stage:'metadata',signal});
 let info;try{info=JSON.parse(output)}catch{throw new ConversionError('METADATA_INVALID','metadata','YouTube did not return valid stream metadata.')}return audioSummary(info,maxDuration);
}
export async function downloadYoutube({id,target,signal,maxBytes=50*1024*1024,maxDuration=1800,onBytes=()=>{},onMetadata=()=>{},onStage=()=>{},binary='yt-dlp',runner=youtubeProcess}){
 onStage('Extracting YouTube stream metadata','metadata');const summary=await extractStreamInfo({id,binary,signal,maxDuration,runner});await onMetadata(summary);
 onStage('Downloading selected YouTube audio stream','download');
 await runner({binary,args:[...common,'--no-part','--no-continue','--no-mtime','--max-filesize',String(maxBytes),'--match-filter','!is_live & duration <= '+maxDuration,'-f',summary.selectedFormatId,'-o',target,'--','https://www.youtube.com/watch?v='+id],stage:'download',signal,target,maxBytes,onBytes});
 const stat=await fs.stat(target).catch(()=>null);if(!stat?.size||stat.size>maxBytes)throw new ConversionError('MEDIA_RETRIEVAL_FAILED','download','No usable audio file was retrieved within the conversion limits.');return stat.size;
}
