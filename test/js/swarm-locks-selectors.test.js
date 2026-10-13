'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn,spawnSync}=require('node:child_process');
const {redeem}=require('../helpers/dashboard');
const suite=path.resolve(__dirname,'../..');
function fixture(prefix='slides-swarm-lock-'){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),prefix)),data=path.join(root,'.slides-state');fs.mkdirSync(data);
 const model={title:'Before',theme:{accent:'#2563eb'},rev:0,slides:['s1','s2'].map(id=>({id,layout:'title',notes:'',elements:[{id:id+'-title',type:'title',text:id}]}))};
 fs.writeFileSync(path.join(data,'model.json'),JSON.stringify(model));
 return {root,data,model,close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
async function runtime(){
 const f=fixture(),socket=net.createServer();await new Promise((resolve,reject)=>{socket.once('error',reject);socket.listen(0,'127.0.0.1',resolve);});const port=socket.address().port;await new Promise(r=>socket.close(r));
 const env={...process.env,SLIDES_WORKSPACE:f.root,SUITE_PORT:String(port),SLIDES_OWNER_STDIN:'1'};delete env.DISPLAY;
 const child=spawn(process.execPath,[path.join(suite,'src/server.js')],{env,stdio:['pipe','pipe','pipe']});
 let launch='',output='';child.stdout.on('data',b=>{output=(output+b).slice(-16000);launch=output.match(/http:\/\/[^\s]+\/studio#launch=[a-f0-9]{64}/)?.[0]||launch;});child.stderr.resume();
 const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal}))),origin=`http://127.0.0.1:${port}`;
 const close=async()=>{child.stdin.end();const result=await exited;f.close();assert.equal(result.code,0,'Isolated runtime must shut down cleanly');};
 try{
  const deadline=Date.now()+15000;while(!launch&&child.exitCode===null&&Date.now()<deadline)await new Promise(r=>setTimeout(r,20));
  assert(launch,'Isolated runtime could not be checked: no dashboard launch');
  const auth=await redeem(launch);
  const post=async(route,body,headers={})=>{const r=await fetch(origin+route,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});return {status:r.status,body:await r.json()};};
  const state=async()=>{const r=await fetch(origin+'/api/state',{signal:AbortSignal.timeout(5000)});assert.equal(r.status,200);return r.json();};
  return {...f,auth,post,state,close};
 }catch(e){await close();throw e;}
}
for(const [type,fields,verify] of [
 ['set-presentation-title',{text:'After'},m=>assert.equal(m.title,'After')],
 ['set-theme',{accent:'#123456'},m=>assert.equal(m.theme.accent,'#123456')],
 ['add-slide',{title:'Added'},m=>{assert.equal(m.slides.length,3);assert.equal(m.slides[2].elements[0].text,'Added');}]
])test(`F4 ${type} requires all current locks despite a stray slideId`,async()=>{
 const r=await runtime();try{
  assert.deepEqual((await r.post('/api/locks',{by:'alice',slideIds:['s1']})).body.locked,['s1']);
  assert.deepEqual((await r.post('/api/locks',{by:'bob',slideIds:['s2']})).body.locked,['s2']);
  const before=(await r.state()).model;
  for(const op of [{type,...fields},{type,...fields,slideId:'s1'}]){
   const result=await r.post('/api/edit',{editor:'alice',op});assert.equal(result.status,409,type+' must not narrow its lock scope');assert.match(result.body.error,/Lock/);
   assert.match(result.body.error,/ppt_lock before editing: s2 \(.*every current slide/,'the refusal names the slide still to lock');assert.deepEqual(result.body.lockSlides,['s2']);assert.deepEqual((await r.state()).model,before);
  }
  assert.equal((await r.post('/api/locks/release',{by:'bob',slideIds:['s2']})).status,200);
  assert.deepEqual((await r.post('/api/locks',{by:'alice',slideIds:['s2']})).body.locked,['s2']);
  assert.equal((await r.post('/api/edit',{editor:'alice',op:{type,...fields,slideId:'s1'}})).status,200);
  const after=(await r.state()).model;assert.equal(after.rev,before.rev+1);verify(after);
 }finally{await r.close();}
});
test('slide-local notes need only their own lock',async()=>{
 const r=await runtime();try{
  await r.post('/api/locks',{by:'alice',slideIds:['s1']});await r.post('/api/locks',{by:'bob',slideIds:['s2']});
  assert.equal((await r.post('/api/edit',{editor:'alice',op:{type:'set-notes',slideId:'s1',text:'Local notes'}})).status,200);
  const state=await r.state();assert.equal(state.model.slides[0].notes,'Local notes');assert.equal(state.model.slides[1].notes,'');
 }finally{await r.close();}
});
test('unprefixed editor labels cannot edit without their own lock',async()=>{
 const r=await runtime();try{
  const before=(await r.state()).model;
  for(const editor of ['alice','human','dashboard','studio','lead','cc-agent','',null])assert.equal((await r.post('/api/edit',{editor,op:{type:'set-notes',slideId:'s1',text:'Denied'}})).status,409,JSON.stringify(editor));
  assert.deepEqual((await r.state()).model,before);
  await r.post('/api/locks',{by:'alice',slideIds:['s1']});
  const denied=await r.post('/api/edit',{editor:'bob',op:{type:'set-notes',slideId:'s1',text:'Denied'}});assert.equal(denied.status,409);
  assert.match(denied.body.error,/ppt_lock before editing: s1$/);assert.deepEqual(denied.body.lockSlides,['s1']);
  assert.equal((await r.post('/api/edit',{editor:'alice',op:{type:'set-notes',slideId:'s1',text:'Owned'}})).status,200);
  assert.equal((await r.post('/api/edit',{editor:'human',op:{type:'set-notes',slideId:'s2',text:'Dashboard'}},r.auth)).status,200);
  const after=(await r.state()).model;assert.equal(after.slides[0].notes,'Owned');assert.equal(after.slides[1].notes,'Dashboard');
 }finally{await r.close();}
});
for(const mode of ['assignee','claimedBy'])test(`F5 task completion enforces ${mode} ownership for every unauthenticated label`,async()=>{
 const r=await runtime();try{
  const task=(await r.post('/api/tasks',{text:'Owned task',by:'human',assignee:mode==='assignee'?'alice':''},r.auth)).body.task;assert.equal(task.status,'open');
  if(mode==='claimedBy')assert.equal((await r.post('/api/tasks/claim',{id:task.id,by:'alice'})).status,200);
  const before=JSON.parse(fs.readFileSync(path.join(r.data,'board.json'),'utf8'));
  for(const by of [undefined,null,'',' \t ']){
   assert.equal((await r.post('/api/tasks/done',{id:task.id,by})).status,400,'Blank task actor must be refused');
   assert.deepEqual(JSON.parse(fs.readFileSync(path.join(r.data,'board.json'),'utf8')),before);
  }
  for(const by of ['bob','human','dashboard','studio','lead','root','cc-agent','worker-2']){
   const result=await r.post('/api/tasks/done',{id:task.id,by});assert.equal(result.status,409,by+' cannot complete another owner’s task');assert.match(result.body.error,mode==='assignee'?/assigned/:/claimed/);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(r.data,'board.json'),'utf8')),before);
  }
  assert.equal((await r.post('/api/tasks/done',{id:task.id,by:'worker-2'},r.auth)).status,409,'Authenticated worker labels still obey ownership');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(r.data,'board.json'),'utf8')),before);
  assert.equal((await r.post('/api/tasks/done',{id:task.id,by:'alice'})).status,200);
  assert.equal((await r.post('/api/tasks/done',{id:task.id,by:'alice'})).body.alreadyDone,true);
  assert.equal((await r.post('/api/tasks/done',{id:task.id,by:'bob'})).status,409);
  const oversight=(await r.post('/api/tasks',{text:'Oversight',by:'human',assignee:'alice'},r.auth)).body.task;
  assert.equal((await r.post('/api/tasks/done',{id:oversight.id,by:'human'},{Cookie:r.auth.Cookie})).status,409,'A dashboard cookie alone is insufficient');
  assert.equal((await r.post('/api/tasks/done',{id:oversight.id,by:'human'},r.auth)).status,200);
 }finally{await r.close();}
});
test('F6 JSON selector echo is escaped while lookup, revision and pane binding retain the literal selector',async()=>{
 const {parsePage}=await import('../../hooks/view-contract.mjs');
 const f=fixture();try{
  const controls=Array.from({length:32},(_,i)=>String.fromCharCode(0x80+i)).join('')+'\u061c\u200e\u200f\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069';
  const hostile='needle'+controls+'tail',cleaned='needle'+'\ufffd'.repeat(44)+'tail';
  const cases=[[hostile,cleaned],['needle\x1b]52;c;payload\x07\n','needle\ufffd]52;c;payload\ufffd\ufffd'],['Résumé 東京 🧭','Résumé 東京 🧭'],['needle\n\ttwo  spaces','needle\ufffd\ufffdtwo spaces']];
  for(const [selector,display] of cases){
   f.model.slides[0].notes=selector;f.model.slides[1].notes=selector===display?'Different notes':display;
   fs.writeFileSync(path.join(f.data,'model.json'),JSON.stringify(f.model));const before=fs.readFileSync(path.join(f.data,'model.json'));
   const run=(extra=[])=>spawnSync(process.execPath,[path.join(suite,'src/cli/view.js'),'search',selector,'--workspace',f.root,'--json',...extra],{env:process.env,encoding:'utf8',timeout:5000});
   const result=run();assert.equal(result.status,0,result.stderr);assert.equal(result.stderr,'');
   assert(!/[\x80-\x9f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(result.stdout),'JSON stdout must not echo C1 or bidi controls');
   const page=JSON.parse(result.stdout);assert.equal(page.total,1);assert.equal(page.records.length,1);assert.match(page.records[0].label,/s1/);assert.equal(page.selector,selector);assert.equal(parsePage(page,{workspace:f.root,view:'search',selector,all:false,offset:0}).selector,selector);
   const repeat=run(['--revision',page.revision]);assert.equal(repeat.status,0,repeat.stderr);assert.deepEqual(JSON.parse(repeat.stdout),page);assert.deepEqual(fs.readFileSync(path.join(f.data,'model.json')),before);
  }
 }finally{f.close();}
});

test('F6 JSON workspace echo is escaped without changing filesystem or pane binding',async()=>{
 const {parsePage}=await import('../../hooks/view-contract.mjs');
 const f=fixture('slides-é東京-\x9b\u202e-two  spaces-'),neighbor=f.root.replace(/[\x9b\u202e]/g,'\ufffd').replace(/ +/g,' ');
 fs.mkdirSync(path.join(neighbor,'.slides-state'),{recursive:true});fs.writeFileSync(path.join(neighbor,'.slides-state','model.json'),JSON.stringify({...f.model,title:'Neighbor',slides:[{...f.model.slides[0],notes:'Bound workspace'}]}));
 try{
  f.model.slides[0].notes='Bound workspace';fs.writeFileSync(path.join(f.data,'model.json'),JSON.stringify(f.model));
  const before=fs.readFileSync(path.join(f.data,'model.json'));
  const r=spawnSync(process.execPath,[path.join(suite,'src/cli/view.js'),'search','Bound workspace','--workspace',f.root,'--json'],{env:process.env,encoding:'utf8',timeout:5000});
  assert.equal(r.status,0,r.stderr);assert.equal(r.stderr,'');
  assert(!/[\x80-\x9f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(r.stdout),'JSON stdout must not echo workspace C1 or bidi controls');
  const page=JSON.parse(r.stdout);assert.equal(page.workspace,f.root);assert.equal(page.title,'Before');assert.equal(parsePage(page,{workspace:f.root,view:'search',selector:'Bound workspace',all:false,offset:0}).workspace,f.root);assert.equal(page.total,1);assert.match(page.records[0].label,/s1/);
  assert.deepEqual(fs.readFileSync(path.join(f.data,'model.json')),before);
 }finally{f.close();fs.rmSync(neighbor,{recursive:true,force:true});}
});

test('F6 refuses secret-shaped selector or workspace metadata without echoing it',()=>{
 const {randomBytes}=require('node:crypto');
 const values=['#launch='+randomBytes(32).toString('hex'),'X-Slides-Session\t'+randomBytes(32).toString('hex'),'slides_dashboard_1='+randomBytes(32).toString('hex'),'instanceId '+randomBytes(24).toString('hex')];
 for(const key of ['selector','workspace'])for(const value of values){
  const f=fixture(key==='workspace'?'slides-'+value+'-':'slides-secret-selector-');try{
   f.model.slides[0].notes=key==='selector'?value:'Secret metadata';fs.writeFileSync(path.join(f.data,'model.json'),JSON.stringify(f.model));const before=fs.readFileSync(path.join(f.data,'model.json'));
   const r=spawnSync(process.execPath,[path.join(suite,'src/cli/view.js'),'search',key==='selector'?value:'Secret metadata','--workspace',f.root,'--json'],{env:process.env,encoding:'utf8',timeout:5000});
   assert(r.status===1,'Secret-shaped metadata must be refused');assert(r.stdout==='','Refusal must emit no JSON metadata');assert(!r.stderr.includes(value),'Refusal must not echo secret-shaped input');assert.match(r.stderr,/VIEW_QUERY: Selector or workspace contains session secrets; JSON view unavailable/);assert.deepEqual(fs.readFileSync(path.join(f.data,'model.json')),before);
  }finally{f.close();}
 }
});
