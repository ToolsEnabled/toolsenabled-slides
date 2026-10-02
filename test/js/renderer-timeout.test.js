'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const net=require('node:net');const {Client}=require('../helpers/mcp-client');
test('MCP PDF and PNG timeouts report the renderer deadline without exposing private paths',{skip:process.platform==='win32'?'POSIX renderer process double':false},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'slides-timeout-'));const workspace=path.join(dir,'workspace');fs.mkdirSync(workspace);const preload=path.join(dir,'clock.cjs');const exe=path.join(dir,'soffice');const marker=path.join(dir,'office-started');
 fs.writeFileSync(preload,"const timer=global.setTimeout;global.setTimeout=(fn,ms,...args)=>timer(fn,ms===90000?1500:ms,...args);\n");
 fs.writeFileSync(exe,`#!/usr/bin/env node\nconst fs=require('fs');if(process.argv.includes('--version'))console.log('offline Office double');else{fs.writeFileSync(${JSON.stringify(marker)},String(process.pid));setInterval(()=>{},1000);}\n`,{mode:0o755});
 const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const client=new Client({SLIDES_WORKSPACE:workspace,SUITE_PORT:String(port),SLIDES_SOFFICE:exe,SLIDES_RENDERER:'libreoffice',NODE_OPTIONS:'--require '+preload});
 try{
  await client.tool('ppt_show');
  for(const format of ['pdf','png']){
   const result=await client.request('tools/call',{name:'ppt_export',arguments:{path:format==='pdf'?'out.pdf':'pages',format}});assert(result.isError);const text=JSON.stringify(result);assert.match(text,/renderer timed out/i);assert(!/check the destination|\/tmp\/|Traceback|\.slides-state/.test(text),text);assert(!fs.existsSync(path.join(workspace,format==='pdf'?'out.pdf':'pages')));
  }
  assert(fs.existsSync(marker),'the timeout must reach the Office subprocess');
 }finally{await client.close();fs.rmSync(dir,{recursive:true,force:true});}
});
