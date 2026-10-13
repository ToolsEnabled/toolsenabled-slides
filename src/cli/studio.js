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
 require('../server');
}
catch(e){console.error(e.message);process.exitCode=1;}
