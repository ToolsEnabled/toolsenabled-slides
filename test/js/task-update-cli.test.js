'use strict';
const SUITE_ROOT = require('node:path').resolve(__dirname, '../..');
const {test} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const {spawn} = require('node:child_process');

test('task CLI sends record updates and rejects removed wake controls', async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => raw += c);
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      seen.push({path:req.url, body});
      res.setHeader('Content-Type','application/json');
      res.end(JSON.stringify({ok:true, task:{id:'t1', assignee:body.assignee || '', text:body.text || ''}}));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  async function cli(args) {
    const c = spawn(process.execPath, [path.join(SUITE_ROOT, 'src/ppt.js'), ...args], {
      env:{...process.env, SUITE_PORT:String(port), SUITE_EDITOR:'cli-client'}, stdio:['ignore','pipe','pipe'],
    });
    let out = ''; c.stdout.on('data', x => out += x); c.stderr.on('data', x => out += x);
    const timer = setTimeout(() => c.kill('SIGKILL'), 5000);
    const code = await new Promise(r => c.once('exit',r)); clearTimeout(timer);
    return {code,out};
  }
  try {
    const updated = await cli(['task-update','t1','--text','Review slide s1','--for','mcp-reviewer']);
    assert.equal(updated.code,0,updated.out);
    assert.deepEqual(seen.find(r => r.path === '/api/tasks/update').body,
      {id:'t1',by:'cli-client',text:'Review slide s1',assignee:'mcp-reviewer'});
    const unassigned = await cli(['task-update','t1','--unassign']);
    assert.equal(unassigned.code,0,unassigned.out);
    assert.equal(seen.filter(r => r.path === '/api/tasks/update').at(-1).body.assignee,'');
    for (const args of [['task-update','t1','--wake','true'],['task-hold','t1'],['task-wake','t1'],['profile'],['provider'],['spend'],['chat','start']]) {
      const before = seen.filter(r => r.path !== '/api/health' && r.path !== '/api/heartbeat').length;
      assert.notEqual((await cli(args)).code,0,args.join(' '));
      assert.equal(seen.filter(r => r.path !== '/api/health' && r.path !== '/api/heartbeat').length,before);
    }
  } finally {await new Promise(r => server.close(r));}
});
