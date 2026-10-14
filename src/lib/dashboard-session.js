'use strict';
const crypto = require('node:crypto');
const {httpOrigin} = require('./origins');

const humanPosts = new Set([
  '/api/pause', '/api/resume', '/api/undo', '/api/redo', '/api/pdf/export', '/api/render',
  '/api/object-history/restore', '/api/object-history/undo-restore',
  '/api/protections/toggle', '/api/tasks/protection-grant',
  '/api/board/pin', '/api/board/delete', '/api/tasks', '/api/tasks/update', '/api/tasks/delete',
  '/api/loops', '/api/loops/toggle', '/api/loops/delete',
]);
const humanGets = new Set(['/api/pptx', '/api/pdf']);

function equal(a, b) {
  return typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) &&
    crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function createDashboardSession(port) {
  let launchToken = crypto.randomBytes(32).toString('hex');
  const cookie = crypto.randomBytes(32).toString('hex');
  const session = crypto.randomBytes(32).toString('hex');
  const cookieName = `slides_dashboard_${port}`;
  const deadline = Date.now() + 10 * 60 * 1000;
  const launchPath = `/studio#launch=${launchToken}`;
  function authenticated(req) {
    const cookies = (req.headers.cookie || '').split(';').map(s => s.trim());
    const originValid = req.method !== 'POST' || req.headers.origin === httpOrigin(req.headers.host);
    return originValid && equal(req.headers['x-slides-session'], session) &&
      cookies.some(s => s.startsWith(cookieName + '=') && equal(s.slice(cookieName.length + 1), cookie));
  }
  function requireSession(req, res) {
    if (authenticated(req)) return true;
    res.writeHead(403, {'Content-Type':'application/json', 'Cache-Control':'no-store'});
    res.end(JSON.stringify({ok:false, error:'Human controls require the dashboard session'}));
    return false;
  }
  async function handle(req, res, url, readBody) {
    if (req.method === 'POST' && url.pathname === '/api/dashboard/session') {
      if (req.headers.origin !== httpOrigin(req.headers.host)) {
        res.writeHead(403, {'Content-Type':'application/json', 'Cache-Control':'no-store'});
        res.end(JSON.stringify({error:'Dashboard exchange requires the same Origin'}));
        return true;
      }
      const body = await readBody(req);
      if (Date.now() > deadline || !equal(body?.launchToken, launchToken)) {
        res.writeHead(403, {'Content-Type':'application/json', 'Cache-Control':'no-store'});
        res.end(JSON.stringify({error:'Invalid or expired dashboard launch secret'}));
      } else {
        launchToken = null;
        res.writeHead(200, {'Content-Type':'application/json', 'Cache-Control':'no-store',
          'Set-Cookie':`${cookieName}=${cookie}; Path=/; HttpOnly; SameSite=Strict`});
        res.end(JSON.stringify({token:session}));
      }
      return true;
    }
    if ((req.method === 'POST' && humanPosts.has(url.pathname)) ||
        (['GET', 'HEAD'].includes(req.method) && humanGets.has(url.pathname))) {
      return !requireSession(req, res);
    }
    return false;
  }
  return {launchPath, authenticated, requireSession, handle};
}
module.exports = {createDashboardSession};
