'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
test('all parser dependencies are version and hash locked and install commands enforce hashes',()=>{
 const root=path.resolve(__dirname,'../..');const requirements=fs.readFileSync(path.join(root,'requirements.txt'),'utf8');
 const blocks=requirements.replace(/\\\r?\n/g,' ').split('\n').filter(s=>s.trim()&&!s.startsWith('#'));
 for(const name of ['python-pptx','pypdfium2','pillow','lxml','xlsxwriter','typing-extensions']){const row=blocks.find(s=>s.toLowerCase().replaceAll('_','-').startsWith(name+'=='));assert(row,name+' not pinned');assert(/--hash=sha256:[a-f0-9]{64}/.test(row),name+' has no hash');}
 const readme=fs.readFileSync(path.join(root,'README.md'),'utf8');for(const line of readme.split('\n').filter(s=>s.includes('pip install')))assert(line.includes('--require-hashes'),line);
});
