'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),http=require('node:http'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const {Client,assertProcessExited}=require('../helpers/mcp-client');
const native={skip:process.platform!=='win32'?'native Windows filesystem, case and sharing counterpart':false};
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const n=s.address().port;await new Promise(r=>s.close(r));return n;}
async function health(n){return (await fetch('http://127.0.0.1:'+n+'/api/health')).json();}
test('native same-workspace restart, case attachment, lease contention and occupied port',native,async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"Slides owner's résumé-")),workspace=path.join(root,'Mixed Case');fs.mkdirSync(workspace);const n=await port();const env={SLIDES_WORKSPACE:workspace,SUITE_PORT:String(n)};
 let owner,attached,duplicate,occupied;let firstPid;
 try{
  owner=new Client(env);await owner.tool('ppt_show');firstPid=(await health(n)).pid;const lock=path.join(workspace,'.slides-state','server.lock'),before=hash(lock);
  // Measure the actual Windows API's canonical identity before attaching.
  // Exact health binding stays intact; another physical workspace still refuses below.
  const canonical=fs.realpathSync.native(workspace),upperCanonical=fs.realpathSync.native(workspace.toUpperCase());
  assert.equal(upperCanonical,canonical);assert.equal((await health(n)).workspace,canonical);
  if(process.env.SLIDES_KEEP_TESTS==='1'){const h=await health(n);fs.writeFileSync(path.join(root,'workspace-attachment.json'),JSON.stringify({requested:workspace,uppercase:workspace.toUpperCase(),realpath:fs.realpathSync(workspace),nativeRealpath:fs.realpathSync.native(workspace),uppercaseRealpath:fs.realpathSync(workspace.toUpperCase()),uppercaseNativeRealpath:fs.realpathSync.native(workspace.toUpperCase()),health:{ok:h.ok,service:h.service,workspace:h.workspace,pid:h.pid}},null,2)+'\n');console.log('Retained workspace attachment evidence: '+JSON.stringify(root));}
  attached=new Client({...env,SLIDES_WORKSPACE:workspace.toUpperCase()});await attached.request('initialize',{});await attached.close();attached=null;assert.equal((await health(n)).pid,firstPid);assert.equal(hash(lock),before);
  duplicate=new Client({...env,SUITE_PORT:String(await port())});await assert.rejects(duplicate.request('initialize',{}),/leased/);assert.equal(await duplicate.exited,1);assert.equal(hash(lock),before);assert.equal((await health(n)).pid,firstPid);
  occupied=new Client({...env,SLIDES_WORKSPACE:path.join(root,'other')});await assert.rejects(occupied.request('initialize',{}),/different service or workspace/);assert.equal(await occupied.exited,1);assert(!fs.existsSync(path.join(root,'other','.slides-state')));assert.equal(hash(lock),before);
  await owner.close();owner=null;await assertProcessExited(firstPid);assert(!fs.existsSync(lock));
  owner=new Client(env);await owner.tool('ppt_show');assert.notEqual((await health(n)).pid,firstPid);await owner.close();owner=null;assert(!fs.existsSync(lock));
  const foreign=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,service:'inert-owned-port-fixture'}));});await new Promise(r=>foreign.listen(n,'127.0.0.1',r));
  try{occupied=new Client(env);await assert.rejects(occupied.request('initialize',{}),/different service or workspace/);assert.equal(await occupied.exited,1);assert(!fs.existsSync(lock));}finally{await new Promise(r=>foreign.close(r));}
 }finally{for(const client of [attached,duplicate,occupied,owner])if(client&&client.child.exitCode===null&&client.child.signalCode===null){client.child.kill('SIGKILL');await client.exited;}}
});
test('native import/export refuses devices, streams, case-private aliases and a junction',native,async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'slides-native-paths-')),workspace=path.join(root,'work'),outside=path.join(root,'outside');fs.mkdirSync(workspace);fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'sentinel.pptx'),'unchanged');fs.symlinkSync(outside,path.join(workspace,'linked'),'junction');
 const client=new Client({SLIDES_WORKSPACE:workspace,SUITE_PORT:String(await port())});
 try{await client.tool('ppt_show');const before=hash(path.join(outside,'sentinel.pptx'));for(const value of ['deck.pptx:secret','NUL.pptx','COM1.pptx','deck.pptx.','deck.pptx ','.SLIDES-STATE/model.json','linked/sentinel.pptx'])for(const name of ['ppt_import','ppt_export']){const r=await client.request('tools/call',{name,arguments:{path:value,...(name==='ppt_export'?{format:'pptx'}:{})}});assert(r.isError,name+' accepted '+value);}assert.equal(hash(path.join(outside,'sentinel.pptx')),before);assert.deepEqual(fs.readdirSync(outside),['sentinel.pptx']);await client.close();}finally{if(client.child.exitCode===null&&client.child.signalCode===null){client.child.kill('SIGKILL');await client.exited;}}
});
test('native held model rejects atomic replacement and preserves authoritative bytes',native,async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'slides-native-sharing-')),client=new Client({SLIDES_WORKSPACE:root,SUITE_PORT:String(await port())});let hold;
 try{
  await client.tool('ppt_show');await client.tool('ppt_lock',{slide_ids:['s1']});const model=path.join(root,'.slides-state','model.json'),before=hash(model);
  hold=spawn(path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.resolve(__dirname,'../windows/hold-file.ps1'),'-Path',model],{stdio:['pipe','pipe','pipe']});
  let output='',error='';hold.stdout.on('data',b=>output+=b);hold.stderr.on('data',b=>error+=b);const until=Date.now()+10000;while(!output.includes('OWNED_SHARING_HOLD_READY')&&Date.now()<until&&hold.exitCode===null)await new Promise(r=>setTimeout(r,25));assert(output.includes('OWNED_SHARING_HOLD_READY'),error);
  const result=await client.request('tools/call',{name:'ppt_set_presentation_title',arguments:{text:'Must not replace held model'}});assert(result.isError,JSON.stringify(result));assert.equal(hash(model),before,'sharing refusal replaced authoritative bytes');
  const closed=new Promise(r=>hold.once('close',r));hold.stdin.end('\n');assert.equal(await closed,0);hold=null;
  assert.doesNotMatch(await client.tool('ppt_show'),/Must not replace held model/);await client.close();
 }finally{if(hold&&hold.exitCode===null){hold.kill('SIGKILL');}if(client.child.exitCode===null&&client.child.signalCode===null){client.child.kill('SIGKILL');await client.exited;}}
});
