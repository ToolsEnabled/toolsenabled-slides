'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {Client}=require('../helpers/mcp-client'),{redeem}=require('../helpers/dashboard');
test('every unauthenticated editor needs its own lock, regardless of display name',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'slides-origin-lock-')),socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 const c=new Client({SLIDES_WORKSPACE:root,SUITE_PORT:String(port)}),origin=`http://127.0.0.1:${port}`;
 const post=async(route,body,auth={})=>{const r=await fetch(origin+route,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...auth},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 try{
  await c.tool('ppt_show');const before=await fetch(origin+'/api/state').then(r=>r.json()),slide=before.model.slides[0];
  for(const editor of ['alice','human','dashboard','studio','',null,'cc-agent']){
   const r=await post('/api/edit',{editor,op:{type:'set-presentation-title',text:'forged'}});assert.equal(r.status,409,JSON.stringify({editor,r}));
  }
  assert.deepEqual((await fetch(origin+'/api/state').then(r=>r.json())).model,before.model);
  const lock=await post('/api/locks',{by:'alice',slideIds:[slide.id]});assert.equal(lock.status,200,JSON.stringify(lock));
  const edited=await post('/api/edit',{editor:'alice',op:{type:'set-presentation-title',text:'With a lock'}});assert.equal(edited.status,200,JSON.stringify(edited));
  const other=await post('/api/edit',{editor:'bob',op:{type:'set-presentation-title',text:'Not my lock'}});assert.equal(other.status,409);
  const auth=await redeem(c.stderr.match(/http:\/\/[^\s]+\/studio#launch=[a-f0-9]{64}/)[0]);
  const human=await post('/api/edit',{editor:'human',op:{type:'set-presentation-title',text:'Authenticated dashboard'}},auth);assert.equal(human.status,200,JSON.stringify(human));
 }finally{await c.close();fs.rmSync(root,{recursive:true,force:true});}
});
