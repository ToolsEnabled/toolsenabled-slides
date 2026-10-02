'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const net=require('node:net');
const {Client}=require('../helpers/mcp-client');
test('native editing cannot grow past the import model limits',async()=>{
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'slides-limit-'));fs.mkdirSync(path.join(workspace,'.slides-state'));
 const slides=Array.from({length:200},(_,i)=>({id:'s'+i,layout:'blank',notes:'',elements:[]}));
 fs.writeFileSync(path.join(workspace,'.slides-state','model.json'),JSON.stringify({title:'At capacity',rev:0,slides}));
 const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const c=new Client({SLIDES_WORKSPACE:workspace,SUITE_PORT:String(port)});
 try{
  await c.request('initialize',{});await c.tool('ppt_lock',{slide_ids:slides.map(s=>s.id)});
  const result=await c.request('tools/call',{name:'ppt_add_slide',arguments:{title:'Too many',layout:'blank'}});
  assert.ok(result.isError);assert.match(result.content[0].text,/200 slides/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(workspace,'.slides-state','model.json'))).rev,0);
  await c.close();
 }finally{if(c.child.exitCode===null){c.child.kill('SIGTERM');await c.exited;}fs.rmSync(workspace,{recursive:true,force:true});}
});
