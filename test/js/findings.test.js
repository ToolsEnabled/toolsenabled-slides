'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn,spawnSync}=require('node:child_process');
const {childEnv}=require('../helpers/child-env');
const root=path.resolve(__dirname,'../..');
test('fresh install creates private state and starts with a neutral deck',async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'slides-fresh-'));
 const suite=path.join(tmp,'suite');
 fs.cpSync(root,suite,{recursive:true,filter:p=>!['.git','data','.venv'].includes(path.basename(p))});
 const proc=spawn(process.execPath,['src/server.js'],{cwd:suite,env:childEnv({SUITE_PORT:'47983'}),stdio:['ignore','pipe','pipe']});
 let logs='';proc.stdout.on('data',c=>logs+=c);proc.stderr.on('data',c=>logs+=c);
 try{
  const deadline=Date.now()+5000;let healthy=false;
  while(Date.now()<deadline && proc.exitCode===null){try{healthy=(await fetch('http://127.0.0.1:47983/api/health')).ok;if(healthy)break;}catch{}await new Promise(r=>setTimeout(r,50));}
  assert.ok(healthy,logs);
  assert.ok(fs.existsSync(path.join(suite,'data','element-history.json')));
  if(process.platform!=='win32')assert.equal(fs.statSync(path.join(suite,'data')).mode&0o777,0o700);
 }finally{proc.kill('SIGKILL');await new Promise(r=>proc.exitCode!==null?r():proc.once('exit',r));fs.rmSync(tmp,{recursive:true,force:true});}
});
test('missing python-pptx explains the exact isolated install command',()=>{
 const r=spawnSync(process.execPath,['src/cli/doctor.js'],{cwd:root,env:childEnv({SUITE_PYTHON:'not-a-python-executable'}),encoding:'utf8'});
 assert.equal(r.status,1);assert.match(r.stdout+r.stderr,/python3 -m venv .venv/);assert.match(r.stdout+r.stderr,/pip install --require-hashes -r requirements.txt/);
});
test('Linux PDF and all-page PNG exports use a detected LibreOffice renderer',()=>{
 const {convert,detectRenderer}=require('../../src/lib/renderer');
 assert.equal(typeof convert,'function');assert.equal(typeof detectRenderer,'function');
});
test('cached model output and runtime artifacts do not ship',()=>{
 assert.equal(fs.existsSync(path.join(root,'warm2.json')),false,'cached model output present');
 assert.ok(fs.readFileSync(path.join(root,'.gitignore'),'utf8').includes('data/'));
});
test('the full suite has a portable, complete headless runner',()=>{
 const pkg=require('../../package.json');assert.equal(pkg.scripts.test,'node test/run.js');
 assert.ok(fs.existsSync(path.join(root,'test','run.js')));
});
