'use strict';
// Loads the api() function of src/mcp-ppt.js on its own, with the globals a test supplies (for
// test/js/timeout-recovery.test.js). It reads and evaluates that one source slice and opens no connection itself.
const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../src/mcp-ppt.js'),'utf8');
function apiFunction(globals){return vm.runInNewContext(source.slice(source.indexOf('function api('),source.indexOf('const text ='))+'\napi',globals);}
module.exports={apiFunction};
