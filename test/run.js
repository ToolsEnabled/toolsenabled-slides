#!/usr/bin/env node
'use strict';
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const {checkPython,python}=require('../src/lib/prerequisites');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'slides-suite-'));
const suite=path.join(tmp,'suite');
const env={...process.env,SUITE_PYTHON:python(),PYTHONUTF8:'1',PYTHONDONTWRITEBYTECODE:'1'};
for(const key of ['DISPLAY','SLIDES_WORKSPACE','SLIDES_MCP','SUITE_PORT','SUITE_HOST'])delete env[key];
let failures=0;let files=0;
async function run(command,args){
 files++;console.log('\nRUN '+args.join(' '));
 return new Promise(resolve=>{const child=spawn(command,args,{cwd:suite,env,stdio:'inherit'});const timer=setTimeout(()=>{console.error('TEST TIMEOUT');child.kill('SIGKILL');},240000);child.on('error',e=>console.error(e.message));child.on('close',code=>{clearTimeout(timer);if(code!==0)failures++;resolve(code);});});
}
(async()=>{
 checkPython();
 fs.cpSync(root,suite,{recursive:true,filter:p=>!['.git','.venv','node_modules','data','dist','__pycache__','.slides-workspace'].includes(path.basename(p))});
 console.log('DISPLAY absent; isolated fixtures; no provider or model calls.');
 if(await run(env.SUITE_PYTHON,['test/helpers/fixtures.py',suite])!==0)throw new Error('Fixture generation failed');
 const requested=process.argv.slice(2);
 for (const dir of ['js','python']) {
  const folder=path.join(suite,'test',dir);
  for(const file of fs.readdirSync(folder).filter(n=>/\.test\.(js|py)$/.test(n)).sort()) {
   if(!requested.length||requested.includes(file))await run(dir==='python'?env.SUITE_PYTHON:process.execPath,['test/'+dir+'/'+file]);
  }
 }
 if(!requested.length){if(process.platform==='win32'&&process.env.SLIDES_TEST_POWERPOINT_COM==='1')await run('powershell',['-NoProfile','-File','test/windows/export_scripts.test.ps1']);else console.log('WINDOWS ONLY: test/windows/export_scripts.test.ps1 requires explicit SLIDES_TEST_POWERPOINT_COM=1 and an authorized private desktop; see docs/TESTING.md.');}
 console.log(`\nFILES ${files}; FAILED ${failures}; DISPLAY=${env.DISPLAY===undefined?'unset':'set'}`);
 process.exitCode=failures?1:0;
})().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(()=>{
 if(process.env.SLIDES_KEEP_TESTS==='1')console.log('Fixture tree: '+tmp);else fs.rmSync(tmp,{recursive:true,force:true});
});
