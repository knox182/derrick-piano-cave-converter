export function createResourceGate(){let occupied=false;const queue=[];
 function drain(){if(occupied)return;while(queue.length){const next=queue.shift();next.signal?.removeEventListener('abort',next.abort);if(next.signal?.aborted){next.reject(Error('Job cancelled.'));continue}occupied=true;let released=false;next.resolve(()=>{if(released)return;released=true;occupied=false;drain()});break}}
 function acquire(signal){return new Promise((resolve,reject)=>{if(signal?.aborted)return reject(Error('Job cancelled.'));const item={resolve,reject,signal};item.abort=()=>{const i=queue.indexOf(item);if(i>=0){queue.splice(i,1);reject(Error('Job cancelled.'))}};signal?.addEventListener('abort',item.abort,{once:true});queue.push(item);drain()})}
 return {acquire,async run(task,signal){const release=await acquire(signal);try{return await task()}finally{release()}}};
}
