'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const {spawnSync}=require('node:child_process');const path=require('node:path');const fs=require('node:fs');
test('complete MCP tools/list is frozen and human-only operations are absent',()=>{
 const r=spawnSync(process.execPath,[path.join(__dirname,'../..','src/mcp-ppt.js')],{encoding:'utf8',input:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})+'\n',env:{...process.env,SLIDES_MCP:'1',SUITE_MCP_ROLE:'worker'},timeout:5000});
 assert.equal(r.status,0,r.stderr);const actual=JSON.parse(r.stdout).result;
 assert.deepEqual(actual,JSON.parse(fs.readFileSync(path.join(__dirname,'..','fixtures','tools-list.json'))));
 assert.equal(actual.tools.length,36);assert.ok(!actual.tools.some(t=>/pause|resume|undo|redo/.test(t.name)));
});

function assertNoHumanControls(catalog) {
 const forbidden = /(?:pause|resume|undo|redo|revert|override|force.release|download|pdf.export|save.over|publish|capture|close.deck|open.external)/i;
 for (const tool of catalog.tools) {
  assert.ok(!forbidden.test(tool.name), 'Human action in tools/list: ' + tool.name);
  const properties = tool.inputSchema.properties || {};
  for (const property of Object.keys(properties)) {
   assert.ok(!/^(force|override|trust|session|cookie|launch_token)$/i.test(property), 'Human capability in tool schema: ' + property);
  }
 }
}
test('catalog policy catches human action and override regressions',()=>{
 const catalog = JSON.parse(fs.readFileSync(path.join(__dirname,'..','fixtures','tools-list.json')));
 assertNoHumanControls(catalog);
 for (const name of ['ppt_pause','ppt_resume','ppt_undo','ppt_redo','ppt_lock_override','ppt_force_release','ppt_download','ppt_pdf_export','ppt_save_over_original','ppt_publish','ppt_capture_start','ppt_capture_stop','ppt_close_deck']) {
  assert.throws(()=>assertNoHumanControls({tools:[...catalog.tools,{name,inputSchema:{}}]}));
 }
 assert.throws(()=>assertNoHumanControls({tools:[{name:'ppt_lock',inputSchema:{properties:{force:{type:'boolean'}}}}]}));
});
