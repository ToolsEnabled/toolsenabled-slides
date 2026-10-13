'use strict';
// Font lint reads presentation.pptx. Right after an edit that file still has the previous slide order, so lint must
// not report its findings against the new order and revision.
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const net=require('node:net');
const {Client}=require('../helpers/mcp-client');const {python}=require('../../src/lib/prerequisites');
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const n=s.address().port;await new Promise(r=>s.close(r));return n;}
const get=(port,route)=>fetch(`http://127.0.0.1:${port}${route}`).then(r=>r.json());
async function rendered(port,rev){
 const deadline=Date.now()+90000;let last;
 while(Date.now()<deadline){last=await get(port,'/api/health').catch(()=>null);if(last&&last.presentation&&last.presentation.current&&last.presentation.rev===rev)return;await new Promise(r=>setTimeout(r,100));}
 throw new Error('render did not publish rev '+rev+': '+JSON.stringify(last));
}

test('lint right after a slide move reports font lint as pending instead of blaming the wrong slide',async()=>{
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'slides-lint-pending-'));const port=await freePort();let client;
 try{
  client=new Client({SLIDES_WORKSPACE:workspace,SUITE_PORT:String(port),SUITE_PYTHON:python()});await client.request('initialize',{});
  await client.tool('ppt_lock',{slide_ids:['s1']});
  await client.tool('ppt_set_text',{slide_id:'s1',element_id:'e1',text:'Quarterly update'});
  await client.tool('ppt_set_text',{slide_id:'s1',element_id:'e2',text:'Prepared for the team'});
  await client.tool('ppt_add_slide',{title:'Odd font slide'});
  let state=await get(port,'/api/state');const odd=state.model.slides[1];const title=odd.elements.find(e=>e.type==='title');
  await client.tool('ppt_lock',{slide_ids:[odd.id]});
  await client.tool('ppt_set_style',{slide_id:odd.id,element_id:title.id,font:'Courier New'});
  state=await get(port,'/api/state');await rendered(port,state.rev);
  const settled=await get(port,'/api/lint');
  assert.deepEqual(settled.issues.filter(i=>i.type==='font-family').map(i=>i.slideId),[odd.id],'baseline: the odd font is on the added slide');
  await client.tool('ppt_move_slide',{slide_id:odd.id,index:0});
  const moved=await get(port,'/api/state');
  const early=await get(port,'/api/lint');
  assert.equal(early.rev,moved.rev);
  assert.deepEqual(early.issues.filter(i=>i.type==='font-family').map(i=>i.slideId),[],'font findings from the previous file must not be mapped onto the new slide order: '+JSON.stringify(early.issues));
  assert.ok(early.issues.some(i=>i.type==='font-lint-pending'&&/Font lint waits for the render of rev \d+/.test(i.detail)),JSON.stringify(early.issues));
  assert.equal((await get(port,'/api/lint?cached=1')).cached,false,'a pending result is not cached');
  await rendered(port,moved.rev);
  const after=await get(port,'/api/lint');
  assert.deepEqual(after.issues.filter(i=>i.type==='font-family').map(i=>i.slideId),[odd.id],'after the render the finding is on the right slide');
  assert.ok(!after.issues.some(i=>i.type==='font-lint-pending'));
 }finally{if(client)await client.close().catch(()=>client.child.kill('SIGKILL'));fs.rmSync(workspace,{recursive:true,force:true});}
});
