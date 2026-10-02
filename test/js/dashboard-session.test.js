'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const {Client} = require('../helpers/mcp-client');
const {python} = require('../../src/lib/prerequisites');

async function freePort() {
  const s = net.createServer();
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  const p = s.address().port;
  await new Promise(r => s.close(r));
  return p;
}

test('human controls require a one-time dashboard session', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'slides-dashboard-'));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const c = new Client({SLIDES_WORKSPACE:workspace, SUITE_PORT:String(port), SUITE_PYTHON:python()});
  const post = (route, body = {}, auth = {}) => fetch(origin + route, {
    method:'POST', headers:{Origin:origin, 'Content-Type':'application/json', ...auth},
    body:JSON.stringify(body), redirect:'manual',
  });
  try {
    await c.request('initialize', {});
    const humanRoutes = ['pause', 'resume', 'undo', 'redo', 'pdf/export', 'render',
      'object-history/restore', 'object-history/undo-restore', 'protections/toggle',
      'tasks/protection-grant', 'board/pin', 'board/delete',
      'tasks', 'tasks/update', 'tasks/delete', 'loops', 'loops/toggle', 'loops/delete'];
    for (const route of humanRoutes) {
      const response = await post('/api/' + route, {by:'human', editor:'human'});
      assert.equal(response.status, 403, route);
      assert.match(await response.text(), /dashboard session/i);
    }
    assert.equal((await post('/api/locks', {by:'human', slideIds:['s1'], force:true})).status, 403);
    for (const route of ['/api/pptx', '/api/pdf']) assert.equal((await fetch(origin + route)).status, 403);
    assert.equal((await post('/api/board', {author:'human', text:'rule', pinned:true})).status, 403);
    const launch = c.stderr.match(/http:\/\/[^\s]+\/studio#launch=[a-f0-9]{64}/)?.[0];
    assert.ok(launch, 'startup prints the one-time launch URL only on stderr');
    const token = new URLSearchParams(new URL(launch).hash.slice(1)).get('launch');
    for (const route of ['/studio', '/', '/api/state', '/api/health']) {
      const response = await fetch(origin + route);
      assert.equal(response.headers.get('set-cookie'), null);
      assert.ok(!(await response.text()).includes(token), route + ' must not expose a launch token');
    }
    assert.equal((await post('/api/dashboard/session', {launchToken:'wrong'})).status, 403);
    const noOrigin = await fetch(origin + '/api/dashboard/session', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({launchToken:token})});
    assert.equal(noOrigin.status, 403);
    const redeemed = await post('/api/dashboard/session', {launchToken:token});
    assert.equal(redeemed.status, 200);
    const header = redeemed.headers.get('set-cookie');
    assert.match(header, /HttpOnly/i);
    assert.match(header, /SameSite=Strict/i);
    assert.doesNotMatch(header, /Domain=/i);
    const cookie = header.split(';')[0];
    const session = (await redeemed.json()).token;
    assert.match(session, /^[a-f0-9]{64}$/);
    assert.ok(!cookie.includes(session), 'cookie must not contain the header capability');
    const auth = {Cookie:cookie, 'X-Slides-Session':session};
    assert.equal((await post('/api/dashboard/session', {launchToken:token})).status, 403, 'launch secret is single-use');
    for (const route of humanRoutes) {
      assert.equal((await post('/api/' + route, {by:'human', editor:'human'}, {Cookie:cookie})).status, 403, 'cookie-only ' + route);
    }
    for (const route of ['/api/pptx','/api/pdf']) assert.equal((await fetch(origin + route, {headers:{Cookie:cookie}})).status, 403);
    for (const route of ['/studio','/','/api/state','/api/health','/api/dashboard/session']) {
      const response = await fetch(origin + route, {headers:{Cookie:cookie}});
      const text = await response.text();
      assert.ok(!text.includes(token) && !text.includes(session), route + ' must not return secrets');
    }
    assert.equal((await post('/api/pause', {by:'human'}, auth)).status, 200);
    assert.equal((await post('/api/resume', {by:'human'}, auth)).status, 200);
    assert.equal((await post('/api/pause', {by:'human'}, {...auth, 'X-Slides-Session':'f'.repeat(64)})).status, 403);
    assert.equal((await post('/api/pause', {by:'human'}, {...auth, Cookie:cookie + 'tampered'})).status, 403);
    for (const Origin of ['https://example.invalid', origin.replace(String(port), String(port+1))]) {
      assert.equal((await post('/api/pause', {by:'human'}, {...auth, Origin})).status, 403);
    }
    const nonJson = await fetch(origin + '/api/pause', {method:'POST', headers:{...auth, Origin:origin, 'Content-Type':'text/plain'}, body:'{}'});
    assert.equal(nonJson.status, 415);
    const listed = await c.request('tools/list', {});
    assert.ok(!JSON.stringify(listed).includes(token));
    assert.ok(!JSON.stringify(listed).includes(cookie));
    assert.ok(!JSON.stringify(listed).includes(session));
    await c.close();
  } finally {
    if (c.child.exitCode === null) { c.child.kill('SIGTERM'); await c.exited; }
    fs.rmSync(workspace, {recursive:true, force:true});
  }
});
