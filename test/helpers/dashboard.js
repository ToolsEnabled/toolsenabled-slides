'use strict';
const {spawn: spawnChild} = require('node:child_process');
const sessions = new Map();
// The one-time studio link a Slides server prints at startup. Tests find it with launchLink(output), so this
// pattern lives in one place.
const LAUNCH_LINK = /http:\/\/[^\s]+\/studio#launch=[a-f0-9]{64}/;
function launchLink(text) { return String(text).match(LAUNCH_LINK)?.[0]; }

// Control tests read the server's launch output and redeem it over HTTP, just
// as a browser does. Security tests use bare HTTP instead of this helper.
function spawn(command, args, options = {}) {
  const server = args.some(a => /(^|[\\/])server\.js$/.test(a));
  if (!server) return spawnChild(command, args, options);
  const stdio = Array.isArray(options.stdio) ? [...options.stdio] : ['ignore', 'pipe', 'pipe'];
  stdio[1] = 'pipe';
  const port = String(options.env?.SUITE_PORT || 4599);
  let resolveLaunch;
  const session = {launch:new Promise(resolve => { resolveLaunch = resolve; }), headers:null};
  sessions.set(port, session);
  const child = spawnChild(command, args, {...options, stdio});
  let output = '';
  child.stdout.on('data', chunk => {
    output += chunk;
    const launch = launchLink(output);
    if (launch) resolveLaunch(launch);
    output = output.slice(-16000);
  });
  child.once('exit', () => resolveLaunch(null));
  return child;
}
async function redeem(launch) {
  const url = new URL(launch);
  const response = await globalThis.fetch(url.origin + '/api/dashboard/session', {
    method:'POST', headers:{Origin:url.origin, 'Content-Type':'application/json'},
    body:JSON.stringify({launchToken:new URLSearchParams(url.hash.slice(1)).get('launch')}),
  });
  if (response.status !== 200) throw new Error('Cannot redeem dashboard session: ' + response.status);
  return {Origin:url.origin, Cookie:response.headers.get('set-cookie').split(';')[0],
    'X-Slides-Session':(await response.json()).token};
}
async function headers(port) {
  const session = sessions.get(String(port));
  if (!session) return {};
  if (!session.headers) session.headers = (async () => {
    const url = await session.launch;
    if (!url) throw new Error('Server exited before dashboard launch');
    return redeem(url);
  })();
  return session.headers;
}
async function fetch(url, options = {}) {
  const parsed = new URL(url);
  if (parsed.pathname === '/api/health') return globalThis.fetch(url, options);
  const auth = await headers(parsed.port);
  return globalThis.fetch(url, {...options, headers:{...auth, ...options.headers}});
}
module.exports = {spawn, fetch, headers, redeem, launchLink};
