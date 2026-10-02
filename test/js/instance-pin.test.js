'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const net=require('node:net');const {Client}=require('../helpers/mcp-client');
test('attached MCP client refuses a new suite on the same port',async()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'slides-instance-'));const sock=net.createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const env={SUITE_PORT:String(port),SLIDES_WORKSPACE:path.join(base,'a')};let owner=new Client(env),peer,replacement;
 try{await owner.tool('ppt_show');peer=new Client(env);await peer.tool('ppt_show');const first=await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();await owner.close();owner=null;
 replacement=new Client({...env,SLIDES_WORKSPACE:path.join(base,'b')});await replacement.tool('ppt_show');const second=await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
 await assert.rejects(()=>peer.tool('ppt_show'),/instance|identity|restart/i);await assert.rejects(()=>peer.tool('ppt_lock',{slide_ids:['s1']}),/instance|identity|restart/i);
 assert(first.instanceId&&second.instanceId&&first.instanceId!==second.instanceId);
 const denied=await fetch(`http://127.0.0.1:${port}/api/state`,{headers:{'X-Slides-Instance':first.instanceId}});assert.equal(denied.status,409);
 assert.equal((await (await fetch(`http://127.0.0.1:${port}/api/locks`)).json()).locks.length,0);
 }finally{if(peer)await peer.close();if(owner)await owner.close();if(replacement)await replacement.close();fs.rmSync(base,{recursive:true,force:true});}
});
