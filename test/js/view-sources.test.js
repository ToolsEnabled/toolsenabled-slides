'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {Client}=require('../helpers/mcp-client');
test('cached-only lint and export receipts supply read-only views without starting jobs',async()=>{
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'slides-view-sources-')),socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 const c=new Client({SLIDES_WORKSPACE:workspace,SUITE_PORT:String(port)}),origin=`http://127.0.0.1:${port}`;
 try{
  await c.tool('ppt_show');const cached=await fetch(origin+'/api/lint?cached=1').then(r=>r.json());assert.equal(cached.cached,false);assert.equal(cached.rev,0);
  const full=await c.tool('ppt_lint');assert(full);const after=await fetch(origin+'/api/lint?cached=1').then(r=>r.json());assert.equal(after.cached,true);assert(Array.isArray(after.issues));
  const exported=JSON.parse(await c.tool('ppt_export',{format:'pptx',path:'copy.pptx'}));assert.equal(exported.receiptRecorded,true);
  const receipt=JSON.parse(fs.readFileSync(path.join(workspace,'.slides-state/exports.json')));assert.equal(receipt.length,1);assert.deepEqual(receipt[0].files,['copy.pptx']);assert.equal(receipt[0].rev,exported.rev);assert.equal(receipt[0].format,'pptx');assert.equal(receipt[0].renderer,'python-pptx');
  const bytes=fs.readFileSync(path.join(workspace,'.slides-state/exports.json'));await assert.rejects(c.tool('ppt_export',{format:'pptx',path:'copy.pptx'}));assert.deepEqual(fs.readFileSync(path.join(workspace,'.slides-state/exports.json')),bytes);
 }finally{await c.close();fs.rmSync(workspace,{recursive:true,force:true});}
});
