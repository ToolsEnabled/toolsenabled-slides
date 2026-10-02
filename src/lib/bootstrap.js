'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {spawn} = require('./helper-paths');
const {checkPython, python} = require('./prerequisites');

function request(port, pathname, body, instanceId) {
  return new Promise(resolve => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({host:'127.0.0.1', port, path:pathname,
      method:data ? 'POST' : 'GET', agent:false,
      headers:{...(instanceId ? {'X-Slides-Instance':instanceId} : {}), 'Content-Type':'application/json', 'Content-Length':data ? Buffer.byteLength(data) : 0},
    }, res => {
      res.setEncoding('utf8');
      let text = '';
      res.on('data', chunk => { text += chunk; if (text.length > 16384) req.destroy(); });
      res.on('end', () => {
        clearTimeout(timer);
        try { resolve({status:res.statusCode, ...JSON.parse(text)}); }
        catch { resolve(null); }
      });
      res.on('error', () => { clearTimeout(timer); resolve(null); });
    });
    const timer = setTimeout(() => req.destroy(new Error('Local suite timeout')), 1000);
    req.on('error', () => { clearTimeout(timer); resolve(null); });
    req.end(data);
  });
}

async function stopChild(child, closed) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
  try {
    child.kill('SIGTERM');
    await closed;
  } finally { clearTimeout(timer); }
}

function pluginWorkspace(value) {
  const error = () => new Error('Set SLIDES_WORKSPACE to an absolute external workspace before starting the Codex plugin');
  if (!require('./helper-paths').absolutePath(value)) throw error();
  const resolved = path.resolve(value), root = fs.realpathSync(path.resolve(__dirname, '../..'));
  let ancestor = resolved;
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) throw error();
    ancestor = parent;
  }
  const canonical = path.resolve(fs.realpathSync(ancestor), path.relative(ancestor, resolved));
  let boundary = root;
  for(let value=path.dirname(root);value!==path.dirname(value);value=path.dirname(value)){
    if(path.basename(value)==='cache'&&path.basename(path.dirname(value))==='plugins'){boundary=value;break;}
  }
  if(boundary===root&&['slides','toolsenabled-slides'].includes(path.basename(path.dirname(root)))&&/^[0-9]/.test(path.basename(root)))boundary=path.resolve(root,'../../..');
  const {inside}=require('./helper-paths');
  if(inside(boundary,canonical)||inside(canonical,boundary))throw error();
  return resolved;
}

async function start() {
  if (process.env.SLIDES_PLUGIN_MODE === '1') {
    pluginWorkspace(process.env.SLIDES_WORKSPACE);
    const runtime = checkPython();
    process.stderr.write('Slides runtime verified: ' + runtime.requirementsSha256 + '\n');
  }
  process.env.SLIDES_WORKSPACE = path.resolve(process.env.SLIDES_WORKSPACE || path.join(process.cwd(), '.slides-workspace'));
  fs.mkdirSync(process.env.SLIDES_WORKSPACE, {recursive:true, mode:0o700});
  process.env.SLIDES_WORKSPACE = fs.realpathSync(process.env.SLIDES_WORKSPACE);
  process.env.SUITE_PYTHON = python();
  process.env.SUITE_HOST = '127.0.0.1';
  process.env.SUITE_EDITOR = 'mcp-' + process.pid;
  const port = Number(process.env.SUITE_PORT || 4599);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('SUITE_PORT must be an integer from 1024 to 65535');
  const matches = h => h?.ok && h.service === 'toolsenabled-slides' && h.workspace === process.env.SLIDES_WORKSPACE && typeof h.instanceId === 'string';
  let instanceId;
  let child;
  let childClosed;
  let cleanupPromise;
  const cleanup = () => cleanupPromise ||= (async () => {
    const live = await request(port, '/api/health', null, instanceId);
    if (instanceId && matches(live) && live.instanceId === instanceId) {
      await request(port, '/api/locks/release', {by:process.env.SUITE_EDITOR, slideIds:'all'}, instanceId);
    }
    await stopChild(child, childClosed);
  })();
  const shutdown = async () => { await cleanup(); process.exit(0); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  try {
    let h = await request(port, '/api/health');
    if (h && !matches(h)) throw new Error(`Port ${port} belongs to a different service or workspace. Choose another SUITE_PORT.`);
    if (!h) {
      if (process.env.SLIDES_PLUGIN_MODE !== '1') checkPython();
      child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
        cwd:path.resolve(__dirname,'../..'), env:{...process.env,SLIDES_OWNER_STDIN:'1'},
        stdio:['pipe','pipe','pipe'], windowsHide:true,
      });
      child.stdout.pipe(process.stderr);
      child.stderr.pipe(process.stderr);
      childClosed = new Promise(resolve => child.once('close', resolve));
      let error;
      child.once('error', e => { error = e; });
      const until = Date.now() + 15000;
      while (Date.now() < until) {
        h = await request(port, '/api/health');
        if (matches(h)) break;
        if (h) throw new Error('Unexpected server appeared on the selected port');
        if (child.exitCode !== null || child.signalCode !== null || error) throw error || new Error('Suite startup failed; see stderr');
        await new Promise(r => setTimeout(r, 50));
      }
      if (!matches(h)) throw new Error('Suite startup timed out');
    }
    instanceId = h.instanceId;
    process.env.SLIDES_INSTANCE_ID = instanceId;
    process.stderr.write(child
      ? 'ToolsEnabled Slides started. Open the one-time dashboard URL above for human controls.\n'
      : `ToolsEnabled Slides attached: http://127.0.0.1:${port}/studio (use the existing dashboard session for controls)\n`);
    return {shutdown};
  } catch (error) {
    await cleanup();
    throw error;
  }
}
module.exports = {start, pluginWorkspace};
