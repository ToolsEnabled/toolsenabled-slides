'use strict';
const {spawnSync}=require('./helper-paths');
const fs=require('node:fs');
const path=require('node:path');
function python(){
 if(process.env.SLIDES_PLUGIN_MODE==='1'){
  const value=process.env.SUITE_PYTHON;
  if(!require('./helper-paths').absolutePath(value))throw new Error('SUITE_PYTHON must be an absolute external venv interpreter; use tools/setup-runtime.py for explicit offline setup');
  return require('./helper-paths').resolveExecutable(value);
 }
 const local=path.join(__dirname,'..','..','.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
 return require('./helper-paths').resolveExecutable(process.env.SUITE_PYTHON || (fs.existsSync(local)?local:(process.platform==='win32'?'python':'python3')));
}
function checkPython(){
 if(process.env.SLIDES_PLUGIN_MODE==='1'){
  if(Number(process.versions.node.split('.')[0])<22)throw new Error('Node.js 22 or newer is required');
  const selected=python();
  const result=spawnSync(selected,['-I','-B',path.join(__dirname,'../python/runtime_contract.py'),'--node',process.execPath,'--workspace',process.env.SLIDES_WORKSPACE||''],{encoding:'utf8',timeout:15000,windowsHide:true,maxBuffer:8192});
  if(result.status!==0)throw new Error('Prepared runtime check failed: '+String(result.stderr||result.error||'unknown error').trim()+'; use tools/setup-runtime.py');
  return JSON.parse(result.stdout);
 }
 const r=spawnSync(python(),['-I','-c','import pptx; print(pptx.__version__)'],{encoding:'utf8',timeout:10000,windowsHide:true,maxBuffer:4096});
 if(r.status!==0)throw new Error('python-pptx is required. Prepare an external runtime with tools/setup-runtime.py and set SUITE_PYTHON to its absolute interpreter path.');
 return {python:python(),pythonPptx:r.stdout.trim()};
}
module.exports={python,checkPython};
