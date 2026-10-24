export function redact(value){
 return String(value??'').split(/\r?\n/).map(line=>/authorization\s*[:=]|(?:cookie|token|signature|password|secret)\s*[:=]/i.test(line)?'[redacted credential-bearing line]':line.replace(/https?:\/\/[^\s<>"']+/gi,'[redacted URL]').replace(/Bearer\s+\S+/gi,'Bearer [redacted]')).join('\n').slice(0,8000);
}
export class ConversionError extends Error{
 constructor(code,stage,message,details={}){super(message);this.name='ConversionError';this.code=code;this.stage=stage;this.diagnostic=redact(details.diagnostic||'');this.httpStatus=details.httpStatus||null;this.exitCode=details.exitCode??null}
}
export function youtubeError(stderr,stage='metadata',exitCode=null){
 const t=String(stderr),httpStatus=Number(t.match(/(?:HTTP (?:Error|error)|status(?: code)?)[\s:]+(403|429)/i)?.[1])||null;let code='MEDIA_RETRIEVAL_FAILED',message='YouTube media retrieval failed. No MP3 was created.';
 if(/sign in to confirm|not a bot|captcha|authentication challenge/i.test(t)){code='AUTH_CHALLENGE';message='YouTube requires an authentication or bot-verification challenge from this server. No MP3 was created.'}
 else if(/private video|members.only|premium|login required|age.restricted|confirm your age/i.test(t)){code='AUTHORIZATION_REQUIRED';message='This recording requires authorization or age verification. Supply an authorized file instead.'}
 else if(httpStatus===429||/too many requests/i.test(t)){code='HTTP_429';message='YouTube is rate-limiting this server (HTTP 429). Try again later.'}
 else if(httpStatus===403||/forbidden/i.test(t)){code='HTTP_403';message='YouTube denied access (HTTP 403). No MP3 was created.'}
 else if(/video unavailable|(?:video|content).*not available|removed|copyright|not exist/i.test(t)){code='VIDEO_UNAVAILABLE';message='This YouTube recording is unavailable.'}
 else if(/signature|nsig|n challenge|challenge sol|javascript runtime|PO Token|player.*extract/i.test(t)){code='PLAYER_EXTRACTION_FAILED';message='YouTube player or playback-token extraction failed. No MP3 was created.'}
 else if(/requested format.*not available|no (?:video |audio )?formats|only images/i.test(t)){code='NO_AUDIO_FORMAT';message='No usable audio stream was found for this video.'}
 else if(/timed? out|timeout/i.test(t)){code='CONVERSION_TIMEOUT';message='YouTube retrieval timed out. No MP3 was created.'}
 return new ConversionError(code,stage,message,{diagnostic:t,httpStatus,exitCode});
}
export function logFailure(error,context={},logger=console.error){
 const record={event:'conversion_failed',...context,code:error.code||'INTERNAL_ERROR',stage:error.stage||context.stage||'internal',httpStatus:error.httpStatus||null,exitCode:error.exitCode??null,exception:redact(error.message),diagnostic:redact(error.diagnostic),stack:redact(error.stack)};logger(JSON.stringify(record));return record;
}
