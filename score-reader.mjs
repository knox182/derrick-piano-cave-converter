import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const ID=/^[a-f0-9-]{36}$/;
export function scoreFormat(bytes){
 if(bytes.subarray(0,5).toString()==='%PDF-')return 'pdf';
 if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'png';
 if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'jpg';
 if(['II*\0','MM\0*'].includes(bytes.subarray(0,4).toString('latin1')))return 'tif';
 if(bytes.subarray(0,2).toString()==='BM')return 'bmp';
 if(/^GIF8[79]a$/.test(bytes.subarray(0,6).toString()))return 'gif';
 throw Error('Use a PDF, PNG, JPEG, TIFF, BMP or GIF notation source.');
}
export async function runOpticalReader({binary,input,output,signal,timeout=900000}){
 await fs.mkdir(output,{recursive:true});
 await new Promise((resolve,reject)=>{
  const child=spawn(binary,['-batch','-transcribe','-export','-swap','-output',output,'--',input],{shell:false,windowsHide:true,signal,env:{...process.env,JAVA_TOOL_OPTIONS:process.env.JAVA_TOOL_OPTIONS||'-Xmx768m -Djava.awt.headless=true'}});let log='';
  const timer=setTimeout(()=>child.kill(),timeout);for(const stream of [child.stdout,child.stderr])stream?.on('data',chunk=>{log=(log+chunk).slice(-12000)});
  child.on('error',e=>{clearTimeout(timer);reject(e)});child.on('close',code=>{clearTimeout(timer);code===0?resolve():reject(Error(signal?.aborted?'Score reading cancelled.':'The optical reader could not complete this score.'))});
 });
 const files=[];async function walk(dir){for(const entry of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())await walk(file);else if(/\.(mxl|musicxml|xml)$/i.test(entry.name)&&entry.name!=='container.xml')files.push(file)}}await walk(output);
 const scores=files.filter(f=>/\.(mxl|musicxml)$/i.test(f));const selected=scores.length?scores:files;if(!selected.length)throw Error('No readable notation was found. The original source remains saved.');
 return Promise.all(selected.map(async file=>({name:path.basename(file),format:/\.mxl$/i.test(file)?'mxl':'musicxml',bytes:await fs.readFile(file)})));
}
export async function createScoreReader({root,binary=process.env.AUDIVERIS_PATH||'',runner=runOpticalReader,maxBytes=40*1024*1024,ttl=3600000}={}){
 root=path.resolve(root);await fs.mkdir(root,{recursive:true});const jobs=new Map(),queue=[];let active=false;
 const directory=id=>{if(!ID.test(id))throw Error('Invalid score job.');const dir=path.resolve(root,id);if(!dir.startsWith(root+path.sep))throw Error('Invalid score job path.');return dir};
 for(const entry of await fs.readdir(root,{withFileTypes:true})){if(!entry.isDirectory()||!ID.test(entry.name))continue;const dir=directory(entry.name),stat=await fs.stat(dir);if(Date.now()-stat.mtimeMs>ttl)await fs.rm(dir,{recursive:true,force:true})}
 const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data))};
 const present=j=>({id:j.id,state:j.state,phase:j.phase,error:j.error||'',engine:'Audiveris',reviewRequired:true,expiresAt:j.expires,...(j.state==='completed'?{scores:j.outputs.map((o,i)=>({name:o.name,index:i,format:o.format})),limitations:['Optical recognition can misread symbols. The website checks note ranges, timing and harmony; compare uncertain passages with the saved original.']}: {})});
 async function erase(j){j.controller?.abort();jobs.delete(j.id);await fs.rm(directory(j.id),{recursive:true,force:true})}
 async function pump(){if(active||!queue.length)return;const j=queue.shift();if(!jobs.has(j.id)){pump();return}active=true;j.state='processing';j.phase='Reading staves, clefs, key, meter, notes and rhythms';j.controller=new AbortController();try{j.outputs=await runner({binary,input:j.input,output:path.join(directory(j.id),'output'),signal:j.controller.signal});if(j.outputs.reduce((sum,o)=>sum+o.bytes.length,0)>40*1024*1024)throw Error('The recognized score is too large.');j.state='completed';j.phase='MusicXML ready for musical analysis';await fs.rm(j.input,{force:true})}catch(e){if(jobs.has(j.id)){j.state='failed';j.phase='Score reading did not complete';j.error=e.message;await fs.rm(j.input,{force:true})}}finally{active=false;pump()}}
 const timer=setInterval(()=>{for(const j of jobs.values())if(Date.now()>j.expires)erase(j).catch(()=>{})},60000);timer.unref?.();
 return {close(){clearInterval(timer);for(const j of jobs.values())j.controller?.abort()},async handle(req,res,owner,url){
  if(!url.pathname.startsWith('/api/conversions/scores'))return false;
  if(url.pathname==='/api/conversions/scores/config'){send(res,200,{configured:!!binary,engine:'Audiveris',selfHosted:true,maxBytes});return true}
  if(!binary){send(res,503,{error:'The self-hosted score reader has not been deployed yet. Your source remains saved.',code:'SCORE_READER_NOT_READY'});return true}
  if(url.pathname==='/api/conversions/scores'&&req.method==='POST'){
   if([...jobs.values()].filter(j=>['queued','processing','receiving'].includes(j.state)).length>=4||[...jobs.values()].filter(j=>j.owner===owner&&['queued','processing','receiving'].includes(j.state)).length>=2){send(res,429,{error:'The score reader is busy. Retry after the current score finishes.'});return true}
   if(Number(req.headers['content-length']||0)>maxBytes){send(res,413,{error:'Use a score smaller than 40 MB.'});return true}
   const j={id:randomUUID(),owner,state:'receiving',phase:'Receiving private score',expires:Date.now()+ttl};jobs.set(j.id,j);await fs.mkdir(directory(j.id));
   try{const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>maxBytes)throw Error('Use a score smaller than 40 MB.');chunks.push(chunk)}const bytes=Buffer.concat(chunks),format=scoreFormat(bytes);j.input=path.join(directory(j.id),'source.'+format);await fs.writeFile(j.input,bytes,{flag:'wx'});j.state='queued';j.phase='Queued for optical music recognition';queue.push(j);pump();send(res,202,present(j))}catch(e){await erase(j);send(res,400,{error:e.message})}return true;
  }
  const match=url.pathname.match(/^\/api\/conversions\/scores\/([a-f0-9-]{36})(?:\/result\/(\d+))?$/),j=match&&jobs.get(match[1]);if(!j||j.owner!==owner){send(res,404,{error:'This score job is not available in your session.'});return true}
  if(Date.now()>j.expires){await erase(j);send(res,410,{error:'This score job expired. Reopen your saved source to analyze it again.'});return true}
  if(req.method==='DELETE'){await erase(j);send(res,200,{state:'cancelled'});return true}
  if(req.method!=='GET'){send(res,405,{error:'Method not allowed.'});return true}
  if(match[2]!==undefined){const output=j.outputs?.[Number(match[2])];if(j.state!=='completed'||!output){send(res,404,{error:'Score output is not ready.'});return true}res.writeHead(200,{'Content-Type':output.format==='mxl'?'application/vnd.recordare.musicxml':'application/vnd.recordare.musicxml+xml','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});res.end(output.bytes);return true}
  send(res,200,present(j));return true;
 }};
}
