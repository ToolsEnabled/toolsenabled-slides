#!/usr/bin/env node
'use strict';
// Start a persistent human-facing suite. MCP clients may attach and detach.
const path=require('node:path');const fs=require('node:fs');
try{
 const p=require('../lib/prerequisites');
 process.env.SLIDES_WORKSPACE=process.env.SLIDES_PLUGIN_MODE==='1'
  ? require('../lib/bootstrap').pluginWorkspace(process.env.SLIDES_WORKSPACE)
  : path.resolve(process.env.SLIDES_WORKSPACE||path.join(process.cwd(),'slides-workspace'));
 p.checkPython();
 process.env.SUITE_PYTHON=p.python();
 fs.mkdirSync(process.env.SLIDES_WORKSPACE,{recursive:true,mode:0o700});
 process.env.SLIDES_WORKSPACE=fs.realpathSync(process.env.SLIDES_WORKSPACE);
 if(process.platform==='win32'){
  // The persistent studio owns this private pipe independently of attached MCPs.
  const child=require('node:child_process').spawn(p.python(),['-I','-S','-B',path.resolve(__dirname,'../python/node_child.py'),'--inherit-environment','--',process.execPath,path.resolve(__dirname,'../server.js')],{cwd:path.resolve(__dirname,'../..'),env:{...process.env,SLIDES_OWNER_STDIN:'1'},stdio:['pipe','inherit','inherit'],windowsHide:true});
  child.stdin.on('error',()=>{});
  let timer;
  const stop=()=>{if(!timer){child.stdin.end();timer=setTimeout(()=>child.kill('SIGKILL'),10000);}};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  child.once('error',error=>{console.error(error.message);process.exitCode=1;});
  child.once('close',code=>{if(timer)clearTimeout(timer);process.exitCode=code===0?0:1;});
 }else require('../server');
}
catch(e){console.error(e.message);process.exitCode=1;}
