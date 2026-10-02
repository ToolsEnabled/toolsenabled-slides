'use strict';
// Shared by render, import and font-lint jobs; bounded work and bounded waiting.
let active=0;const queue=[];
function run(work){return new Promise((resolve,reject)=>{
 if(queue.length>=16)return reject(new Error('Python job queue is full; retry after current work finishes'));
 queue.push({work,resolve,reject});drain();
});}
function drain(){while(active<2&&queue.length){const job=queue.shift();active++;Promise.resolve().then(job.work).then(job.resolve,job.reject).finally(()=>{active--;drain();});}}
module.exports={run};
