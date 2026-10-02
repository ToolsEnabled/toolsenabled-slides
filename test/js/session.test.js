'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const net=require('node:net');
const {Client}=require('../helpers/mcp-client');
test('plugin keeps its worker surface and releases attached-client locks',async t=>{
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'slides-session-'));
 const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));
 const port=probe.address().port;await new Promise(r=>probe.close(r));
 const env={SLIDES_WORKSPACE:workspace,SUITE_PORT:String(port),SUITE_MCP_ROLE:'lead'};
 const owner=new Client(env);let attached;
 try{
  await owner.request('initialize',{});
  await t.test('legacy provider role cannot change plugin tools',async()=>{
   assert.deepEqual(await owner.request('tools/list',{}),JSON.parse(fs.readFileSync(path.join(__dirname,'..','fixtures','tools-list.json'))));
  });
  await t.test('attached EOF releases only its locks and keeps the server alive',async()=>{
   attached=new Client({...env,SUITE_MCP_ROLE:'worker'});await attached.request('initialize',{});
   await attached.tool('ppt_lock',{slide_ids:['s1']});await attached.close();attached=null;
   const result=await owner.tool('ppt_lock',{slide_ids:['s1']});
   assert.doesNotMatch(result,/conflict|held by|already locked/i);
   await owner.tool('ppt_set_text',{slide_id:'s1',element_id:'e1',text:'Client remains connected'});
  });
  await owner.close();
 }finally{
  for(const client of [attached,owner])if(client&&client.child.exitCode===null){client.child.kill('SIGTERM');await client.exited;}
  fs.rmSync(workspace,{recursive:true,force:true});
 }
});
