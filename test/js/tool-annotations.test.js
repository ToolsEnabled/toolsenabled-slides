'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');const {spawnSync}=require('node:child_process');
test('all 36 tools describe read-only, destructive and local scope accurately',()=>{
 const r=spawnSync(process.execPath,[path.resolve(__dirname,'../../src/mcp-ppt.js')],{input:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})+'\n',encoding:'utf8'});assert.equal(r.status,0,r.stderr);const tools=JSON.parse(r.stdout).result.tools;assert.equal(tools.length,36);
 const reads=new Set(['ppt_show','ppt_search','ppt_board','ppt_lint','ppt_time','ppt_locks','ppt_renderer']);const additive=new Set(['ppt_note','ppt_add_slide','ppt_add_element','ppt_add_image','ppt_add_shape','ppt_add_video','ppt_export','ppt_lock','ppt_unlock','ppt_task_done']);
 for(const tool of tools){assert(tool.annotations,tool.name);assert.equal(tool.annotations.readOnlyHint,reads.has(tool.name),tool.name);assert.equal(tool.annotations.openWorldHint,false,tool.name);assert.equal(tool.annotations.destructiveHint,!reads.has(tool.name)&&!additive.has(tool.name),tool.name);}
});
