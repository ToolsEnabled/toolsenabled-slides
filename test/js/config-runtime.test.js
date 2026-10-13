'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
test('every printed client registration forwards the selected external Python and port',async()=>{
 const {clientConfig}=await import('../../tools/mcp-config.mjs');
 for(const client of ['claude','codex','deepseek','cursor','claude-desktop']){
  const config=clientConfig(client,{root:'/opt/slides',node:'/opt/node',dataDir:'/decks/project',python:'/runtime with space/bin/python',port:'53221'});
  assert(config.includes('SUITE_PYTHON'),client);assert(config.includes('/runtime with space/bin/python'),client);assert(config.includes('53221'),client);
 }
});
test('registration refuses a missing explicit Python with actionable setup guidance',()=>{
 const {spawnSync}=require('node:child_process');const path=require('node:path');
 const env={PATH:process.env.PATH,...(process.env.SystemRoot?{SystemRoot:process.env.SystemRoot}:{})};
 const result=spawnSync(process.execPath,[path.resolve(__dirname,'../../tools/mcp-config.mjs'),'--client','deepseek'],{env,encoding:'utf8'});
 assert.notEqual(result.status,0);assert.equal(result.stdout,'');assert.match(result.stderr,/SUITE_PYTHON.*setup-runtime/);
});
