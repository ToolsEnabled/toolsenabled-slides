#!/usr/bin/env node
'use strict';
require('./src/lib/bootstrap').start().then(({shutdown})=>{
 require('./src/mcp-ppt');
 process.stdin.once('end',()=>globalThis.slidesMcpSettled().finally(shutdown));
}).catch(error=>{process.stderr.write(error.message+'\n');process.exit(1);});
