#!/usr/bin/env node
'use strict';
const {checkPython,python}=require('../lib/prerequisites');
const {spawnSync}=require('../lib/helper-paths');
const install={
 linux:'sudo apt-get install libreoffice-impress; python3 -m venv .venv; .venv/bin/python -m pip install --require-hashes -r requirements.txt',
 macos:'brew install --cask libreoffice; python3 -m venv .venv; .venv/bin/python -m pip install --require-hashes -r requirements.txt',
 windows:'winget install --id TheDocumentFoundation.LibreOffice --exact; py -m venv .venv; .venv\\Scripts\\python -m pip install --require-hashes -r requirements.txt'
};
const result={install, rasterizer:'pypdfium2', png:false};
try{Object.assign(result,checkPython());}catch(e){result.pythonError=e.message;process.exitCode=1;}
let raster={status:null};
try{raster=spawnSync(python(),['-I','-B','-c','import pypdfium2; from importlib.metadata import version; print(version("pypdfium2"))'],{encoding:'utf8',timeout:10000});}catch(e){result.rasterizerError=e.message;}
result.rasterizerAvailable=raster.status===0;
if(result.rasterizerAvailable)result.rasterizerVersion=raster.stdout.trim();
if(!result.rasterizerAvailable)result.thumbnailMessage='PNG thumbnails unavailable. Install the locked dependencies using the configured Python with -m pip install --require-hashes -r requirements.txt; PDF/PPTX remain available.';
try{Object.assign(result,require('../lib/renderer').detectRenderer());}catch(e){result.rendererError=e.message;process.exitCode=1;}
console.log(JSON.stringify(result,null,2));
