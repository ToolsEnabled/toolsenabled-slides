'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
test('missing rasterizer hint directs installation through the complete hash lock',()=>{
 let output;vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../../src/cli/doctor.js'),'utf8'),{process:{},console:{log:s=>output=JSON.parse(s)},require:name=>name.endsWith('prerequisites')?{checkPython:()=>({}),python:()=>'/configured/python'}:name.endsWith('helper-paths')?{spawnSync:()=>({status:1})}:{detectRenderer:()=>({available:false})}});
 assert.equal(output.rasterizerAvailable,false);assert.match(output.thumbnailMessage,/--require-hashes -r requirements\.txt/);assert(!/Install pypdfium2==/.test(output.thumbnailMessage));
});
