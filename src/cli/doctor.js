#!/usr/bin/env node
'use strict';
const {checkPython,python}=require('../lib/prerequisites');
const {spawnSync}=require('../lib/helper-paths');
// Install commands, printed only for what is missing.
const steps={
 'python-packages':{linux:'python3 -m venv .venv; .venv/bin/python -m pip install --require-hashes -r requirements.txt',
  macos:'python3 -m venv .venv; .venv/bin/python -m pip install --require-hashes -r requirements.txt',
  windows:'py -m venv .venv; .venv\\Scripts\\python -m pip install --require-hashes -r requirements.txt'},
 libreoffice:{linux:'sudo apt-get install libreoffice-impress',macos:'brew install --cask libreoffice',
  windows:'winget install --id TheDocumentFoundation.LibreOffice --exact'}
};
const result={rasterizer:'pypdfium2', png:false};
try{Object.assign(result,checkPython());}catch(e){result.pythonError=e.message;process.exitCode=1;}
let raster={status:null};
try{raster=spawnSync(python(),['-I','-B','-c','import pypdfium2; from importlib.metadata import version; print(version("pypdfium2"))'],{encoding:'utf8',timeout:10000});}catch(e){result.rasterizerError=e.message;}
result.rasterizerAvailable=raster.status===0;
if(result.rasterizerAvailable)result.rasterizerVersion=raster.stdout.trim();
if(!result.rasterizerAvailable)result.thumbnailMessage='PNG thumbnails unavailable. Install the locked dependencies using the configured Python with -m pip install --require-hashes -r requirements.txt; PDF/PPTX remain available.';
try{Object.assign(result,require('../lib/renderer').detectRenderer());}catch(e){result.rendererError=e.message;process.exitCode=1;}
const missing=[];
if(result.pythonError||!result.rasterizerAvailable)missing.push('python-packages');
if(result.rendererError&&/LibreOffice/.test(result.rendererError))missing.push('libreoffice');
if(missing.length){
 result.missing=missing;
 result.install=Object.fromEntries(['linux','macos','windows'].map(os=>[os,missing.map(m=>steps[m][os]).join('; ')]));
}
console.log(JSON.stringify(result,null,2));
