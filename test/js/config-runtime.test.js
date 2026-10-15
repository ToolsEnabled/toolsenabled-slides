'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
test('every printed client registration forwards the selected external Python and port',async()=>{
 const {clientConfig}=await import('../../tools/mcp-config.mjs');
 for(const client of ['claude','codex','deepseek','cursor','claude-desktop']){
  const windows=process.platform==='win32',python=windows?'C:/runtime with space/Scripts/python.exe':'/runtime with space/bin/python';
  const config=clientConfig(client,{root:windows?'C:/opt/slides':'/opt/slides',node:windows?'C:/opt/node.exe':'/opt/node',dataDir:windows?'C:/decks/project':'/decks/project',python,port:'53221'});
  assert(config.includes('SUITE_PYTHON'),client);assert(config.includes(python),client);assert(config.includes('53221'),client);
 }
});
test('registration refuses a missing explicit Python with actionable setup guidance',()=>{
 const {spawnSync}=require('node:child_process');const path=require('node:path');
 const env={PATH:process.env.PATH,...(process.env.SystemRoot?{SystemRoot:process.env.SystemRoot}:{})};
 const result=spawnSync(process.execPath,[path.resolve(__dirname,'../../tools/mcp-config.mjs'),'--client','deepseek'],{env,encoding:'utf8'});
 assert.notEqual(result.status,0);assert.equal(result.stdout,'');assert.match(result.stderr,/SUITE_PYTHON.*setup-runtime/);
});
test('registration names node by its PATH entry, not the resolved version-manager target',{skip:process.platform==='win32'?'POSIX symlink':false},async()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const {clientConfig}=await import('../../tools/mcp-config.mjs');
 const bin=fs.mkdtempSync(path.join(os.tmpdir(),'slides-path-node-'));const link=path.join(bin,'node');
 fs.symlinkSync(process.execPath,link);const saved=process.env.PATH;process.env.PATH=bin+path.delimiter+saved;
 try{
  const options={root:'/opt/slides',dataDir:'/decks/project',python:'/runtime/bin/python'};
  assert.ok(clientConfig('claude',options).includes(`-- '${link}' '/opt/slides/slides-mcp.js'`),'claude mcp add names the PATH entry');
  assert.equal(JSON.parse(clientConfig('cursor',options)).mcpServers.slides.command,link);
  process.env.PATH=fs.mkdtempSync(path.join(os.tmpdir(),'slides-no-node-'));
  assert.equal(JSON.parse(clientConfig('cursor',options)).mcpServers.slides.command,process.execPath,'without a PATH entry for this node, the running executable is named');
 }finally{process.env.PATH=saved;fs.rmSync(bin,{recursive:true,force:true});}
});
