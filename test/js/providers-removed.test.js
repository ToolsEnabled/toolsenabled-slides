'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const {Client} = require('../helpers/mcp-client');
const {python} = require('../../src/lib/prerequisites');
const root = path.resolve(__dirname, '../..');

test('the product has no built-in provider implementation or enable flag', () => {
  for (const name of ['agents.js','codex-agent.js','board-hook.js','ppt-guard.js']) {
    assert.equal(fs.existsSync(path.join(root, name)), false, name);
  }
  for (const name of ['src/server.js','src/ppt.js','src/mcp-ppt.js','src/lib/bootstrap.js','public/studio.js','README.md']) {
    const source = fs.readFileSync(path.join(root, name), 'utf8');
    assert.doesNotMatch(source, /SUITE_ENABLE_AGENTS|\/api\/agents|\/api\/spend|usageProfile|spawnOrWrite|ensureLead|wakeWorker/, name);
  }
});

test('MCP clients complete only their own tasks without a provider', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'slides-tasks-'));
  const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r));
  const port = s.address().port; await new Promise(r => s.close(r));
  const origin = `http://127.0.0.1:${port}`;
  const c = new Client({SLIDES_WORKSPACE:workspace, SUITE_PORT:String(port), SUITE_PYTHON:python()});
  try {
    await c.request('initialize', {});
    const launch = c.stderr.match(/http:\/\/[^\s]+\/studio#launch=[a-f0-9]{64}/)[0];
    const auth = await require('../helpers/dashboard').redeem(launch);
    const post = async (route, body) => {
      const r = await fetch(origin + route, {method:'POST', headers:{...auth, 'Content-Type':'application/json'}, body:JSON.stringify(body)});
      return {status:r.status, body:await r.json()};
    };
    const other = await post('/api/tasks', {text:'Review another client’s slide', assignee:'mcp-another', by:'human'});
    assert.equal(other.status, 200);
    const denied = await c.request('tools/call', {name:'ppt_task_done', arguments:{id:other.body.task.id}});
    assert.equal(denied.isError, true, 'one client must not finish another client’s assignment');
    const mine = await post('/api/tasks', {text:'Review the slide', assignee:'mcp-' + c.child.pid, by:'human'});
    assert.equal(mine.status, 200);
    assert.equal(Object.hasOwn(mine.body.task, 'wakeWorker'), false);
    await c.tool('ppt_task_done', {id:mine.body.task.id});
    for (const route of ['/api/agents','/api/agents/profile','/api/agents/fast-mode','/api/spend']) {
      assert.equal((await fetch(origin + route, {headers:{...auth}})).status, 404, route);
    }
    for (const route of ['/api/chat','/api/agents/provider','/api/agents/stop','/api/spend/reset','/api/loops/runner']) {
      assert.equal((await post(route, {})).status, 404, route);
    }
    const state = await (await fetch(origin + '/api/state')).json();
    for (const key of ['agents','profile','spend','loopRunner','presence']) assert.equal(Object.hasOwn(state, key), false, key);
    await c.close();
  } finally {
    if (c.child.exitCode === null) { c.child.kill('SIGTERM'); await c.exited; }
    fs.rmSync(workspace, {recursive:true, force:true});
  }
});
