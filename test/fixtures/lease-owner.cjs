'use strict';
// Only this created child's stdin controls its lifetime; no PID recovery.
const path=require('node:path');
const workspace=process.argv[2];
require('../../src/lib/workspace').lease(path.join(workspace,'.slides-state'));
process.stdout.write(JSON.stringify({ready:true,pid:process.pid})+'\n');
process.stdin.resume();
process.stdin.once('end',()=>process.exit(0));
