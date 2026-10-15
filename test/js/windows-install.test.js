'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path'),{spawnSync}=require('node:child_process');
test('native installer refuses foreign owners and dangerous ancestor ACLs',{skip:process.platform!=='win32'?'native Windows security descriptor fixture':false},()=>{
 const r=spawnSync(path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.resolve(__dirname,'../windows/install-acl.test.ps1')],{encoding:'utf8',timeout:15000});
 assert.equal(r.status,0,r.stdout+r.stderr);assert.match(r.stdout,/WINDOWS_INSTALL_ACL_CASES_PASS 13/);
});

test('installer refuses ambiguous raw spelling before normalization',{skip:process.platform!=='win32'?'native PowerShell path fixture':false},()=>{
 const r=spawnSync(path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.resolve(__dirname,'../windows/install-path.test.ps1')],{encoding:'utf8',timeout:15000});
 assert.equal(r.status,0,r.stdout+r.stderr);assert.match(r.stdout,/RAW_WINDOWS_PATH_CASES_PASS 16/);
});
test('native installer inspects real ACLs, NTFS volume and junction ancestry',{skip:process.platform!=='win32'?'native NTFS/security API fixture':false},()=>{
 const r=spawnSync(path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.resolve(__dirname,'../windows/install-filesystem.test.ps1')],{encoding:'utf8',timeout:30000});
 assert.equal(r.status,0,r.stdout+r.stderr);assert.match(r.stdout,/NATIVE_INSTALL_FILESYSTEM_PASS 11/);
});
