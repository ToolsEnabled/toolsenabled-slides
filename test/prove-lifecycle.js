#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const net=require('node:net');const {spawnSync}=require('node:child_process');
const {Client,assertProcessExited}=require('./helpers/mcp-client');
const {python,checkPython}=require('../src/lib/prerequisites');
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));return port;}
async function proof(output,{pptxOnly=false,runtimePython}={}){
 checkPython();
 if(!pptxOnly){const d=require('../src/lib/renderer').detectRenderer();assert.equal(d.renderer,'libreoffice');assert.ok(d.png,'pypdfium2 required');}
 fs.mkdirSync(output,{recursive:true});
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'slides-lifecycle-'));const port=await freePort();
 const env={SLIDES_WORKSPACE:workspace,SUITE_PORT:String(port),SLIDES_RENDERER:'libreoffice',SUITE_PYTHON:python()};
 const launch=runtimePython?{command:runtimePython,args:['-I',path.resolve(__dirname,'../src/python/mcp_launcher.py'),'--node',process.execPath,'--workspace',workspace,'--port',String(port)]}:undefined;
 const client=new Client(env,launch);const transcript=[];
 const tool=async(name,args={})=>{const text=await client.tool(name,args);transcript.push({name,args,result:text});return text;};
 let attached;
 try{
  const init=await client.request('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'offline-lifecycle-proof',version:'1'}});assert.ok(init.capabilities.tools);
  const listed=await client.request('tools/list',{});assert.deepEqual(listed,JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures','tools-list.json'))));
  assert.ok(!listed.tools.some(t=>/pause|resume|undo|redo/.test(t.name)));
  const denied=await client.request('tools/call',{name:'ppt_set_text',arguments:{slide_id:'s1',element_id:'e1',text:'Missing lock'}});assert.ok(denied.isError);assert.match(denied.content[0].text,/Lock/);
  await tool('ppt_show');await tool('ppt_board');await tool('ppt_lock',{slide_ids:['s1']});
  await tool('ppt_set_presentation_title',{text:'A clear plan'});
  await tool('ppt_set_text',{slide_id:'s1',element_id:'e1',text:'A clear plan'});
  await tool('ppt_set_text',{slide_id:'s1',element_id:'e2',text:'Evidence. Decisions. Next steps.'});
  const ids=['s1'];
  for(const title of ['What we learned','What happens next']){
   const result=await tool('ppt_add_slide',{title,layout:'content'});const id=result.match(/Added slide (\S+)/)[1];ids.push(id);
   await tool('ppt_lock',{slide_ids:[id]});
   const outline=await tool('ppt_show',{slide:id});
   const element=outline.match(/^\s+(\S+) bullets /m);assert.ok(element,outline);
   await tool('ppt_set_bullets',{slide_id:id,element_id:element[1],items:title==='What we learned'?['One shared goal','A measurable result']:['Assign an owner','Set a date','Review the evidence']});
  }
  const state=await (await fetch(`http://127.0.0.1:${port}/api/state`)).json();assert.equal(state.model.slides.length,3);
  const pid=(await (await fetch(`http://127.0.0.1:${port}/api/health`)).json()).pid;
  attached=new Client(env,launch);await attached.request('initialize',{});await attached.close();attached=null;
  assert.ok((await fetch(`http://127.0.0.1:${port}/api/health`)).ok,'attached client must leave server alive');
  const pptx=JSON.parse(await tool('ppt_export',{path:'proof.pptx',format:'pptx'}));assert.equal(pptx.renderer,'python-pptx');
  const exports=[pptx];
  if(!pptxOnly){
   const pdf=JSON.parse(await tool('ppt_export',{path:'proof.pdf',format:'pdf'}));assert.equal(pdf.renderer,'libreoffice');exports.push(pdf);
   const png=JSON.parse(await tool('ppt_export',{path:'proof-pages',format:'png'}));assert.equal(png.files.length,3);assert.equal(png.renderer,'libreoffice');exports.push(png);
   assert.equal(fs.readFileSync(path.join(workspace,'proof.pdf')).subarray(0,5).toString(),'%PDF-');
  }
  const verify=spawnSync(python(),['-c','from pptx import Presentation; import sys; p=Presentation(sys.argv[1]); assert len(p.slides)==3; assert p.slides[0].shapes.title.text=="A clear plan"',path.join(workspace,'proof.pptx')],{encoding:'utf8'});assert.equal(verify.status,0,verify.stderr);
  const imported=JSON.parse(await tool('ppt_import',{path:'proof.pptx'}));assert.equal(imported.slides,3);
  await tool('ppt_show');
  await client.close();
  await assertProcessExited(pid);assert.equal(fs.existsSync(path.join(workspace,'.slides-state','server.lock')),false);
  for(const e of exports)for(const file of e.files){const dest=path.join(output,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(workspace,file),dest);}
  const report={ok:true,node:process.version,platform:process.platform,display:process.env.DISPLAY||null,mode:pptxOnly?'pptx-only':'libreoffice',runtimePython:runtimePython||null,slides:3,tools:listed.tools.length,serverPid:pid,checks:['initialize','golden tools/list','locks required','3-slide MCP editing','attach and detach','real exports','import','EOF shutdown','lease released'],exports,transcript};
  fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify(report,null,2)+'\n');fs.writeFileSync(path.join(output,'stderr.log'),client.stderr);return report;
 }finally{if(attached&&attached.child.exitCode===null)attached.child.kill('SIGTERM');if(client.child.exitCode===null)client.child.kill('SIGTERM');fs.rmSync(workspace,{recursive:true,force:true});}
}
module.exports={proof};
if(require.main===module){const i=process.argv.indexOf('--output');if(i<0||!process.argv[i+1]){console.error('Usage: node test/prove-lifecycle.js --output <new evidence directory> [--pptx-only]');process.exit(2);}
 const runtimeIndex=process.argv.indexOf('--runtime-python');
 proof(path.resolve(process.argv[i+1]),{pptxOnly:process.argv.includes('--pptx-only'),runtimePython:runtimeIndex<0?undefined:process.argv[runtimeIndex+1]}).then(r=>console.log(JSON.stringify({ok:r.ok,slides:r.slides,mode:r.mode}))).catch(e=>{console.error(e.stack);process.exitCode=1;});}
