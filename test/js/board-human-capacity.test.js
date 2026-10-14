'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const net=require('node:net');const {Client}=require('../helpers/mcp-client');const {redeem,launchLink}=require('../helpers/dashboard');
test('agent volume cannot consume human board capacity or impersonate its provenance',async()=>{
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'slides-capacity-'));const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));const env={SLIDES_WORKSPACE:workspace,SUITE_PORT:String(port)};let c=new Client(env);const origin=`http://127.0.0.1:${port}`;
 const post=async(route,body,auth={})=>{const r=await fetch(origin+route,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...auth},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 try{await c.tool('ppt_show');const auth=await redeem(launchLink(c.stderr));
  const protectedNote=await post('/api/board',{text:'Human note survives agent floods',author:'human'},auth);assert.equal(protectedNote.status,200);
  for(let i=0;i<60;i++)await post('/api/board',{text:'漢'.repeat(4000),author:i<10?'human':'mcp-'+i,humanOrigin:true});
  for(const pinned of [false,true]){const r=await post('/api/board',{text:'Human can still write '+pinned,author:'human',pinned},auth);assert.equal(r.status,200,JSON.stringify(r));}
  const task=await post('/api/tasks',{text:'Human can still assign work',by:'human'},auth);assert.equal(task.status,200,JSON.stringify(task));
  const disk=JSON.parse(fs.readFileSync(path.join(workspace,'.slides-state/board.json')));assert(disk.notes.some(n=>n.id===protectedNote.body.note.id));assert(Buffer.byteLength(JSON.stringify(disk))<=512*1024);assert(Buffer.byteLength(JSON.stringify(disk.notes.filter(n=>!n.pinned&&!n.humanOrigin)))<=128*1024);assert(disk.notes.filter(n=>n.text.startsWith('漢')).every(n=>n.humanOrigin!==true));
  // Human-authored data can fill the remaining budget. A refused agent note
  // must not be reported as saved when eviction removed that same new note.
  for(let i=0;i<45;i++){const r=await post('/api/board',{text:'語'.repeat(4000),author:'human'},auth);if(r.status!==200)break;}
  const refused=await post('/api/board',{text:'漢'.repeat(4000),author:'another-agent'});assert.notEqual(refused.status,200,'must not acknowledge an evicted new message');
  await c.close();c=new Client(env);await c.tool('ppt_show');const after=JSON.parse(fs.readFileSync(path.join(workspace,'.slides-state/board.json')));assert(after.tasks.some(t=>t.id===task.body.task.id));assert(after.notes.some(n=>n.id===protectedNote.body.note.id));
 }finally{await c.close();fs.rmSync(workspace,{recursive:true,force:true});}
});
