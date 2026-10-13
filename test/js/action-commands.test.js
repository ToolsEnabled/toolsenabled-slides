'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),verbs=['new','add','edit','style','import','preview','export','write-notes','media','animate','fix-lint','fit','task'];
test('native actions are explicit model workflows with arguments and the existing control boundaries',()=>{
 for(const verb of verbs){const text=fs.readFileSync(path.join(root,'commands','slides-'+verb+'.md'),'utf8');assert.match(text,/^---\ndescription: .+\nargument-hint:/);assert.equal((text.match(/\$ARGUMENTS/g)||[]).length,1);assert(!/allowed-tools:|permission-mode:|!`/.test(text));assert.match(text,/ppt_show/);assert.match(text,/ppt_locks/);assert.match(text,/ppt_lock/);assert.match(text,/ppt_unlock/);assert.match(text,/human dashboard/);assert.match(text,/Do not use shell/);assert.match(text,/workspace data/);}
 const preview=fs.readFileSync(path.join(root,'commands/slides-preview.md'),'utf8');assert.match(preview,/every slide/);assert.match(preview,/ppt_export/);
 const task=fs.readFileSync(path.join(root,'commands/slides-task.md'),'utf8');assert.match(task,/ppt_tasks/);assert.match(task,/ppt_task_done/);assert.match(task,/leave.*open/);
});
test('help lists every native action and read-only explicit-path Codex equivalent',()=>{
 const commands=require('../../src/lib/view-help.json');assert.equal(commands.length,29);
 for(const verb of verbs){const row=commands.find(c=>c.command.startsWith('/toolsenabled-slides:slides-'+verb+' '));assert(row,verb);assert.match(row.codex,/^\$toolsenabled-slides:toolsenabled-slides /);}
 for(const c of commands.filter(c=>c.command.startsWith('/slides '))){assert.match(c.codex,/^!node "<plugin>\/src\/cli\/view.js"/);if(c.command!=='/slides help'){assert(c.codex.includes('--workspace'));assert(c.codex.includes('--port'));}}
});
test('README, skill and installation docs contain the same complete command table',()=>{
 const rows=require('../../src/lib/view-help.json');
 for(const name of ['README.md','skills/toolsenabled-slides/SKILL.md','docs/CLAUDE-INSTALL.md']){
  const text=fs.readFileSync(path.join(root,name),'utf8');for(const r of rows){assert(text.includes(r.command.replaceAll('|','\\|')),name+' '+r.command);assert(text.includes(r.codex.replaceAll('|','\\|')),name+' '+r.codex);}
  assert(text.includes('output enters the next model turn'));
 }
 const install=fs.readFileSync(path.join(root,'docs/CLAUDE-INSTALL.md'),'utf8');assert(!/coordinator|release handoff/.test(install));
 for(const name of ['README.md','docs/CLAUDE-INSTALL.md']){
  const text=fs.readFileSync(path.join(root,name),'utf8');
  assert(text.includes('Linux tested; native Windows not yet supported'),name+' must state the qualified platform');
  assert(!/On Windows (?:PowerShell|use)|winget install|PowerShell: set|Open the reviewed `.mcpb` in Desktop on macOS or Windows/.test(text),name+' must not present unqualified Windows setup as supported');
 }
 const desktop=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
 const claude=JSON.parse(fs.readFileSync(path.join(root,'.claude-plugin/plugin.json'),'utf8'));
 assert.deepEqual(desktop.compatibility.platforms,['linux']);
 for(const settings of [desktop.user_config,claude.userConfig])assert.match(settings.renderer.description,/Windows.*unsupported/);
});
