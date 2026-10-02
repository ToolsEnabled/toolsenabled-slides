'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
const runtime=require('../../src/lib/prerequisites').python();
function probe(env){return spawnSync(process.execPath,['-e',`console.log(JSON.stringify(require(${JSON.stringify(path.join(root,'src/lib/prerequisites'))}).checkPython()))`],{encoding:'utf8',env:{PATH:process.env.PATH,...(process.env.SystemRoot?{SystemRoot:process.env.SystemRoot}:{}),SLIDES_PLUGIN_MODE:'1',...env}});}
test('Codex requires the explicit external runtime receipt, with no local or PATH fallback',()=>{
 const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'slides-runtime-contract-'));
 const local=path.join(root,'.venv');let made=false;
 try{
  if(!fs.existsSync(local)){fs.symlinkSync(path.resolve(runtime,'../..'),local,process.platform==='win32'?'junction':'dir');made=true;}
  for(const value of [undefined,'','python3','relative/python','~/runtime/python']){
   const result=probe({SLIDES_WORKSPACE:scratch,...(value===undefined?{}:{SUITE_PYTHON:value})});
   assert.notEqual(result.status,0,`accepted ${value}`);assert.match(result.stderr,/SUITE_PYTHON.*absolute.*setup-runtime/);
  }
  const missing=probe({SLIDES_WORKSPACE:scratch,SUITE_PYTHON:'/usr/bin/python3'});
  assert.notEqual(missing.status,0);assert.match(missing.stderr,/runtime|venv|setup-runtime/);
  assert(!fs.existsSync(path.join(scratch,'unused')));
 }finally{if(made)fs.unlinkSync(local);fs.rmSync(scratch,{recursive:true,force:true});}
});
test('Codex validates and reports the selected runtime receipt before launching',()=>{
 const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'slides-runtime-selected-'));
 try{
  const result=probe({SLIDES_WORKSPACE:scratch,SUITE_PYTHON:runtime});
  assert.equal(result.status,0,result.stderr);const selected=JSON.parse(result.stdout);
  assert.equal(selected.python,runtime);assert.equal(selected.requirementsSha256,require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(root,'requirements.txt'))).digest('hex'));
  assert(!fs.existsSync(path.join(scratch,'unused')));
 }finally{fs.rmSync(scratch,{recursive:true,force:true});}
});
test('scrubbed manifest launch fails without Python forwarding even with a local venv',async()=>{
 const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'slides-runtime-forwarding-'));
 const local=path.join(root,'.venv');let made=false;
 const config=JSON.parse(fs.readFileSync(path.join(root,'.codex-plugin/plugin.json'))).mcpServers.slides;
 const parent={SLIDES_WORKSPACE:path.join(scratch,'deck'),SUITE_PYTHON:runtime,SUITE_PORT:'54937'};
 const env={PATH:process.env.PATH,...(process.env.SystemRoot?{SystemRoot:process.env.SystemRoot}:{}),...config.env};
 for(const key of config.env_vars.filter(key=>key!=='SUITE_PYTHON'))if(parent[key]!==undefined)env[key]=parent[key];
 let client;
 try{
  if(!fs.existsSync(local)){fs.symlinkSync(path.resolve(runtime,'../..'),local,process.platform==='win32'?'junction':'dir');made=true;}
  client=new (require('../helpers/mcp-client').Client)(env,{...config,cwd:root,inheritEnv:false});
  await assert.rejects(client.request('initialize',{}),/SUITE_PYTHON.*absolute.*setup-runtime/);
  assert.equal(await client.exited,1);assert(!fs.existsSync(parent.SLIDES_WORKSPACE));
 }finally{
  if(client){client.child.stdin.end();await client.exited;}
  if(made)fs.unlinkSync(local);fs.rmSync(scratch,{recursive:true,force:true});
 }
});
