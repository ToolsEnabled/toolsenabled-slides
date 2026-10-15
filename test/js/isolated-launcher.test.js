'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const python=require('../../src/lib/prerequisites').python(),helper=path.resolve(__dirname,'../../src/python/node_child.py');
test('Python pane launcher removes startup hooks before Node starts and preserves literal argv',()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'slides-launch-env-')),marker=path.join(tmp,'loaded'),preload=path.join(tmp,'host.cjs');
 fs.writeFileSync(preload,`require('node:fs').writeFileSync(${JSON.stringify(marker)},'loaded');throw Error('host startup hook ran');`);
 const literal="C:\\deck's folder\\résumé & $(literal).pptx";
 const env={PATH:process.env.PATH,SLIDES_WORKSPACE:literal,...(process.platform==='win32'?{SystemRoot:process.env.SystemRoot}: {})};
 const r=spawnSync(python,['-I','-S','-B',helper,'--environment',JSON.stringify(env),'--',process.execPath,'-e','console.log(JSON.stringify({names:Object.keys(process.env).sort(),arg:process.argv[1]}))',literal],{encoding:'utf8',timeout:15000,env:{...process.env,NODE_OPTIONS:'--require "'+preload.replaceAll('\\','/')+'"',PYTHONPATH:tmp,PYTHONSTARTUP:preload}});
 assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout),{names:Object.keys(env).sort(),arg:literal});assert(!fs.existsSync(marker));
});
test('Python pane launcher refuses inherited credential names in an explicit environment',()=>{
 const r=spawnSync(python,['-I','-S','-B',helper,'--environment',JSON.stringify({SYNTHETIC_HOST_TOKEN:'not-a-token'}),'--',process.execPath,'-e','process.exit(99)'],{encoding:'utf8',timeout:15000});
 assert.equal(r.status,1);assert.match(r.stderr,/not the pane allowlist/);
});
