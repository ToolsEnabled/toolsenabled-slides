'use strict';
// test/helpers/mcp-client.js gives the Slides child it starts only the operating-system basics and the suite's own
// SUITE_*/SLIDES_* settings (test/helpers/child-env.js), as README and docs/TESTING.md say: any other variable of the
// developer's environment stays out. This plants a variable that is neither and reads the child's environment names.
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const net=require('node:net');
const {Client}=require('../helpers/mcp-client');
test('the test client starts its Slides child without the rest of the environment',{skip:process.platform!=='linux'&&'reads /proc'},async()=>{
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'slides-client-env-'));const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 process.env.UNRELATED_TEST_CANARY='planted';
 const c=new Client({SLIDES_WORKSPACE:workspace,SUITE_PORT:String(port)});
 try{
  await c.request('initialize',{});
  const names=fs.readFileSync(`/proc/${c.child.pid}/environ`,'utf8').split('\0').filter(Boolean).map(s=>s.slice(0,s.indexOf('=')));
  assert(!names.includes('UNRELATED_TEST_CANARY'),'a variable outside the basics reached the child');
  for(const name of ['PATH','SLIDES_WORKSPACE','SUITE_PORT','SUITE_PYTHON'])assert(names.includes(name),name+' missing: '+names.join(' '));
 }finally{delete process.env.UNRELATED_TEST_CANARY;await c.close();fs.rmSync(workspace,{recursive:true,force:true});}
});
