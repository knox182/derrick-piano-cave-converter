import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';

export const validVideoId=id=>/^[A-Za-z0-9_-]{11}$/.test(String(id||''));
export function youtubeFailure(stderr){
 if(/sign in|not a bot|captcha|429|403|po token|confirm your age/i.test(stderr))return 'YouTube blocked this server or requires sign-in. This server cannot convert that video. Upload an authorized recording instead; no MP3 was created.';
 if(/private video|not available|unavailable|removed|copyright|members.only|premium/i.test(stderr))return 'This YouTube recording is unavailable to this server. Upload an authorized copy instead.';
 if(/match filter|maximum.*size|larger than|max.filesize/i.test(stderr))return 'This video exceeds the 30-minute or 50 MB conversion limit, or is a live stream.';
 return 'YouTube audio retrieval failed. Retry once, or upload an authorized recording. No MP3 was created.';
}
export async function downloadYoutube({id,target,signal,maxBytes=50*1024*1024,maxDuration=1800,onBytes=()=>{},binary='yt-dlp'}){
 if(!validVideoId(id))throw Error('Choose a valid YouTube video first.');
 const args=['--ignore-config','--no-plugin-dirs','--no-cache-dir','--no-playlist','--no-progress','--no-warnings','--js-runtimes','node','--socket-timeout','15','--retries','1','--fragment-retries','1','--no-part','--no-continue','--no-mtime','--max-filesize',String(maxBytes),'--match-filter','!is_live & duration <= '+maxDuration,'-f','bestaudio[protocol=https]/bestaudio','-o',target,'--','https://www.youtube.com/watch?v='+id];
 await new Promise((resolve,reject)=>{
  let stderr='',done=false,limitError;const child=spawn(binary,args,{shell:false,windowsHide:true,stdio:['ignore','ignore','pipe']});
  const finish=error=>{if(done)return;done=true;clearTimeout(timer);clearInterval(watch);signal?.removeEventListener('abort',abort);error?reject(error):resolve()};
  const abort=()=>{child.kill('SIGKILL');finish(Error('Conversion cancelled.'))};
  const timer=setTimeout(()=>{child.kill('SIGKILL');finish(Error('YouTube retrieval timed out. Upload an authorized recording instead.'))},120000);
  const watch=setInterval(async()=>{try{const stat=await fs.stat(target);onBytes(stat.size);if(stat.size>maxBytes){limitError=Error('The source exceeds the 50 MB limit.');child.kill('SIGKILL')}}catch{}},500);
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-16000)});
  child.on('error',()=>finish(Error('The YouTube downloader is unavailable on the conversion server.')));
  child.on('close',code=>finish(limitError||(code===0?null:Error(youtubeFailure(stderr)))));
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 });
 const stat=await fs.stat(target).catch(()=>null);if(!stat?.size||stat.size>maxBytes)throw Error('No usable YouTube audio was retrieved within the conversion limits.');return stat.size;
}
