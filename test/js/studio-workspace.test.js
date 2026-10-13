'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
test('plugin studio validates workspace and Python before creating any directory',()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'slides-studio-path-'));
 try{
  const plugin=path.join(tmp,'plugins/cache/slides/0.1.1');fs.mkdirSync(plugin,{recursive:true});
  fs.cpSync(path.join(__dirname,'../../src'),path.join(plugin,'src'),{recursive:true});
  const cases=[undefined,'','relative-deck','~/deck',path.join(plugin,'deck'),path.dirname(path.dirname(plugin)),path.join(tmp,'new-workspace')];
  for(const value of cases){
   const env={...process.env,SLIDES_PLUGIN_MODE:'1',SUITE_PYTHON:path.join(tmp,'missing-python')};delete env.SLIDES_WORKSPACE;
   if(value!==undefined)env.SLIDES_WORKSPACE=value;
   const before=fs.readdirSync(tmp,{recursive:true}).sort();
   const r=spawnSync(process.execPath,[path.join(plugin,'src/cli/studio.js')],{cwd:tmp,env,encoding:'utf8',timeout:15000});
   assert.equal(r.status,1,`${String(value)} must refuse`);
   assert.deepEqual(fs.readdirSync(tmp,{recursive:true}).sort(),before,`${String(value)} created state before refusal`);
   if(value!==cases.at(-1))assert.match(r.stderr,/SLIDES_WORKSPACE/);
  }
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
