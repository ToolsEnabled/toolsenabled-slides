'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const {spawnSync}=require('node:child_process');const vm=require('node:vm');
const root=path.resolve(__dirname,'../..');
test('Python prerequisite probe ignores modules planted in the caller workspace',()=>{
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'slides-planted-'));fs.writeFileSync(path.join(workspace,'pptx.py'),'raise Exception("PLANTED_WORKSPACE_CODE")\n');
 try{const r=spawnSync(process.execPath,['-e',`require(${JSON.stringify(path.join(root,'src/lib/prerequisites.js'))}).checkPython()`],{cwd:workspace,env:{...process.env,SUITE_PYTHON:process.env.SUITE_PYTHON||path.join(root,'.venv/bin/python'),SLIDES_WORKSPACE:workspace},encoding:'utf8'});assert.equal(r.status,0,r.stderr);}finally{fs.rmSync(workspace,{recursive:true,force:true});}
});
test('Windows helpers use System32 even with workspace first on PATH',()=>{
 const helpers=require('../../src/lib/helper-paths');
 const source=fs.readFileSync(require.resolve('../../src/lib/helper-paths'),'utf8');const box={require:id=>id==='node:path'?path.win32:require(id),module:{exports:{}},__dirname:'C:\\Install\\src\\lib',process:{platform:'win32',env:{SystemRoot:'C:\\Windows',PATH:'C:\\Work;C:\\Windows\\System32',SLIDES_WORKSPACE:'C:\\Work'},cwd:()=> 'C:\\Work'}};vm.runInNewContext(source,box);
 for(const [name,suffix] of [['attrib','attrib.exe'],['taskkill','taskkill.exe'],['powershell','WindowsPowerShell\\v1.0\\powershell.exe']])assert.equal(box.module.exports.systemHelper(name),'C:\\Windows\\System32\\'+suffix);
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'slides-path-'));const work=path.join(tmp,'work');fs.mkdirSync(work);fs.writeFileSync(path.join(work,'python3'),'planted');fs.chmodSync(path.join(work,'python3'),0o755);
 const prior={...process.env};try{process.env.SLIDES_WORKSPACE=work;process.env.PATH=work;assert.throws(()=>helpers.resolveExecutable('python3'),/trusted|workspace|executable/i);}finally{process.env=prior;fs.rmSync(tmp,{recursive:true,force:true});}
});
