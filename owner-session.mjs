import fs from 'node:fs/promises';
import {ConversionError} from './diagnostics.mjs';

// Session material is supplied only through the host's private secret-file UI.
// This module never reads a browser profile or accepts cookies from a visitor.
export function youtubeCookieJar(text){
 if(Buffer.byteLength(String(text))>256*1024)throw new ConversionError('OWNER_SESSION_INVALID','owner-auth','The private session file is too large.');
 const lines=String(text).replace(/^\uFEFF/,'').split(/\r?\n/),rows=[];
 if(!lines.some(line=>/^#(?: Netscape)? HTTP Cookie File/.test(line)))throw new ConversionError('OWNER_SESSION_INVALID','owner-auth','Supply a Netscape-format YouTube session file through private hosting settings.');
 for(const line of lines){if(!line||line.startsWith('#')&&!line.startsWith('#HttpOnly_'))continue;const parts=line.split('\t');if(parts.length!==7)continue;const domain=parts[0].replace(/^#HttpOnly_/,'').replace(/^\./,'').toLowerCase();if(domain!=='youtube.com'&&!domain.endsWith('.youtube.com'))continue;if(!/^\d+$/.test(parts[4])||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(line))continue;rows.push(line)}
 if(!rows.length)throw new ConversionError('OWNER_SESSION_INVALID','owner-auth','The private session file contains no YouTube-domain cookies.');
 return '# Netscape HTTP Cookie File\n'+rows.join('\n')+'\n';
}
export async function createJobSession(source,target){
 let text;try{text=await fs.readFile(source,'utf8')}catch{throw new ConversionError('OWNER_SESSION_MISSING','owner-auth','The owner must configure a private YouTube session file before this test.');}
 await fs.writeFile(target,youtubeCookieJar(text),{flag:'wx',mode:0o600});return target;
}
