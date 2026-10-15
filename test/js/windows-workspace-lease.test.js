'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const {lease}=require('../../src/lib/workspace'),{readView}=require('../../src/lib/views'),{childEnv}=require('../helpers/child-env');
const native={skip:process.platform!=='win32'?'native Windows retained temporary lease and kernel last-handle cleanup':false};
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function retained(root){if(process.env.SLIDES_KEEP_TESTS==='1')console.log('Retained workspace lease fixture: '+JSON.stringify(root));else fs.rmSync(root,{recursive:true,force:true});}
test('actual workspace lease keeps readable schema, exclusive admission and idempotent normal release',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'slides-lease-runtime-')),state=path.join(root,'.slides-state'),file=path.join(state,'server.lock');let release;
 try{
  release=lease(state);const bytes=fs.readFileSync(file),value=JSON.parse(bytes),before=hash(file);
  assert.equal(value.pid,process.pid);assert.equal(value.entry,'slides-server');assert.equal(typeof value.started,'string');assert.equal(fs.statSync(file).nlink,1);
  const view=await readView({workspace:root,view:'tasks'});assert.equal(view.grantsAuthority,false);assert.equal(view.view,'tasks');assert.equal(hash(file),before);
  assert.throws(()=>lease(state),/already leased/);assert.equal(hash(file),before);
  release();release();assert.throws(()=>fs.lstatSync(file),{code:'ENOENT'});
  release=lease(state);assert.equal(JSON.parse(fs.readFileSync(file)).pid,process.pid);release();release=null;assert.throws(()=>fs.lstatSync(file),{code:'ENOENT'});
  fs.writeFileSync(file,'legacy-stale-lock',{flag:'wx'});assert.throws(()=>lease(state),/already leased/);assert.equal(fs.readFileSync(file,'utf8'),'legacy-stale-lock');
 }finally{if(release)release();retained(root);}
});
test('native actual lease disappears after its exact created owner is killed and admits a new owner',native,async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'slides-lease-kernel-')),file=path.join(root,'.slides-state/server.lock');let release;
 const child=spawn(process.execPath,[path.resolve(__dirname,'../fixtures/lease-owner.cjs'),root],{env:childEnv(),stdio:['pipe','pipe','pipe']});
 const closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
 let output='',stderr='';child.stdout.on('data',b=>{output+=b;if(output.length>2048)child.kill('SIGKILL');});child.stderr.on('data',b=>{stderr=(stderr+b).slice(-4096);});
 try{
  const until=Date.now()+10000;while(!output.includes('\n')&&child.exitCode===null&&child.signalCode===null&&Date.now()<until)await new Promise(r=>setTimeout(r,10));
  assert(output.includes('\n'),stderr||'Exact created owner did not become ready');const ready=JSON.parse(output.trim());assert.equal(ready.ready,true);assert.equal(ready.pid,child.pid);assert.equal(JSON.parse(fs.readFileSync(file)).pid,child.pid);
  const reader=fs.openSync(file,'r');try{assert.equal(JSON.parse(fs.readFileSync(reader)).pid,child.pid);}finally{fs.closeSync(reader);}
  assert.equal(child.kill('SIGKILL'),true);let timer;try{await Promise.race([closed,new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(new Error('Exact created owner did not close')),10000);})]);}finally{clearTimeout(timer);}
  assert.throws(()=>fs.lstatSync(file),{code:'ENOENT'},'Kernel retirement left the actual runtime lease');
  release=lease(path.dirname(file));assert.equal(JSON.parse(fs.readFileSync(file)).pid,process.pid);release();release=null;assert.throws(()=>fs.lstatSync(file),{code:'ENOENT'});
 }finally{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await closed;}if(release)release();retained(root);}
});
