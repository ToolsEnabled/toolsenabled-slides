
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const {assertProcessExited}=require('../helpers/mcp-client');
for(const mode of ['owner EOF','forced guardian termination'])test('Windows lifetime custody ends only its owned root and detached grandchild: '+mode,{skip:process.platform!=='win32'?'native Windows Job Object fixture':false},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'slides-win-job-'));
 const grandchild=path.join(root,'grandchild.js'),child=path.join(root,'child.js'),receipt=path.join(root,'pids.json');
 fs.writeFileSync(grandchild,'setInterval(()=>{},1000);\n');
 fs.writeFileSync(child,"const fs=require('node:fs');const {spawn}=require('node:child_process');const child=spawn(process.execPath,[process.argv[2]],{stdio:'ignore',detached:true});fs.writeFileSync(process.argv[3],JSON.stringify({root:process.pid,grandchild:child.pid}));setInterval(()=>{},1000);\n");
 const python=require('../../src/lib/prerequisites').python();
 const guardian=spawn(python,['-I','-S','-B',path.resolve(__dirname,'../../src/python/node_child.py'),'--inherit-environment','--owner-pipe','--',process.execPath,child,grandchild,receipt],{stdio:['pipe','pipe','pipe']});
 let stderr='';guardian.stderr.on('data',part=>stderr+=part);
 const closed=new Promise(resolve=>guardian.once('close',resolve));
 try{
  const until=Date.now()+10000;
  while(!fs.existsSync(receipt)&&Date.now()<until&&guardian.exitCode===null)await new Promise(resolve=>setTimeout(resolve,25));
  assert(fs.existsSync(receipt),'owned fixture did not start: '+stderr);
  const pids=JSON.parse(fs.readFileSync(receipt,'utf8'));
  if(mode==='owner EOF')guardian.stdin.end();else guardian.kill('SIGKILL');await closed;
  await assertProcessExited(pids.root);await assertProcessExited(pids.grandchild);
 }finally{if(guardian.exitCode===null&&guardian.signalCode===null)guardian.kill('SIGKILL');await closed;}
});
