'use strict';
// ppt_import replaces every object of the deck, so a protection on a single object must stop it just as a slide
// protection does; and a workspace that an earlier release left with a protection naming a missing object must
// still start.
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const net=require('node:net');
const {Client}=require('../helpers/mcp-client');const {python}=require('../../src/lib/prerequisites');const {redeem}=require('../helpers/dashboard');
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const n=s.address().port;await new Promise(r=>s.close(r));return n;}
async function start(workspace,port){
 const client=new Client({SLIDES_WORKSPACE:workspace,SUITE_PORT:String(port),SUITE_PYTHON:python()});
 await client.request('initialize',{});
 const launch=client.stderr.match(/http:\/\/[^\s]+\/studio#launch=[a-f0-9]{64}/);
 return {client,auth:launch?await redeem(launch[0]):null};
}
async function call(port,route,{method='GET',headers={},body}={}){
 const r=await fetch(`http://127.0.0.1:${port}${route}`,{method,headers:{...headers,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 return {status:r.status,body:await r.json().catch(()=>null)};
}
const protect=(port,auth,objectId,on)=>call(port,'/api/protections/toggle',{method:'POST',headers:auth,body:{kind:'object',slideId:'s1',objectId,objectKind:'element',protected:on,by:'Human'}});
const key=p=>`${p.kind}:${p.slideId}:${p.objectKind||''}:${p.objectId||''}`;

test('ppt_import refuses while a human protects one object of the current deck, and names it',async()=>{
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'slides-import-protect-'));const port=await freePort();let client;
 try{
  let auth;({client,auth}=await start(workspace,port));
  await client.tool('ppt_export',{path:'replacement.pptx',format:'pptx'});
  assert.equal((await protect(port,auth,'e1',true)).status,200);
  await client.tool('ppt_lock',{slide_ids:['s1']});
  const before=(await call(port,'/api/state')).body;
  const refused=await client.request('tools/call',{name:'ppt_import',arguments:{path:'replacement.pptx'}});
  assert.ok(refused.isError,'import must refuse while an object of the deck is protected: '+JSON.stringify(refused));
  assert.match(refused.content[0].text,/Protected content must be unlocked by the human before replacing the deck \(element e1 on slide s1 is protected\)/);
  const after=(await call(port,'/api/state')).body;
  assert.equal(after.rev,before.rev,'the refused import changed nothing');assert.deepEqual(after.model.slides,before.model.slides);
  assert.deepEqual(after.protections.map(key),['object:s1:element:e1']);
  assert.ok(after.model.slides[0].elements.some(e=>e.id==='e1'),'the protected object still exists');
  assert.equal((await protect(port,auth,'e1',false)).status,200,'the human can still unprotect it');
  const imported=JSON.parse(await client.tool('ppt_import',{path:'replacement.pptx'}));
  assert.equal(imported.ok,true,'without the protection the same import goes through');
 }finally{if(client)await client.close().catch(()=>client.child.kill('SIGKILL'));fs.rmSync(workspace,{recursive:true,force:true});}
});

test('a protection an earlier import left on a missing object is set aside at the next start, with a copy of state.json',async()=>{
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'slides-stale-protect-'));const port=await freePort();let client;
 const stateDir=path.join(workspace,'.slides-state');const statePath=path.join(stateDir,'state.json');
 try{
  let auth;({client,auth}=await start(workspace,port));
  for(const id of ['e1','e2'])assert.equal((await protect(port,auth,id,true)).status,200);
  await client.close();client=null;
  // What Slides 0.1.4 left behind: ppt_import replaced the deck, so these rows name objects it no longer has.
  const damaged=JSON.parse(fs.readFileSync(statePath,'utf8'));
  damaged.protections[0].objectId='e0_9';
  damaged.protections.push({kind:'object',slideId:'s9',objectId:'e0_1',objectKind:'element',by:'Human',createdAt:1});
  const damagedText=JSON.stringify(damaged,null,2);fs.writeFileSync(statePath,damagedText);
  ({client,auth}=await start(workspace,port));
  assert.match(client.stderr,/Removed 2 protections for objects no longer in the deck \(element e0_9 on slide s1, element e0_1 on slide s9\); the previous state\.json is kept as state-before-protection-repair-[^\s]+\.json/);
  const kept=fs.readdirSync(stateDir).filter(n=>n.startsWith('state-before-protection-repair-'));
  assert.equal(kept.length,1);assert.equal(fs.readFileSync(path.join(stateDir,kept[0]),'utf8'),damagedText,'the previous state.json is kept byte for byte');
  const protections=(await call(port,'/api/protections')).body.protections;
  assert.deepEqual(protections.map(key),['object:s1:element:e2'],'only the rows naming missing objects are removed');
  const saved=JSON.parse(fs.readFileSync(statePath,'utf8'));
  assert.deepEqual(saved.protections.map(key),['object:s1:element:e2']);
  const entry=saved.log[saved.log.length-1];
  assert.equal(entry.kind,'protections-set-aside');assert.deepEqual(entry.protections.map(key),['object:s1:element:e0_9','object:s9:element:e0_1']);
  assert.equal((await protect(port,auth,'e2',false)).status,200,'the remaining protection still works');
  await client.close();client=null;
  ({client}=await start(workspace,port));
  assert.doesNotMatch(client.stderr,/Removed \d+ protection/);
  assert.equal(fs.readdirSync(stateDir).filter(n=>n.startsWith('state-before-protection-repair-')).length,1,'a clean start sets nothing aside');
 }finally{if(client)await client.close().catch(()=>client.child.kill('SIGKILL'));fs.rmSync(workspace,{recursive:true,force:true});}
});

test('an MCP edit or import refused for protected content says PROTECTED, not PAUSED',async()=>{
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'slides-protect-text-'));const port=await freePort();let client;
 try{
  let auth;({client,auth}=await start(workspace,port));
  await client.tool('ppt_export',{path:'replacement.pptx',format:'pptx'});
  await client.tool('ppt_lock',{slide_ids:['s1']});
  assert.equal((await call(port,'/api/protections/toggle',{method:'POST',headers:auth,body:{kind:'slide',slideId:'s1',protected:true,by:'Human'}})).status,200);
  const edit=await client.request('tools/call',{name:'ppt_set_text',arguments:{slide_id:'s1',element_id:'e1',text:'changed'}});
  assert.ok(edit.isError);
  assert.match(edit.content[0].text,/^PROTECTED\. set-text refused: slide s1 is protected by Human; a human must unprotect it first\. Your change was NOT applied\./);
  const imported=await client.request('tools/call',{name:'ppt_import',arguments:{path:'replacement.pptx'}});
  assert.ok(imported.isError);
  assert.match(imported.content[0].text,/^PROTECTED\. Protected content must be unlocked by the human before replacing the deck \(slide s1 is protected\)\. Your change was NOT applied\./);
  for(const r of [edit,imported])assert.doesNotMatch(r.content[0].text,/PAUSED|Resume/,'a protection is not a pause');
  assert.equal((await call(port,'/api/protections/toggle',{method:'POST',headers:auth,body:{kind:'slide',slideId:'s1',protected:false,by:'Human'}})).status,200);
  assert.equal((await call(port,'/api/pause',{method:'POST',headers:auth,body:{by:'Human'}})).status,200);
  const paused=await client.request('tools/call',{name:'ppt_set_text',arguments:{slide_id:'s1',element_id:'e1',text:'changed'}});
  assert.ok(paused.isError);assert.match(paused.content[0].text,/^PAUSED\. The human has paused all editing/,'a real pause still reads as a pause');
 }finally{if(client)await client.close().catch(()=>client.child.kill('SIGKILL'));fs.rmSync(workspace,{recursive:true,force:true});}
});
