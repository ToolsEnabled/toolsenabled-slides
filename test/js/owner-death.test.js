'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const net=require('node:net');const {Client,assertProcessExited}=require('../helpers/mcp-client');
test('suite stops and releases its lease when owning MCP dies abruptly',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'slides-owner-'));const sock=net.createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));const client=new Client({SLIDES_WORKSPACE:root,SUITE_PORT:String(port)},{redactStderr:true});let pid;
 try{await client.tool('ppt_show');pid=(await (await fetch(`http://127.0.0.1:${port}/api/health`)).json()).pid;client.child.kill('SIGKILL');await client.exited;
 const until=Date.now()+7000;while(Date.now()<until&&fs.existsSync(path.join(root,'.slides-state/server.lock')))await new Promise(r=>setTimeout(r,50));
 assert(!fs.existsSync(path.join(root,'.slides-state/server.lock')),'orphan still owns workspace lease');await assertProcessExited(pid);
 }finally{client.child.kill('SIGKILL');await client.exited;if(process.env.SLIDES_KEEP_TESTS==='1'){fs.writeFileSync(path.join(root,'owner-death.json'),JSON.stringify({workspace:root,port,serverPid:pid,leaseRemains:fs.existsSync(path.join(root,'.slides-state/server.lock')),stderr:client.stderr},null,2)+'\n');console.log('Retained owner-death evidence: '+JSON.stringify(root));}else fs.rmSync(root,{recursive:true,force:true});}
});
