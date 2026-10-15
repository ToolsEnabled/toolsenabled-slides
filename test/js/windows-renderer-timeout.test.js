'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{spawnSync}=require('node:child_process');
test('native renderer deadline, in-flight EOF and owner death join retained root and detached descendant identities',{skip:process.platform!=='win32'?'native Windows renderer counterpart; run on Windows before qualification':false},()=>{
 const r=spawnSync(path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.resolve(__dirname,'../windows/renderer-timeout.test.ps1'),'-NodeExecutable',process.execPath],{encoding:'utf8',timeout:110000});
 assert.equal(r.status,0,r.error?.message||r.stdout+r.stderr);assert.match(r.stdout,/NATIVE_RENDERER_CUSTODY_PASS 4/);
});
