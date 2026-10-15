'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
test('canonical Windows short-name aliases cannot expose private state',()=>{
 const root='C:\\Work';const fake=Object.create(fs);fake.realpathSync=value=>value;fake.realpathSync.native=value=>value.replace(/SLIDES~1/i,'.slides-state');fake.existsSync=()=>true;fake.lstatSync=()=>({isSymbolicLink:()=>false});fake.statSync=()=>({isFile:()=>true,size:12});
 const box={require:id=>id==='node:fs'?fake:id==='node:path'?path.win32:require(id),module:{exports:{}},process:{platform:'win32'}};
 vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../../src/lib/workspace.js'),'utf8'),box);
 assert.throws(()=>box.module.exports.confined(root,'SLIDES~1/model.json'),/Private workspace/);
 assert.equal(box.module.exports.confined(root,'public.pptx'),'C:\\Work\\public.pptx');
});
test('Windows workspace spelling refuses streams, devices and normalized aliases before filesystem access',()=>{
 let reads=0;const fake=Object.create(fs);fake.realpathSync={native:()=>{reads++;throw Error('must not inspect an unsafe path');}};
 const box={require:id=>id==='node:fs'?fake:id==='node:path'?path.win32:require(id),module:{exports:{}},process:{platform:'win32'}};
 vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../../src/lib/workspace.js'),'utf8'),box);
 for(const value of ['deck.pptx:secret','folder:stream/deck.pptx','NUL.pptx','con','COM1.pptx','LPT9/deck.pptx','trailing./deck.pptx','trailing /deck.pptx','deck.pptx.','deck.pptx ','wild?.pptx','bad<name>.pptx','bad'+String.fromCharCode(1)+'.pptx'])assert.throws(()=>box.module.exports.confined('C:\\Work',value,{write:true}),/Windows, device or stream/);
 assert.equal(reads,0);
});
