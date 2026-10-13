'use strict';
// Operator-facing error texts: one-line lease refusal, a single setup-runtime hint and a quiet thumbnail cancellation.
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const net=require('node:net');const {spawn}=require('node:child_process');
const {python,checkPython}=require('../../src/lib/prerequisites');
const ROOT=path.resolve(__dirname,'../..');
const POSIX=process.platform==='win32'?'POSIX process doubles':false;
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const n=s.address().port;await new Promise(r=>s.close(r));return n;}
function run(file,env,stdin='ignore'){return new Promise(resolve=>{const child=spawn(process.execPath,[file],{cwd:ROOT,env,stdio:[stdin,'pipe','pipe']});let out='',err='';child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>err+=c);child.once('close',code=>resolve({code,out,err}));});}
const LEASE=/^Workspace is already leased or its state is inaccessible\. Stop the other Slides server, or choose another SLIDES_WORKSPACE\. After a crash, verify the recorded PID is gone before removing \.slides-state\/server\.lock\.$/;

test('a refused workspace lease is one line from the server and from the MCP entry',{skip:POSIX},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'slides-lease-line-'));const workspace=path.join(root,'work');
 fs.mkdirSync(path.join(workspace,'.slides-state'),{recursive:true,mode:0o700});
 fs.writeFileSync(path.join(workspace,'.slides-state','server.lock'),JSON.stringify({pid:0,entry:'slides-server',started:'test'}),{mode:0o600});
 const env={...process.env,SLIDES_WORKSPACE:workspace,SUITE_PORT:String(await port()),SUITE_PYTHON:python()};
 try{
  const server=await run(path.join(ROOT,'src/server.js'),env);
  assert.equal(server.code,1,server.err);assert.match(server.err.trim(),LEASE);assert.equal(server.err.trim().split('\n').length,1,server.err);
  const entry=await run(path.join(ROOT,'slides-mcp.js'),env,'pipe');
  assert.equal(entry.code,1,entry.err);assert.match(entry.err.trim(),LEASE);assert.equal(entry.err.trim().split('\n').length,1,entry.err);
  assert.equal(entry.out,'','startup refusal must keep stdout clean for JSON-RPC');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('a prepared-runtime failure carries the setup-runtime hint exactly once',{skip:POSIX},()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'slides-hint-'));
 const saved={};for(const key of ['SLIDES_PLUGIN_MODE','SUITE_PYTHON','SLIDES_WORKSPACE'])saved[key]=process.env[key];
 const fake=(name,message)=>{const file=path.join(tmp,name);fs.writeFileSync(file,`#!/usr/bin/env node\nprocess.stderr.write(${JSON.stringify(message+'\n')});process.exit(1);\n`,{mode:0o755});return file;};
 process.env.SLIDES_PLUGIN_MODE='1';process.env.SLIDES_WORKSPACE=path.join(tmp,'ws');
 try{
  process.env.SUITE_PYTHON=fake('python-explained','Python runtime must be outside the plugin; use tools/setup-runtime.py for explicit offline setup');
  assert.throws(()=>checkPython(),{message:'Prepared runtime check failed: Python runtime must be outside the plugin; use tools/setup-runtime.py for explicit offline setup'});
  process.env.SUITE_PYTHON=fake('python-terse','Runtime does not match this release');
  assert.throws(()=>checkPython(),{message:'Prepared runtime check failed: Runtime does not match this release; use tools/setup-runtime.py'});
 }finally{for(const [key,value] of Object.entries(saved))value===undefined?delete process.env[key]:process.env[key]=value;fs.rmSync(tmp,{recursive:true,force:true});}
});

test('shutdown during the background thumbnail render logs a cancellation, not a renderer failure',{skip:POSIX},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'slides-thumbs-cancel-'));const workspace=path.join(root,'work');fs.mkdirSync(workspace);
 const soffice=path.join(root,'soffice');const marker=path.join(root,'converting');
 fs.writeFileSync(soffice,`#!/usr/bin/env node\nconst fs=require('node:fs');if(process.argv.includes('--version'))console.log('offline renderer double');else{process.stderr.write('Warning: failed to launch javaldx - java may not function correctly\\n');fs.writeFileSync(${JSON.stringify(marker)},String(process.pid));setInterval(()=>{},1000);}\n`,{mode:0o755});
 const env={...process.env,SLIDES_WORKSPACE:workspace,SUITE_PORT:String(await port()),SUITE_PYTHON:python(),SLIDES_RENDERER:'libreoffice',SLIDES_SOFFICE:soffice};
 const child=spawn(process.execPath,[path.join(ROOT,'src/server.js')],{cwd:ROOT,env,stdio:['ignore','pipe','pipe']});
 let err='';child.stderr.on('data',c=>err+=c);child.stdout.on('data',()=>{});
 const closed=new Promise(r=>child.once('close',r));
 try{
  const until=Date.now()+120000;while(Date.now()<until&&!fs.existsSync(marker)&&child.exitCode===null)await new Promise(r=>setTimeout(r,100));
  assert.ok(fs.existsSync(marker),'the boot thumbnail pass must reach the renderer double: '+err.slice(-2000));
  child.kill('SIGTERM');
  const code=await closed;
  assert.equal(code,0,err);
  assert.match(err,/thumbnail render cancelled at shutdown/,err);
  assert.doesNotMatch(err,/Renderer failed:/,err);
  assert.doesNotMatch(err,/thumbnail export failed:/,err);
 }finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await closed;fs.rmSync(root,{recursive:true,force:true});}
});
