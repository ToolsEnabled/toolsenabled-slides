'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../tools/mcp-config.mjs'),'utf8');
const code=source.slice(source.indexOf('const quote ='),source.indexOf('export function'))+'\nquote';
const quote=vm.runInNewContext(code,{process:{platform:'win32'}});
for(const q of "'‘’‚‛")test('PowerShell doubles delimiter U+'+q.charCodeAt(0).toString(16),()=>{const value=`C:/Ann${q}s tools${q}; Write-Output INJECTED; ${q}`;assert.equal(quote(value),"'"+value.split(q).join(q+q)+"'");});
