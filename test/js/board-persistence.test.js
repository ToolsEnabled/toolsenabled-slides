#!/usr/bin/env node
'use strict';
const SUITE_ROOT = require('node:path').resolve(__dirname, '../..');

const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const dashboard = require('../helpers/dashboard');
const {spawn, fetch} = dashboard;

const HERE = SUITE_ROOT;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}
async function api(base, route, options) {
  const res = await fetch(base + route, options);
  return { status: res.status, body: await res.json().catch(() => null) };
}
async function waitFor(description, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (await predicate()) return; } catch (_) {}
    await sleep(30);
  }
  throw new Error(`timed out waiting for ${description}`);
}
async function within(description, promise, timeoutMs) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out: ${description}`)), timeoutMs); })
    ]);
  } finally { if (timer) clearTimeout(timer); }
}
function makeWritable(file) {
  if (process.platform === 'win32') spawnSync('attrib', ['-R', file], { stdio: 'ignore' });
  else { try { fs.chmodSync(file, 0o644); } catch (_) {} }
}
function prepareState(suiteDir) {
  const data = path.join(suiteDir, 'data');
  const statePath = path.join(data, 'state.json');
  makeWritable(statePath);
  makeWritable(path.join(data, 'model.json'));
  fs.writeFileSync(statePath, JSON.stringify({ paused: true, pausedBy: 'board-persist-test', pausedAt: 1, pdfRev: null, log: [], loopRunner: false }, null, 2));
}

function patchServerForTest(suiteDir) {
  const serverPath = path.join(suiteDir, 'src/server.js');
  let source = fs.readFileSync(serverPath, 'utf8');
  const platformNeedle = "const IS_WIN = process.platform === 'win32';";
  if (!source.includes(platformNeedle)) throw new Error('could not isolate Windows-only work');
  source = source.replace(platformNeedle, 'const IS_WIN = false; // board-persistence test sandbox');

  const pathNeedle = "const COM_HOST_PID_PATH = path.join(DATA, 'com_host.pid.json');";
  if (!source.includes(pathNeedle)) throw new Error('could not install board fault hook');
  source = source.replace(pathNeedle, pathNeedle + `
const __boardPersistModePath = path.join(DATA, '__board-persist-test-mode');
const __boardPersistDispatchPath = path.join(DATA, '__board-persist-dispatch.jsonl');
const __boardPersistWriteFileSync = fs.writeFileSync.bind(fs);
const __boardPersistRenameSync = fs.renameSync.bind(fs);
function __boardPersistMode() { try { return fs.readFileSync(__boardPersistModePath, 'utf8').trim(); } catch (_) { return ''; } }
function __boardPersistError() { const err = new Error('forced board persistence failure'); err.code = 'EPERM'; return err; }
fs.writeFileSync = function(file, data, ...args) {
  const mode = __boardPersistMode();
  const target = String(file);
  if (mode === 'temp' && target.startsWith(BOARD_PATH + '.')) throw __boardPersistError();
  if (mode === 'final' && target === BOARD_PATH) throw __boardPersistError();
  return __boardPersistWriteFileSync(file, data, ...args);
};
fs.renameSync = function(from, to) {
  if (__boardPersistMode() === 'final' && String(to) === BOARD_PATH) throw __boardPersistError();
  return __boardPersistRenameSync(from, to);
};

`);

  const broadcastNeedle = 'function broadcast(event) {';
  if (!source.includes(broadcastNeedle)) throw new Error('could not trace broadcasts');
  source = source.replace(broadcastNeedle, `const __boardPersistEventsPath = path.join(DATA, '__board-persist-events.jsonl');
function broadcast(event) {
  if (process.env.SUITE_BOARD_PERSIST_TEST) {
    try { fs.appendFileSync(__boardPersistEventsPath, JSON.stringify(event) + '\\n'); } catch (_) {}
  }`);

  if (!source.includes('  await migrateModel();')) throw new Error('could not skip migration');
  source = source.replace('  await migrateModel();', '  // board-persistence test: skip migration');
  if (!source.includes('function scheduleRender() {')) throw new Error('could not isolate render');
  source = source.replace('function scheduleRender() {', 'function scheduleRender() {\n  if (process.env.SUITE_BOARD_PERSIST_TEST) return;');
  const thumbsNeedle = "    void refreshThumbsFromDeck(model.rev, 'boot thumbs pass skipped:');";
  if (!source.includes(thumbsNeedle)) throw new Error('could not skip thumbnail boot');
  source = source.replace(thumbsNeedle, '    // board-persistence test: no background thumbnail export');
  fs.writeFileSync(serverPath, source);
}

function startServer(suiteDir, port) {
  return spawn(process.execPath, ['src/server.js'], {
    cwd: suiteDir,
    env: Object.assign({}, process.env, { SUITE_PORT: String(port), SUITE_BOARD_PERSIST_TEST: '1', SUITE_LOOP_MIN_CADENCE_MS: '1000' }),
    stdio: ['ignore', 'ignore', 'ignore']
  });
}
async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  try { child.kill(); } catch (_) {}
  await Promise.race([exited, sleep(1500)]);
}
function boardSignature(snapshot) {
  return JSON.stringify({ notes: snapshot.board, tasks: snapshot.tasks, loops: snapshot.loops });
}
function readEvents(file) {
  try { return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)); }
  catch (_) { return []; }
}
const checks = [];
function check(description, condition) { checks.push({ description, ok: !!condition }); }

async function main() {
  const sandbox = path.join(os.tmpdir(), 'board-persistence-test-' + crypto.randomBytes(4).toString('hex'));
  const suiteDir = path.join(sandbox, 'suite');
  const data = path.join(suiteDir, 'data');
  const boardPath = path.join(data, 'board.json');
  const modePath = path.join(data, '__board-persist-test-mode');
  const eventsPath = path.join(data, '__board-persist-events.jsonl');
  const dispatchPath = path.join(data, '__board-persist-dispatch.jsonl');
  let child = null;
  let port = null;
  const setMode = (mode) => { if (mode) fs.writeFileSync(modePath, mode); else fs.rmSync(modePath, { force: true }); };
  try {
    fs.cpSync(HERE, suiteDir, { recursive: true });
    fs.rmSync(path.join(data, 'com_host.pid.json'), { force: true });
    fs.rmSync(path.join(data, 'agents.pid.json'), { force: true });
    prepareState(suiteDir);
    patchServerForTest(suiteDir);
    port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const state = async () => (await api(base, '/api/state')).body;
    const post = (route, body) => api(base, route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const postOk = async (route, body) => {
      const result = await post(route, body);
      if (result.status !== 200 || !result.body || result.body.ok === false) throw new Error(`seed failed ${route}: ${result.status}`);
      return result.body;
    };
    const seedNote = async () => (await postOk('/api/board', { text: 'seed note ' + crypto.randomBytes(3).toString('hex'), author: 'seed' })).note;
    const seedTask = async (assignee) => (await postOk('/api/tasks', { text: 'seed task ' + crypto.randomBytes(3).toString('hex'), by: 'seed', assignee: assignee || '' })).task;
    const seedLoop = async () => (await postOk('/api/loops', { text: 'seed loop ' + crypto.randomBytes(3).toString('hex'), author: 'seed', cadence: 'manual' })).loop;
    child = startServer(suiteDir, port);
    await waitFor('board persistence sandbox health', async () => (await fetch(base + '/api/health')).ok, 8000);

    const failureCase = async (label, semanticType, setup, request, needsNoDispatch) => {
      for (const mode of ['temp', 'final']) {
        const target = await setup();
        const before = await state();
        const diskBefore = fs.readFileSync(boardPath, 'utf8');
        fs.writeFileSync(eventsPath, ''); fs.writeFileSync(dispatchPath, '');
        setMode(mode);
        const response = await within(`${mode} ${label} response`, request(target), 2500);
        setMode('');
        const after = await state();
        const diskAfter = fs.readFileSync(boardPath, 'utf8');
        const events = readEvents(eventsPath);
        const leaked = events.some((event) => event.type === semanticType);
        check(`${mode}: ${label} returns a timely 500`, response.status === 500 && response.body && response.body.ok === false);
        check(`${mode}: ${label} leaves board memory and disk unchanged`, boardSignature(after) === boardSignature(before) && diskAfter === diskBefore);
        check(`${mode}: ${label} emits no ${semanticType} success event`, !leaked);
        if (needsNoDispatch) check(`${mode}: ${label} does not dispatch an agent`, fs.readFileSync(dispatchPath, 'utf8') === '');
      }
    };

    await failureCase('note add', 'board', async () => null, () => post('/api/board', { text: 'undurable note', author: 'test' }));
    await failureCase('note pin', 'board', seedNote, (note) => post('/api/board/pin', { id: note.id, pinned: true }));
    await failureCase('note delete', 'board', seedNote, (note) => post('/api/board/delete', { id: note.id }));
    await failureCase('lead-assigned task add', 'tasks', async () => null, () => post('/api/tasks', { text: 'undurable assigned task', by: 'human', assignee: 'worker-1' }), true);
    await failureCase('task update', 'tasks', () => seedTask('worker-1'), (task) =>
      post('/api/tasks/update', {
        id: task.id,
        text: 'undurable rewritten task',
        assignee: 'worker-2',
        by: 'human',
      }), true);
    await failureCase('task claim', 'tasks', seedTask, (task) => post('/api/tasks/claim', { id: task.id, by: 'worker-1' }));
    await failureCase('task completion', 'tasks', seedTask, (task) => post('/api/tasks/done', { id: task.id, by: 'worker-1' }));
    await failureCase('task delete', 'tasks', seedTask, (task) => post('/api/tasks/delete', { id: task.id }));
    await failureCase('next-task claim', 'tasks', async () => {
      const who = 'session-next-' + crypto.randomBytes(3).toString('hex');
      const task = await seedTask(who);
      return { task, who };
    }, ({ who }) => post('/api/tasks/next', { by: who, includeUnassigned: false, claim: true }));
    await failureCase('loop add', 'loops', async () => null, () => post('/api/loops', { text: 'undurable loop', author: 'test', cadence: 'manual' }));
    await failureCase('loop toggle', 'loops', seedLoop, (loop) => post('/api/loops/toggle', { id: loop.id, enabled: false }));
    await failureCase('loop delete', 'loops', seedLoop, (loop) => post('/api/loops/delete', { id: loop.id }));
    await failureCase('loop completion', 'loops', seedLoop, (loop) => post('/api/loops/ran', { id: loop.id, by: 'worker-1', result: 'checked' }));

    const committed = await postOk('/api/board', { text: 'committed board persistence marker', author: 'test' });
    await stopServer(child); child = null;
    child = startServer(suiteDir, port);
    await waitFor('restarted board persistence sandbox health', async () => (await fetch(base + '/api/health')).ok, 8000);
    const afterRestart = await state();
    const diskAfterRestart = JSON.parse(fs.readFileSync(boardPath, 'utf8'));
    check('only committed board work survives restart',
      afterRestart.board.some((note) => note.id === committed.note.id)
        && diskAfterRestart.notes.some((note) => note.id === committed.note.id));
  } finally {
    setMode('');
    await stopServer(child);
    for (let attempt = 0; attempt < 5; attempt++) {
      try { fs.rmSync(sandbox, { recursive: true, force: true }); break; }
      catch (_) { if (attempt < 4) await sleep(200); }
    }
  }

  const passed = checks.filter((item) => item.ok).length;
  for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.description}`);
  console.log(`\n${passed}/${checks.length} passed`);
  process.exit(passed === checks.length ? 0 : 1);
}

main().catch((err) => { console.error(err.stack || err); process.exit(1); });
