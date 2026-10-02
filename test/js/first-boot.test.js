'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const net=require('node:net');
const {spawn}=require('node:child_process');
const {python}=require('../../src/lib/prerequisites');

function request(port,route,body){return new Promise((resolve,reject)=>{
 const r=http.request({host:'127.0.0.1',port,path:route,method:body?'POST':'GET',headers:{Connection:'close','Content-Type':'application/json'}},res=>{
  let text='';res.on('data',x=>text+=x);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(text)}));
 });r.on('error',reject);r.end(body?JSON.stringify(body):undefined);
});}

test('fresh workspace initializes quietly and rejects agent controls',async t=>{
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'slides-first-boot-'));
 const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));
 const port=probe.address().port;await new Promise(r=>probe.close(r));
 const child=spawn(process.execPath,[path.resolve(__dirname,'../..','src/server.js')],{
  env:{...process.env,SLIDES_WORKSPACE:workspace,SUITE_PORT:String(port),SUITE_PYTHON:python()},stdio:['ignore','pipe','pipe']
 });
 let stderr='';child.stderr.on('data',x=>stderr+=x);child.stdout.resume();
 const exited=new Promise(r=>child.once('exit',r));
 try{
  let ready=false;
  for(let i=0;i<100;i++){
   try{ready=(await request(port,'/api/health')).status===200;}catch{}
   if(ready||child.exitCode!==null)break;
   await new Promise(r=>setTimeout(r,50));
  }
  assert.ok(ready,stderr);
  await t.test('first boot has no missing-artifact error',()=>{
   assert.doesNotMatch(stderr,/presentation needs a boot render:.*ENOENT/);
   const model=JSON.parse(fs.readFileSync(path.join(workspace,'.slides-state','model.json')));
   assert.equal(model.slides.length,1);
  });
  await t.test('agent undo and redo are rejected with empty history',async()=>{
   for(const route of ['undo','redo'])assert.equal((await request(port,'/api/'+route,{editor:'mcp-regression'})).status,403,route);
  });
 }finally{
  child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),7000);
  await exited;clearTimeout(timer);fs.rmSync(workspace,{recursive:true,force:true});
 }
});
