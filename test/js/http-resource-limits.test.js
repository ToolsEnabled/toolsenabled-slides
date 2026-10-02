'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const net=require('node:net');const vm=require('node:vm');const {Client}=require('../helpers/mcp-client');
const root=path.resolve(__dirname,'../..');
test('browser fetch metadata blocks cross-origin lint and image probes',async()=>{
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'slides-fetch-'));const sock=net.createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));const client=new Client({SLIDES_WORKSPACE:workspace,SUITE_PORT:String(port)});
 try{await client.tool('ppt_show');for(const site of ['cross-site','same-site'])for(const route of ['/api/lint','/thumbs/slide-1.png','/api/animation-preview-asset','/api/media-preview-asset']){const r=await fetch(`http://127.0.0.1:${port}${route}`,{headers:{'Sec-Fetch-Site':site}});assert.equal(r.status,403,site+route);}
 const r=await fetch(`http://127.0.0.1:${port}/api/state`,{headers:{'Sec-Fetch-Site':'same-origin'}});assert.equal(r.status,200);assert.equal(r.headers.get('cross-origin-resource-policy'),'same-origin');assert.equal(r.headers.get('x-content-type-options'),'nosniff');
 }finally{await client.close();fs.rmSync(workspace,{recursive:true,force:true});}
});
test('20 concurrent lint reads share one helper and cache only the same revision/artifact',async()=>{
 const s=fs.readFileSync(path.join(root,'src/server.js'),'utf8');const begin=s.indexOf('async function fullLint(');const end=s.indexOf('// Scoped version',begin);let calls=0;
 const context={require:id=>require(path.resolve(root,'src',id)),model:{rev:1},PPTX_PATH:'synthetic',fs:{statSync:()=>({mtimeMs:1,size:20})},lintModel:m=>({rev:m.rev,ok:true,count:0,issues:[]}),lintFonts:async()=>{calls++;await new Promise(r=>setTimeout(r,30));return [];}};
 const code=s.slice(begin,end)+'\nfullLint';const lint=vm.runInNewContext(code,context);await Promise.all(Array.from({length:20},()=>lint(context.model)));assert.equal(calls,1);await lint(context.model);assert.equal(calls,1);await lint({rev:2});assert.equal(calls,2);
});
test('Python render work has a bounded queue and concurrency',async()=>{const {run}=require('../../src/lib/python-jobs');let active=0,peak=0;await Promise.all(Array.from({length:12},()=>run(async()=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,5));active--;})));assert(peak<=2);});
