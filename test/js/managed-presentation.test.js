'use strict';
// presentation.pptx is Slides' output in the user's workspace. A file there that Slides did not write must be kept
// under a new name before a render replaces it, and ordinary renders must not leave copies behind.
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const net=require('node:net');
const {Client}=require('../helpers/mcp-client');const {python}=require('../../src/lib/prerequisites');const {deck}=require('../helpers/user-deck');
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const n=s.address().port;await new Promise(r=>s.close(r));return n;}
async function rendered(port,rev){
 const deadline=Date.now()+90000;let last;
 while(Date.now()<deadline){last=await fetch(`http://127.0.0.1:${port}/api/health`).then(r=>r.json()).catch(()=>null);if(last&&last.presentation&&last.presentation.current&&last.presentation.rev===rev)return;await new Promise(r=>setTimeout(r,100));}
 throw new Error('render did not publish rev '+rev+': '+JSON.stringify(last));
}
const copies=workspace=>fs.readdirSync(workspace).filter(n=>/^presentation\.user-.+\.pptx$/.test(n)).sort();

test('a presentation.pptx that Slides did not write is kept under a new name before a render replaces it',async()=>{
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'slides-managed-pptx-'));const port=await freePort();const env={SLIDES_WORKSPACE:workspace,SUITE_PORT:String(port),SUITE_PYTHON:python()};let client;
 const pptx=path.join(workspace,'presentation.pptx');
 try{
  const userDeck=deck(pptx,'USER DECK ONE');
  client=new Client(env);await client.request('initialize',{});await rendered(port,0);
  assert.equal(copies(workspace).length,1,'the user deck must be kept before the first render replaces it');
  assert.deepEqual(fs.readFileSync(path.join(workspace,copies(workspace)[0])),userDeck,'kept byte for byte');
  assert.notDeepEqual(fs.readFileSync(pptx),userDeck);
  assert.match(client.stderr,/presentation\.pptx was not written by Slides; kept it as presentation\.user-[^\s]+\.pptx before rendering the deck/);
  // PowerPoint edits saved over the render are kept the same way at the next render.
  const edited=deck(path.join(workspace,'edited.tmp.pptx'),'EDITED IN POWERPOINT');fs.writeFileSync(pptx,edited);fs.rmSync(path.join(workspace,'edited.tmp.pptx'));
  await client.tool('ppt_lock',{slide_ids:['s1']});
  await client.tool('ppt_set_text',{slide_id:'s1',element_id:'e1',text:'After the PowerPoint edit'});await rendered(port,1);
  assert.equal(copies(workspace).length,2);
  assert.deepEqual(fs.readFileSync(path.join(workspace,copies(workspace)[1])),edited);
  // Ordinary edits and restarts keep no copies of Slides' own renders.
  await client.tool('ppt_set_text',{slide_id:'s1',element_id:'e1',text:'An ordinary edit'});await rendered(port,2);
  await client.close();client=new Client(env);await client.request('initialize',{});await rendered(port,2);
  await client.tool('ppt_lock',{slide_ids:['s1']});await client.tool('ppt_set_text',{slide_id:'s1',element_id:'e1',text:'After a restart'});await rendered(port,3);
  assert.equal(copies(workspace).length,2,'renders Slides wrote itself are replaced without copies');
 }finally{if(client)await client.close().catch(()=>client.child.kill('SIGKILL'));fs.rmSync(workspace,{recursive:true,force:true});}
});
