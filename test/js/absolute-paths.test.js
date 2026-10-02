'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {absolutePath}=require('../../src/lib/helper-paths');
test('Windows configured paths require a drive-qualified or UNC root',()=>{
 for(const value of ['/deck','\\deck','C:deck','~','~/deck','relative',''])assert.equal(absolutePath(value,'win32'),false,value);
 for(const value of ['C:\\deck','C:/deck','\\\\server\\share\\deck'])assert.equal(absolutePath(value,'win32'),true,value);
});
