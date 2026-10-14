'use strict';
// The ppt CLI (package.json "bin") talks only to a Slides server on this computer, as src/server.js binds only to
// loopback, and when no server answers it names the start command that exists in this release.
const {test}=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');const net=require('node:net');const {spawnSync}=require('node:child_process');
const {childEnv}=require('../helpers/child-env');
const ppt=path.resolve(__dirname,'../../src/ppt.js');
const run=(settings)=>spawnSync(process.execPath,[ppt,'show'],{env:childEnv({NO_COLOR:'1',SUITE_EDITOR:'host-test',SUITE_HTTP_TIMEOUT_MS:'1000',...settings}),encoding:'utf8',timeout:20000});
async function closedPort(){const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));return port;}
// 192.0.2.0/24 and 198.51.100.0/24 are documentation addresses that nothing answers.
test('a SUITE_HOST other than loopback is refused before any connection',async()=>{
 for(const host of ['192.0.2.10','198.51.100.7']){
  const r=run({SUITE_HOST:host,SUITE_PORT:String(await closedPort())});
  assert.equal(r.status,2,r.stderr);assert.match(r.stderr,new RegExp(`SUITE_HOST is ${host.replaceAll('.','\\.')}: the ppt CLI connects only to a Slides server on this computer`));
 }
});
test('with no server answering, the hint names the persistent studio command of this release',async()=>{
 const r=run({SUITE_PORT:String(await closedPort())});
 assert.equal(r.status,2,r.stderr);assert.match(r.stderr,/suite server not reachable/);assert.match(r.stderr,/node src\/cli\/studio\.js/);assert.doesNotMatch(r.stderr,/suite\/server\.js|npm start/);
});
