'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
test('missing rasterizer hint directs installation through the complete hash lock',()=>{
 let output;vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../../src/cli/doctor.js'),'utf8'),{process:{},console:{log:s=>output=JSON.parse(s)},require:name=>name.endsWith('prerequisites')?{checkPython:()=>({}),python:()=>'/configured/python'}:name.endsWith('helper-paths')?{spawnSync:()=>({status:1})}:{detectRenderer:()=>({available:false})}});
 assert.equal(output.rasterizerAvailable,false);assert.match(output.thumbnailMessage,/--require-hashes -r requirements\.txt/);assert(!/Install pypdfium2==/.test(output.thumbnailMessage));
});

function doctor({python=true,raster=true,renderer=true}={}){
 let output;const proc={};
 vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../../src/cli/doctor.js'),'utf8'),{process:proc,console:{log:s=>output=JSON.parse(s)},require:name=>
  name.endsWith('prerequisites')?{checkPython:()=>{if(!python)throw new Error('python-pptx is required');return {pythonPptx:'1.0.2'};},python:()=>'/configured/python'}:
  name.endsWith('helper-paths')?{spawnSync:()=>raster?{status:0,stdout:'5.13.0\n'}:{status:1}}:
  {detectRenderer:()=>{if(!renderer)throw new Error('LibreOffice is required for PDF/PNG');return {renderer:'libreoffice',png:raster};}}});
 return {output,exitCode:proc.exitCode};
}
test('doctor prints no install commands when every prerequisite is present',()=>{
 const {output,exitCode}=doctor();
 assert.equal(exitCode,undefined);assert.equal(output.rasterizerAvailable,true);
 assert.equal(output.install,undefined,'nothing is missing, so there is nothing to install');assert.equal(output.missing,undefined);
});
test('doctor prints install commands only for what is missing',()=>{
 const noOffice=doctor({renderer:false}).output;
 assert.deepEqual(noOffice.missing,['libreoffice']);
 assert.match(noOffice.install.linux,/apt-get install libreoffice-impress/);assert.doesNotMatch(noOffice.install.linux,/pip|venv/);
 const noRaster=doctor({raster:false}).output;
 assert.deepEqual(noRaster.missing,['python-packages']);
 assert.match(noRaster.install.linux,/--require-hashes -r requirements\.txt/);assert.doesNotMatch(noRaster.install.linux,/libreoffice/i);
 const neither=doctor({python:false,renderer:false}).output;
 assert.deepEqual(neither.missing,['python-packages','libreoffice']);
 for(const platform of ['linux','macos','windows'])assert.match(neither.install[platform],/libre.*;.*venv|venv.*;.*libre/i,platform);
});
