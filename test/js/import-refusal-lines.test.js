'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const net=require('node:net');const {spawn}=require('node:child_process');
const ROOT=path.resolve(__dirname,'../..');
const known='External links must be removed before import';
async function port(){const s=net.createServer();await new Promise((resolve,reject)=>{s.once('error',reject);s.listen(0,'127.0.0.1',resolve)});const p=s.address().port;await new Promise(r=>s.close(r));return p;}
for(const kind of ['lf','crlf','unknown-private'])test('actual Python import bridge handles '+kind+' stderr without widening public diagnostics',async()=>{
 const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'slides-refusal-lines-'));const program=path.join(scratch,'program'),workspace=path.join(scratch,'workspace');fs.mkdirSync(workspace);
 let child,exited;const pending=new Map();let seq=0,output='',stderr='';
 try{
  fs.cpSync(ROOT,program,{recursive:true,filter:p=>!['.git','.venv','node_modules','data','dist','__pycache__','.slides-workspace'].includes(path.basename(p))});
  const raw=kind==='unknown-private'?'Traceback: C:\\synthetic-private\\folder.py\nRuntimeError: private-example-7\n':'Traceback: synthetic fixture'+(kind==='lf'?'\n':'\r\n')+'ValueError: '+known+(kind==='lf'?'\n':'\r\n');
  // Only this fresh fixture program's Python entry is replaced. Node's real
  // callback, Python Job guardian, MCP dispatch and refusal policy are exercised.
  const helper='import base64,sys\nsys.stderr.buffer.write(base64.b64decode('+JSON.stringify(Buffer.from(raw).toString('base64'))+'))\nsys.stderr.buffer.flush()\nraise SystemExit(7)\n';
  fs.writeFileSync(path.join(program,'src/python/import-model.py'),helper);fs.writeFileSync(path.join(workspace,'input.pptx'),'typed inert bridge fixture');
  const env={...require(path.join(program,'test/helpers/child-env')).childEnv(),SLIDES_WORKSPACE:workspace,SUITE_PORT:String(await port())};delete env.DISPLAY;
  child=spawn(process.execPath,[path.join(program,'slides-mcp.js')],{env,cwd:program,stdio:['pipe','pipe','pipe'],windowsHide:true});
  exited=new Promise(resolve=>child.once('exit',(code,signal)=>{for(const p of pending.values())p.reject(Error('Owned MCP exit '+code+'/'+signal));resolve({code,signal})}));child.once('error',e=>{for(const p of pending.values())p.reject(e)});
  child.stderr.on('data',b=>{stderr=(stderr+b).slice(-32768)});child.stdout.setEncoding('utf8');child.stdout.on('data',b=>{output+=b;assert(output.length<1048576);for(let i;(i=output.indexOf('\n'))>=0;){const line=output.slice(0,i);output=output.slice(i+1);const m=JSON.parse(line),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}}});
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('Owned MCP15s '+method))},15000);pending.set(id,{resolve:r=>{clearTimeout(timer);resolve(r)},reject:e=>{clearTimeout(timer);reject(e)}});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n')});
  await call('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'inert-import-lines',version:'1'}});const lock=await call('tools/call',{name:'ppt_lock',arguments:{slide_ids:['s1']}});assert(!lock.isError);
  const result=await call('tools/call',{name:'ppt_import',arguments:{path:'input.pptx'}});assert.equal(result.isError,true);const text=JSON.stringify(result);
  if(kind==='unknown-private'){assert.match(text,/Import refused: invalid or unsupported PPTX content/);assert.doesNotMatch(text,/synthetic-private|private-example-7|Traceback|RuntimeError|folder\.py/);}
  else{assert.match(text,new RegExp(known));assert.doesNotMatch(stderr,/Import helper failed:/);}
  assert.doesNotMatch(text,/Traceback|\.slides-state|slides-refusal-lines-/);
  child.stdin.end();const end=await exited;assert.deepEqual(end,{code:0,signal:null});
 }finally{
  for(const p of pending.values())p.reject(Error('Test retiring'));pending.clear();
  if(child&&child.exitCode===null&&child.signalCode===null){child.kill();await Promise.race([exited,new Promise(r=>setTimeout(r,5000))]);}
  // Keep all fixtures in the release lane when SLIDES_KEEP_TESTS is requested.
  if(process.env.SLIDES_KEEP_TESTS==='1')console.log('Retained import-line fixture '+JSON.stringify(scratch));else fs.rmSync(scratch,{recursive:true,force:true});
 }
});
