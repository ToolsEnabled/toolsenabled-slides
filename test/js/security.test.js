'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const net=require('node:net');const http=require('node:http');const {spawn,spawnSync}=require('node:child_process');
const {Client}=require('../helpers/mcp-client');const {python}=require('../../src/lib/prerequisites');
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const n=s.address().port;await new Promise(r=>s.close(r));return n;}
function request(p,route,{method='GET',body,headers={}}={}){return new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port:p,path:route,method,headers:{...headers,...(body?{'Content-Type':'application/json'}:{})}},res=>{let s='';res.on('data',c=>s+=c);res.on('end',()=>resolve({status:res.statusCode,text:s}));});req.on('error',reject);req.end(body?JSON.stringify(body):undefined);});}
test('plugin security boundary, lifecycle and confinement',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'slides-security-'));const workspace=path.join(root,'work');fs.mkdirSync(workspace);const n=await port();
 let auth={};
 const env={SLIDES_WORKSPACE:workspace,SUITE_PORT:String(n),SUITE_PYTHON:python()};const c=new Client(env);
 try{
  await c.request('initialize',{});
  const launch=c.stderr.match(/http:\/\/[^\s]+\/studio#launch=[a-f0-9]{64}/)[0];
  auth=await require('../helpers/dashboard').redeem(launch);
  const health=JSON.parse((await request(n,'/api/health')).text);const originalPid=health.pid;
  await t.test('loopback health identifies the workspace',()=>{assert.equal(health.workspace,workspace);assert.equal(Object.hasOwn(health,'providersEnabled'),false);assert.equal(fs.statSync(path.join(workspace,'.slides-state')).mode&0o777,process.platform==='win32'?fs.statSync(path.join(workspace,'.slides-state')).mode&0o777:0o700);});
  await t.test('foreign Host and Origin fail on reads and writes',async()=>{
   for(const headers of [{Host:'evil.example'},{Origin:'https://evil.example'},{Origin:'null'}])for(const route of ['/api/state','/studio'])assert.equal((await request(n,route,{headers})).status,403);
   assert.equal((await request(n,'/api/edit',{method:'POST',headers:{Origin:'http://evil.example'},body:{op:{type:'set-presentation-title',text:'attack'}}})).status,403);
  });
  await t.test('agent cannot pause resume undo redo or force locks',async()=>{
   for(const route of ['pause','resume','undo','redo'])assert.equal((await request(n,'/api/'+route,{method:'POST',body:{by:'mcp-test',editor:'mcp-test'}})).status,403,route+' must reject agents before consulting state');
   assert.equal((await request(n,'/api/locks',{method:'POST',body:{by:'mcp-test',slideIds:['s1'],force:true}})).status,403);
  });
  await t.test('pause blocks agent edits and exports, human resumes',async()=>{
   await c.tool('ppt_lock',{slide_ids:['s1']});
   assert.equal((await request(n,'/api/pause',{method:'POST',headers:{...auth},body:{by:'human'}})).status,200);
   const paused=await c.request('tools/call',{name:'ppt_set_text',arguments:{slide_id:'s1',element_id:'e1',text:'frozen'}});assert.ok(paused.isError);assert.match(paused.content[0].text,/PAUSED/);
   assert.equal((await request(n,'/api/resume',{method:'POST',headers:{...auth},body:{by:'human'}})).status,200);
  });
  await t.test('read and write paths cannot escape or access private state',async()=>{
   fs.writeFileSync(path.join(root,'outside.pptx'),'outside sentinel');
   fs.symlinkSync(root,path.join(workspace,'linked'),'dir');
   for(const name of ['ppt_import','ppt_export'])for(const p of ['../outside.pptx','/etc/passwd','.slides-state/model.json','linked/outside.pptx','a/../../outside.pptx']){
    const r=await c.request('tools/call',{name,arguments:name==='ppt_import'?{path:p}:{path:p,format:'pptx'}});assert.ok(r.isError,name+' '+p);
   }
   assert.equal(fs.readFileSync(path.join(root,'outside.pptx'),'utf8'),'outside sentinel');
  });
  await t.test('wrong schemas and hidden control tools fail',async()=>{
   for(const [name,args] of [['ppt_set_text',{slide_id:'s1',element_id:'e1',text:4}],['ppt_export',{path:'x',format:'exe'}],['ppt_pause',{}],['ppt_note',{text:'x',editor:'human'}]])assert.ok((await c.request('tools/call',{name,arguments:args})).isError);
  });
  await t.test('PPTX export refuses overwrite; import rejects external relationships',async()=>{
   await c.tool('ppt_export',{path:'clean.pptx',format:'pptx'});
   assert.ok((await c.request('tools/call',{name:'ppt_export',arguments:{path:'clean.pptx',format:'pptx'}})).isError);
   const py=spawnSync(python(),['-c',`import zipfile,sys\nsrc,dst=sys.argv[1:]\nwith zipfile.ZipFile(src) as z, zipfile.ZipFile(dst,'w') as w:\n for n in z.namelist():\n  b=z.read(n)\n  if n=='ppt/_rels/presentation.xml.rels': b=b.replace(b'</Relationships>',b'<Relationship Id="external" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="file:///etc/passwd" TargetMode="External"/></Relationships>')\n  w.writestr(n,b)`,path.join(workspace,'clean.pptx'),path.join(workspace,'external.pptx')],{encoding:'utf8'});assert.equal(py.status,0,py.stderr);
   const r=await c.request('tools/call',{name:'ppt_import',arguments:{path:'external.pptx'}});assert.ok(r.isError);assert.match(r.content[0].text,/External links/);
  });
  await t.test('another server cannot mutate the same workspace',async()=>{
   const p=await port();const duplicate=spawn(process.execPath,[path.resolve(__dirname,'../..','src/server.js')],{env:{...process.env,...env,SUITE_PORT:String(p)},stdio:['ignore','pipe','pipe']});let log='';duplicate.stderr.on('data',x=>log+=x);const code=await new Promise(r=>duplicate.once('exit',r));assert.equal(code,1);assert.match(log,/leased/);assert.equal(JSON.parse((await request(n,'/api/health')).text).pid,originalPid);
  });
  await t.test('different workspace cannot attach to an occupied port',async()=>{
   const other=new Client({...env,SLIDES_WORKSPACE:path.join(root,'other')});await assert.rejects(other.request('initialize',{}),/different service or workspace/);assert.equal(await other.exited,1);
  });
  await c.close();assert.equal(fs.existsSync(path.join(workspace,'.slides-state','server.lock')),false);
 }finally{if(c.child.exitCode===null)c.child.kill('SIGTERM');fs.rmSync(root,{recursive:true,force:true});}
});
