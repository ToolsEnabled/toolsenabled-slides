'use strict';
// The plugin directory's credential check holds a file that spells a remote-looking address and also hands the
// environment, a cookie or a key to something. The files listed below did both, although every address they spelled
// was this machine's own loopback server, a pattern that finds the startup link, or a reserved placeholder, and nothing
// in them sends anything off the machine. Their addresses now live in small files that read nothing (README: "Tests and
// the credential checks"). This pins that split, and the CLI hint that read like the `pass` password manager.
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'../..');const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const LOOPBACK=new Set(['127.0.0.1','localhost','[::1]']);
// A scheme and two slashes (also as written escaped inside a regular expression), then the host as spelled.
const ADDRESS=/\b(?:http|https|ws|wss):\\?\/\\?\/([^\s'"`<>()\]\/:]*)/g;
const hosts=text=>[...text.matchAll(ADDRESS)].map(m=>m[1]).filter(host=>!LOOPBACK.has(host));
test('files that hand on the environment or handle a cookie spell no address but loopback',()=>{
 for(const name of ['src/server.js','src/ppt.js','src/lib/dashboard-session.js','test/js/security.test.js','test/js/board-human-capacity.test.js','test/js/codex-dashboard-route.test.js','test/js/swarm-locks-selectors.test.js'])assert.deepEqual(hosts(read(name)),[],name);
});
test('the files that spell those addresses now read no environment, cookie or key and start no program',()=>{
 for(const name of ['src/lib/origins.js','test/fixtures/foreign-requests.json','test/helpers/external_link_deck.py']){
  assert(hosts(read(name)).length>0,name+' holds the moved addresses');
  assert(!/process\.env|\benviron\b|\bspawn|\bexec|subprocess|cookie|\bkey\b|token/i.test(read(name)),name);
 }
 assert.deepEqual(hosts(read('test/helpers/dashboard.js')),['[^\\s'],'the dashboard helper holds the one startup-link pattern');
});
test('the tests the directory listed give their children only the basic environment',()=>{
 for(const name of ['test/js/security.test.js','test/js/board-human-capacity.test.js','test/js/codex-dashboard-route.test.js','test/js/swarm-locks-selectors.test.js'])assert(!/process\.env/.test(read(name)),name+' hands on the whole environment');
 assert.match(read('test/helpers/mcp-client.js'),/inheritEnv===false\?\{\}:childEnv\(\)/,'the test client starts from the basic environment');
});
test('no source file tells the reader to "pass" a flag',()=>{
 for(const name of ['src/ppt.js','src/server.js','src/mcp-ppt.js','src/cli/view.js','src/cli/doctor.js','src/cli/studio.js'])assert(!/\bpass\s+--/.test(read(name)),name);
});
