'use strict';
const {test}=require('node:test');const {childEnv}=require('../helpers/child-env');const assert=require('node:assert/strict');const path=require('node:path');const {spawnSync}=require('node:child_process');

// Reviewed MCP annotations (directory policy P-5E), decided from each handler and the server route it calls.
// [title, readOnlyHint, destructiveHint, idempotentHint, openWorldHint]. A change here must be deliberate.
// Every deck edit bumps the revision, pushes an undo state (dropping the oldest past 50) and clears redo, so all deck
// edits are destructive and none repeats without effect, except deletes, whose repeat is refused (the id is gone).
const PINNED = {
  ppt_show: ['Show deck outline', true, false, true, false],
  ppt_search: ['Search deck text', true, false, true, false],
  ppt_board: ['Read the board', true, false, true, false],
  ppt_lint: ['Check deck quality', true, false, true, false],
  ppt_time: ['Estimate speaking time', true, false, true, false],
  ppt_locks: ['List slide locks', true, false, true, false],
  ppt_task_done: ['Mark task done', false, true, true, false],
  ppt_note: ['Post to the board', false, true, false, false],
  ppt_lock: ['Lock slides', false, true, false, false],
  ppt_unlock: ['Unlock slides', false, true, true, false],
  ppt_set_text: ['Set element text', false, true, false, false],
  ppt_set_bullets: ['Set bullet items', false, true, false, false],
  ppt_set_notes: ['Set speaker notes', false, true, false, false],
  ppt_set_style: ['Set text style', false, true, false, false],
  ppt_set_fill: ['Set fill color', false, true, false, false],
  ppt_set_outline: ['Set outline color', false, true, false, false],
  ppt_set_corners: ['Make corners sharp', false, true, false, false],
  ppt_set_box: ['Move or resize', false, true, false, false],
  ppt_add_shape: ['Add rectangle', false, true, false, false],
  ppt_add_image: ['Add image', false, true, false, false],
  ppt_add_video: ['Add video', false, true, false, false],
  ppt_set_image: ['Replace image', false, true, false, false],
  ppt_set_media: ['Update video', false, true, false, false],
  ppt_set_animation: ['Set animation', false, true, false, false],
  ppt_delete_shape: ['Delete generated object', false, true, true, false],
  ppt_add_slide: ['Add slide', false, true, false, false],
  ppt_delete_slide: ['Delete slide', false, true, true, false],
  ppt_move_slide: ['Move slide', false, true, false, false],
  ppt_set_layout: ['Set slide layout', false, true, false, false],
  ppt_set_transition: ['Set slide transition', false, true, false, false],
  ppt_add_element: ['Add text element', false, true, false, false],
  ppt_delete_element: ['Delete element', false, true, true, false],
  ppt_set_presentation_title: ['Set presentation title', false, true, false, false],
  ppt_tasks: ['Read tasks', true, false, true, false],
  ppt_import: ['Import PPTX', false, true, false, false],
  ppt_export: ['Export deck', false, true, true, false],
  ppt_renderer: ['Check renderer', true, false, true, false],
};

function listTools() {
  const r=spawnSync(process.execPath,[path.resolve(__dirname,'../../src/mcp-ppt.js')],{input:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})+'\n',encoding:'utf8',env:childEnv(),timeout:5000});
  assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout).result.tools;
}

test('every tool the MCP server lists declares title, readOnlyHint and destructiveHint',()=>{
  const tools=listTools();assert.equal(tools.length,37);
  for(const tool of tools){
    const a=tool.annotations;assert.ok(a&&typeof a==='object',`${tool.name} has no annotations`);
    assert.equal(typeof a.title,'string',`${tool.name} lacks a title`);assert.ok(a.title.trim(),`${tool.name} has an empty title`);
    for(const hint of ['readOnlyHint','destructiveHint','idempotentHint','openWorldHint'])assert.equal(typeof a[hint],'boolean',`${tool.name} lacks ${hint}`);
    if(a.readOnlyHint)assert.equal(a.destructiveHint,false,`${tool.name} is read-only and destructive`);
  }
});

test('the 37 tools carry exactly the reviewed annotation values',()=>{
  const tools=listTools();
  assert.deepEqual(tools.map(t=>t.name).sort(),Object.keys(PINNED).sort());
  for(const tool of tools){
    const [title,readOnlyHint,destructiveHint,idempotentHint,openWorldHint]=PINNED[tool.name];
    assert.deepEqual(tool.annotations,{title,readOnlyHint,destructiveHint,idempotentHint,openWorldHint},tool.name);
  }
  const titles=tools.map(t=>t.annotations.title);assert.equal(new Set(titles).size,titles.length,'titles are unique');
});
