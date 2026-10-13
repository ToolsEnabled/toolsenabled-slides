'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const src=fs.readFileSync(path.resolve(__dirname,'../../src/server.js'),'utf8');
const model={rev:1,slides:[{id:'s1',notes:'These are useful speaker notes.',elements:[{id:'e1',text:'Hello',style:{size:24}}]}]};
const {lintModel:lint}=require('../../src/lib/quality');
test('default deck with speaker notes has no implicit personal rule',()=>{const result=lint(model);assert.equal(result.count,0,JSON.stringify(result));});
test('edit feedback does not impose personal notes or dash rules',()=>{const start=src.indexOf('function lintAffected(');const fn=vm.runInNewContext(src.slice(start,src.indexOf('function defaultElements(',start))+'\nlintAffected',{findSlide:id=>model.slides[0],DASH_RE:/[–—]/,LINT_MIN_SIZE:20});const result=fn({slideId:'s1',notes:true});assert.equal(result.length,0);});
test('public descriptions do not impose a personal talk length or slide count',()=>{
 const {spawnSync}=require('node:child_process');const result=spawnSync(process.execPath,[path.resolve(__dirname,'../../src/mcp-ppt.js')],{input:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})+'\n',encoding:'utf8'});assert.equal(result.status,0);assert(!/hard cap|hard 12:00|roughly 16 slide|must stay near/.test(result.stdout));
});
test('fresh board attributes no default instruction to the human',()=>{const start=src.indexOf('function defaultBoard(');const defaults=vm.runInNewContext(src.slice(start,src.indexOf('function persistBoard',start))+'\ndefaultBoard')();assert.equal(defaults.notes.length,0);});
test('style guidance, lint help and labels do not claim unwritten human rules',()=>{
 const {spawnSync}=require('node:child_process');const result=spawnSync(process.execPath,[path.resolve(__dirname,'../../src/mcp-ppt.js')],{input:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})+'\n',encoding:'utf8'});assert.equal(result.status,0);assert(!/HOUSE RULES:|must never go below/.test(result.stdout));
 const help=spawnSync(process.execPath,[path.resolve(__dirname,'../../src/ppt.js'),'help'],{encoding:'utf8'});const line=help.stdout.split('\n').find(s=>s.includes('scan for'));assert(line);assert(!/notes|house-rule/.test(line),line);
 const studio=fs.readFileSync(path.resolve(__dirname,'../../public/studio.js'),'utf8');assert(!/House rules[^\n]*binding/.test(studio));assert(!src.includes('`house-rule:'));
});
test('remaining style copy explains observations and dashboard-only pins',()=>{
 const {spawnSync}=require('node:child_process');
 const catalog=spawnSync(process.execPath,[path.resolve(__dirname,'../../src/mcp-ppt.js')],{input:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})+'\n',encoding:'utf8'});
 assert.equal(catalog.status,0);assert(!catalog.stdout.includes('No em dashes'));
 const help=spawnSync(process.execPath,[path.resolve(__dirname,'../../src/ppt.js'),'help'],{encoding:'utf8'}).stdout;
 assert.match(help.split('\n').find(s=>s.includes('scan for')),/typographic dashes/);
 assert(!help.includes('"house rule" [--as name]'));assert.match(help,/Pin and unpin guidance in the authenticated dashboard/);
 for(const file of ['public/app.js','public/studio.js']){
  const text=fs.readFileSync(path.resolve(__dirname,'../..',file),'utf8');assert(!/every session (?:must|has to) follow/.test(text),file);
 }
});
