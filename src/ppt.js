#!/usr/bin/env node
'use strict';

// Views never register an editor, start a server or write workspace state.
if (process.argv[2] === 'view') {
  void require('./cli/view').main(process.argv.slice(3));
  return;
}

const http = require('http');
const os = require('os');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile } = require('./lib/helper-paths');
const { httpOrigin } = require('./lib/origins');

const PORT = parseInt(process.env.SUITE_PORT || '4599', 10);
const HOST = process.env.SUITE_HOST || '127.0.0.1';
// Like src/server.js, which binds only to loopback, the CLI talks only to a Slides server on this computer.
if (!['127.0.0.1', 'localhost', '::1'].includes(HOST)) {
  die(`✗ SUITE_HOST is ${safeDisplay(HOST)}: the ppt CLI connects only to a Slides server on this computer (127.0.0.1, localhost or ::1)`, 2);
}

let EDITOR = process.env.SUITE_EDITOR;

if (!EDITOR) {
  EDITOR = `cc-${os.hostname()}-${crypto.randomBytes(2).toString('hex')}`;
  process.stderr.write(`(SUITE_EDITOR not set, using throwaway name "${safeDisplay(EDITOR)}" for this command only. Export SUITE_EDITOR="your-name" once so you show up consistently instead of a new random name every command.)\n`);
}
const NO_ANSI = !process.stdout.isTTY || !!process.env.NO_COLOR;

const C = NO_ANSI ? {
  reset: '', dim: '', bold: '', red: '', green: '', yellow: '', blue: '', cyan: '', gray: ''
} : {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', cyan: '\x1b[36m', gray: '\x1b[90m'
};

function api(method, pathname, body, defaultTimeoutMs) {
  return new Promise((resolve, reject) => {
    const data = body ? safeJson(body) : null;
    const req = http.request(
      { host: HOST, port: PORT, path: pathname, method,
        headers: { 'Content-Type': 'application/json', 'Content-Length': data ? Buffer.byteLength(data) : 0 } },
      (res) => {
        res.setEncoding('utf8');
        let out = '';
        res.on('data', (c) => (out += c));
        res.on('end', () => {
          let parsed; try { parsed = out ? JSON.parse(out) : {}; } catch (_) { parsed = { raw: out }; }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on('error', reject);

    const configured = process.env.SUITE_HTTP_TIMEOUT_MS;
    const timeoutMs = Math.max(
      1000,
      configured != null && configured !== ''
        ? (Number.parseInt(configured, 10) || 75000)
        : (defaultTimeoutMs || 75000)
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`request timed out after ${timeoutMs}ms`)));
    if (data) req.write(data);
    req.end();
  });
}

function die(msg, code) { console.error(msg); process.exit(code == null ? 1 : code); }

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function requireReadResult(r, action, validate, allowOkFalse = false) {
  if (!r || r.status !== 200 || !isObject(r.body) || (!allowOkFalse && r.body.ok === false)) {
    die(`${C.red}✗ ${safeDisplay(r && r.body && r.body.error) || `${action} failed (HTTP ${(r && r.status) || 0})`}${C.reset}`, 1);
  }
  if (validate && !validate(r.body)) {
    die(`${C.red}✗ ${action} returned a malformed response${C.reset}`, 1);
  }
  return r.body;
}

function requireControlResult(r, action, expectedPaused) {
  if (r.status === 423) {
    die(`${C.yellow}⏸  PAUSED${C.reset} — ${action} was refused.`, 3);
  }
  if (r.status !== 200 || !isObject(r.body) || r.body.ok === false) {
    die(`${C.red}✗ ${safeDisplay(r.body && r.body.error) || `${action} failed (HTTP ${safeDisplay(r.status)})`}${C.reset}`, 1);
  }
  if (typeof expectedPaused === 'boolean' && r.body.paused !== expectedPaused) {
    die(`${C.red}✗ ${action} returned an invalid state confirmation${C.reset}`, 1);
  }
  return r.body;
}

async function heartbeat() {
  try { await api('POST', '/api/heartbeat', { id: EDITOR, name: EDITOR }); } catch (_) {}
}

async function setStatus(status, task) {
  return api('POST', '/api/status', { id: EDITOR, name: EDITOR, status, task: task || '' });
}

async function ensureUp() {
  try { const r = await api('GET', '/api/health'); if (r.status === 200) return true; } catch (_) {}
  die(`${C.red}✗ suite server not reachable at ${server()}${C.reset}\n` +
      `  Start a persistent studio with:  ${C.bold}node src/cli/studio.js${C.reset}  (npm run studio, in the Slides folder, with SLIDES_WORKSPACE set),  or start Slides from your MCP host`, 2);
}

// ---- parse "--flag value" pairs and positional args
function parseFlags(args) {
  const flags = {}; const pos = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) { const k = args[i].slice(2); const v = (args[i + 1] && !args[i + 1].startsWith('--')) ? args[++i] : true; flags[k] = v; }
    else pos.push(args[i]);
  }
  return { flags, pos };
}

function strictInteger(value, label) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!/^[+-]?\d+$/.test(text)) die(`${label} must be an integer`);
  const number = Number(text);
  if (!Number.isSafeInteger(number)) die(`${label} must be a safe integer`);
  return number;
}

function strictNumber(value, label) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) {
    die(`${label} must be a number`);
  }
  const number = Number(text);
  if (!Number.isFinite(number)) die(`${label} must be finite`);
  return number;
}

function strictHex(value, label) {
  if (typeof value !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(value)) {
    die(`${label} must be exact #RRGGBB hex`);
  }
  return value;
}

function strictUnitNumber(value, label, positive) {
  const number = strictNumber(value, label);
  if (number < 0 || number > 1 || (positive && number === 0)) {
    die(`${label} must be ${positive ? 'greater than 0 and ' : ''}from 0 to 1`);
  }
  return number;
}

function strictBoolean(value, label) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  die(`${label} must be true or false`);
}

async function edit(op, taskId) {
  const body = { op, editor: EDITOR };
  if (taskId !== undefined) body.taskId = taskId;
  const r = await api('POST', '/api/edit', body);
  if (r.status === 423) {
    if (r.body && (r.body.error === 'protected' || r.body.protection)) {
      die(`${C.yellow}🔒 PROTECTED${C.reset} — ${safeDisplay(r.body.message || 'this content is protected; a human must unprotect it first')}.`, 4);
    }
    die(`${C.yellow}⏸  PAUSED${C.reset} — edits are locked${r.body.pausedBy ? ` by ${safeDisplay(r.body.pausedBy)}` : ''}. ` +
        `Press Resume on the dashboard to continue.`, 3);
  }
  if (r.status !== 200 || !r.body.ok) die(`${C.red}✗ ${quoteBoard(r.body.error || 'edit failed')}${C.reset}`, 1);
  if (r.body.warning) console.log(`${C.yellow}⚠ ${safeDisplay(r.body.warning)}${C.reset}`);
  return r.body;
}

function fmtStyle(st) {
  if (!st) return '';
  const parts = [];
  if (st.color) parts.push(`color=${safeDisplay(st.color)}`);
  if (st.fill) parts.push(`fill=${safeDisplay(st.fill)}`);
  if (st.outline) parts.push(`outline=${safeDisplay(st.outline)}`);
  if (st.size) parts.push(`size=${safeDisplay(st.size)}`);
  if (st.bold) parts.push('bold');
  if (st.align) parts.push(`align=${safeDisplay(st.align)}`);
  if (st.font) parts.push(`font=${safeDisplay(st.font)}`);
  return parts.length ? ` ${C.gray}{${parts.join(' ')}}${C.reset}` : '';
}

function fmtBox(box) {
  return box ? ` ${C.gray}(${box.x.toFixed(2)},${box.y.toFixed(2)},${box.w.toFixed(2)},${box.h.toFixed(2)})${C.reset}` : '';
}

function fmtTransition(transition) {
  if (!transition) return '';
  if (transition.effect === 'fade') {
    return ` ${C.gray}[transition=fade ${safeDisplay(transition.duration)}s]${C.reset}`;
  }
  return ` ${C.gray}[transition=none]${C.reset}`;
}

function fmtElement(e) {
  const body = e.items ? `[${e.items.map((x) => safeJson(x)).join(', ')}]` : safeJson(e.text || '');
  const corners = e.corners ? ` corners=${safeDisplay(e.corners)}` : (e.sourcePreset ? ` corners-eligible=${safeDisplay(e.sourcePreset)}` : '');
  return `      ${C.gray}${safeDisplay(e.id)}${C.reset} ${C.cyan}${safeDisplay(e.type)}${C.reset} ${body}${fmtStyle(e.style)}${fmtBox(e.box)}${corners}`;
}

function fmtDecor(d) {
  const colorable = d.kind === 'shape' && (d.sid != null || d.generated === true);
  const source = d.source ? `source=${safeJson(d.source)} ` : '';
  const playback = d.kind === 'media'
    ? `autoplay=${d.autoplay ? 'on' : 'off'} loop=${d.loop ? 'on' : 'off'} `
    : '';
  const corners = d.corners ? ` corners=${safeDisplay(d.corners)}` : (d.sourcePreset ? ` corners-eligible=${safeDisplay(d.sourcePreset)}` : '');
  return `      ${C.gray}${safeDisplay(d.id || '?')}${C.reset} ${C.yellow}decor:${safeDisplay(d.kind)}${C.reset} ${d.fill ? `fill=${safeDisplay(d.fill)} ` : ''}${source}${playback}${fmtBox(d.box)}${corners}${colorable ? '' : ` ${C.gray}(not colorable)${C.reset}`}`;
}

async function cmdShow() {
  const r = await api('GET', '/api/state');
  const b = requireReadResult(r, 'state', (x) => isObject(x.model) && Array.isArray(x.model.slides));
  const m = b.model;
  const locksById = new Map((b.locks || []).map((l) => [l.slideId, l]));
  const pausedTag = b.paused ? ` ${C.yellow}${C.bold}[PAUSED by ${safeDisplay(b.pausedBy || '?')}]${C.reset}` : '';
  console.log(`\n${C.bold}${safeDisplay(m.title)}${C.reset}  ${C.gray}rev ${safeDisplay(m.rev)} · ${safeDisplay(m.slides.length)} slides${C.reset}${pausedTag}`);
  m.slides.forEach((s, i) => {
    const l = locksById.get(s.id);
    const lockTag = l ? ` ${C.yellow}🔒 ${safeDisplay(l.by)}${C.reset}` : '';
    console.log(`\n  ${C.bold}${i + 1}.${C.reset} ${C.gray}${safeDisplay(s.id)}${C.reset} ${C.blue}(${safeDisplay(s.layout)})${C.reset}${fmtTransition(s.transition)}${lockTag}`);
    s.elements.forEach((e) => console.log(fmtElement(e)));
    if (s.decor && s.decor.length) s.decor.forEach((d) => console.log(fmtDecor(d)));
    if (s.notes) console.log(`      ${C.gray}notes: ${safeJson(s.notes).slice(0, 60)}${C.reset}`);
  });
  console.log('');
}

async function cmdSearch(term, flags) {
  if (!term) die('usage: search "text" [--json]');
  const r = await api('GET', '/api/state');
  const m = requireReadResult(r, 'state', (x) => isObject(x.model) && Array.isArray(x.model.slides)).model;
  const needle = term.toLowerCase();
  const hits = [];
  const check = (s, i, field, text) => {
    if (text != null && String(text).toLowerCase().includes(needle)) {
      hits.push({ slideId: s.id, index: i + 1, layout: s.layout, field, text: String(text) });
    }
  };
  m.slides.forEach((s, i) => {
    s.elements.forEach((e) => {
      if (e.text) check(s, i, `${safeDisplay(e.id)} (${safeDisplay(e.type)})`, e.text);
      if (e.items) e.items.forEach((it, idx) => check(s, i, `${safeDisplay(e.id)} (${safeDisplay(e.type)}) item ${idx + 1}`, it));
    });
    check(s, i, 'notes', s.notes);
  });
  if (flags && flags.json) { console.log(safeJson(hits, null, 2)); return; }
  if (!hits.length) { console.log(`\n  ${C.gray}no matches for "${safeDisplay(term)}"${C.reset}\n`); return; }
  console.log(`\n  ${C.bold}${hits.length} match${hits.length === 1 ? '' : 'es'}${C.reset} for ${C.cyan}"${safeDisplay(term)}"${C.reset}\n`);
  let lastSlide = null;
  for (const h of hits) {
    if (h.slideId !== lastSlide) {
      console.log(`  ${C.bold}${safeDisplay(h.index)}.${C.reset} ${C.gray}${safeDisplay(h.slideId)}${C.reset} ${C.blue}(${safeDisplay(h.layout)})${C.reset}`);
      lastSlide = h.slideId;
    }
    const idx = h.text.toLowerCase().indexOf(needle);
    const before = h.text.slice(0, idx), match = h.text.slice(idx, idx + term.length), after = h.text.slice(idx + term.length);
    console.log(`      ${C.gray}${safeDisplay(h.field)}${C.reset}  ${safeDisplay(before)}${C.bold}${C.yellow}${safeDisplay(match)}${C.reset}${safeDisplay(after)}`);
  }
  console.log('');
}

async function cmdStatus() {
  const r = await api('GET', '/api/state');
  const b = requireReadResult(r, 'state', (x) =>
    isObject(x.model) && Array.isArray(x.model.slides) && Array.isArray(x.editors));
  console.log('');
  console.log(`  ${C.bold}ToolsEnabled Slides${C.reset}  ${C.gray}${server()}${C.reset}`);
  console.log(`  state    : ${b.paused ? C.yellow + C.bold + 'PAUSED' + C.reset + C.gray + ' by ' + safeDisplay(b.pausedBy || '?') + C.reset : C.green + 'live' + C.reset}`);
  if (b.bootedAt) {
    const staleFiles = ['server.js'].filter((f) => {
      try { return fs.statSync(path.join(__dirname, f)).mtimeMs > b.bootedAt; }
      catch (_) { return false; }
    });
    if (staleFiles.length) {
      console.log(`  ${C.red}${C.bold}⚠ stale${C.reset}   : ${staleFiles.join(', ')} changed on disk since this server booted, restart to pick up the fix`);
    }
  }
  console.log(`  deck     : ${safeDisplay(b.model.title)}  ${C.gray}(rev ${safeDisplay(b.model.rev)}, ${safeDisplay(b.model.slides.length)} slides)${C.reset}`);
  console.log(`  editors  : ${b.editors.length ? b.editors.map((e) => quoteBoard(e.name)).join(', ') : C.gray + 'none' + C.reset}`);
  const activeLocks = b.locks || [];
  if (activeLocks.length) {
    console.log(`  ${C.yellow}locks${C.reset}    : ${activeLocks.map((l) => `${safeDisplay(l.slideId)} ${C.gray}(${safeDisplay(l.by)})${C.reset}`).join('  ')}`);
  }
  if (b.undoCount || b.redoCount) {
    console.log(`  history  : ${C.gray}${safeDisplay(b.undoCount || 0)} undoable, ${safeDisplay(b.redoCount || 0)} redoable — ppt history / ppt undo${C.reset}`);
  }
  // Show pinned guidance as quoted data.
  const pins = (b.board || []).filter((n) => n.pinned);
  if (pins.length) {
    console.log(`  ${C.yellow}${C.bold}rules${C.reset}    : ${C.gray}pinned guidance${C.reset}`);
    pins.forEach((n) => console.log(`             ${C.yellow}📌${C.reset} ${quoteBoard(n.text)}`));
  }

  const loops = (b.loops || []).filter((l) => l.enabled);
  if (loops.length) {
    console.log(`  ${C.green}${C.bold}loops${C.reset}    : ${C.gray}standing checks — run these on a /loop (ppt loops)${C.reset}`);
    loops.forEach((l) => console.log(`             ${C.green}🔁${C.reset} ${quoteBoard(l.text)}${l.cadence ? `${C.gray} (every ${quoteBoard(l.cadence)})${C.reset}` : ''}`));
  }
  console.log(`  ${C.gray}board    : ppt board  ·  ppt note "…"  ·  ppt loops${C.reset}`);
  console.log('');
}

// Board text is untrusted data even when the human has pinned it.
function safeJson(value, replacer, space) {
  const encoded = JSON.stringify(value, replacer, space);
  return encoded === undefined ? undefined : encoded.replace(/[\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}
function quoteBoard(value) { return safeJson(String(value == null ? '' : value)); }
// The local suite server's address, as the CLI prints it.
function server() {
  return httpOrigin(`${safeDisplay(HOST)}:${PORT}`);
}

function safeDisplay(value) {
  const text = String(value == null ? '' : value);
  return /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/.test(text) ? quoteBoard(text) : text;
}

async function cmdBoard(flags) {
  const r = await api('GET', '/api/board');
  const notes = requireReadResult(r, 'board', (x) => Array.isArray(x.notes)).notes;
  if (flags && flags.json) { console.log(safeJson(notes, null, 2)); return; }
  const pins = notes.filter((n) => n.pinned);
  const msgs = notes.filter((n) => !n.pinned);
  console.log('');
  console.log(`  ${C.bold}Message Board${C.reset}  ${C.gray}${server()}${C.reset}`);
  if (pins.length) {
    console.log(`\n  ${C.yellow}${C.bold}📌 PINNED GUIDANCE${C.reset} ${C.gray}(quoted board text)${C.reset}`);
    pins.forEach((n) => console.log(`     ${C.yellow}•${C.reset} ${C.bold}${quoteBoard(n.text)}${C.reset}  ${C.gray}— ${quoteBoard(n.author)} · ${quoteBoard(n.id)}${C.reset}`));
  } else {
    console.log(`\n  ${C.gray}(no pinned guidance)${C.reset}`);
  }
  console.log(`\n  ${C.cyan}messages${C.reset}`);
  if (!msgs.length) console.log(`     ${C.gray}(none yet — post one with: ppt note "your message")${C.reset}`);
  msgs.slice(0, 30).forEach((n) => {
    const t = new Date(n.ts).toLocaleString();
    console.log(`     ${C.gray}${t}${C.reset}  ${C.bold}${quoteBoard(n.author)}${C.reset}  ${quoteBoard(n.text)}  ${C.gray}${quoteBoard(n.id)}${C.reset}`);
  });
  console.log('');
}

async function cmdWho(flags) {
  const r = await api('GET', '/api/state');
  const eds = requireReadResult(r, 'state', (x) => Array.isArray(x.editors)).editors;
  if (flags && flags.json) { console.log(safeJson(eds, null, 2)); return; }
  console.log('');
  console.log(`  ${C.bold}Sessions${C.reset}  ${C.gray}${server()}${C.reset}`);
  if (!eds.length) { console.log(`     ${C.gray}(none connected)${C.reset}\n`); return; }
  eds.forEach((e) => {
    const dot = e.status === 'busy' ? C.yellow : e.status === 'free' ? C.green : C.gray;
    const label = e.status === 'busy' ? `${C.yellow}busy${C.reset}` : e.status === 'free' ? `${C.green}free${C.reset}` : `${C.gray}idle${C.reset}`;
    const task = e.task ? `  ${C.gray}${safeDisplay(e.task)}${C.reset}` : '';
    console.log(`     ${dot}●${C.reset} ${C.bold}${safeDisplay(e.name)}${C.reset}  ${label}${task}`);
  });
  console.log('');
}

async function cmdTasks(flags) {
  const mine = !!(flags && flags.mine);
  const r = await api('GET', '/api/tasks');
  let tasks = requireReadResult(r, 'tasks', (x) => Array.isArray(x.tasks)).tasks;
  if (mine) tasks = tasks.filter((t) => t.assignee === EDITOR || t.claimedBy === EDITOR);
  if (flags && flags.json) { console.log(safeJson(tasks, null, 2)); return; }
  const active = tasks.filter((t) => t.status !== 'done');
  const done = tasks.filter((t) => t.status === 'done');
  console.log('');
  console.log(`  ${C.bold}Tasks${C.reset}  ${C.gray}${server()}${C.reset}`);
  if (!active.length) console.log(`     ${C.gray}(no open tasks${mine ? ' for you' : ''})${C.reset}`);
  active.forEach((t) => {
    const box = t.status === 'claimed' ? `${C.yellow}◐${C.reset}` : `${C.cyan}○${C.reset}`;
    const who = t.assignee ? `${C.cyan}→ ${safeDisplay(t.assignee)}${C.reset}` : `${C.gray}→ anyone${C.reset}`;
    const claimed = (t.status === 'claimed' && t.claimedBy) ? ` ${C.gray}(by ${safeDisplay(t.claimedBy)})${C.reset}` : '';
    console.log(`     ${box} ${safeDisplay(t.text)}  ${who}${claimed}  ${C.gray}${safeDisplay(t.id)}${C.reset}`);
  });
  if (done.length) {
    console.log(`\n     ${C.gray}recently done:${C.reset}`);
    done.slice(0, 8).forEach((t) => console.log(`     ${C.green}✓${C.reset} ${C.gray}${safeDisplay(t.text)}  ${safeDisplay(t.id)}${C.reset}`));
  }
  console.log('');
}

async function cmdLoops(flags) {
  const r = await api('GET', '/api/loops');
  let loops = requireReadResult(r, 'loops', (x) => Array.isArray(x.loops)).loops;
  if (flags && flags.on) loops = loops.filter((l) => l.enabled);
  if (flags && flags.json) { console.log(safeJson(loops, null, 2)); return; }
  console.log('');
  console.log(`  ${C.bold}Standing Loops${C.reset}  ${C.gray}recurring checks — run with an external client · ${server()}${C.reset}`);
  if (!loops.length) {
    console.log(`     ${C.gray}(none yet — add one with: ppt loop "continuously check …")${C.reset}\n`);
    return;
  }
  loops.forEach((l) => {
    const dot = l.enabled ? `${C.green}●${C.reset}` : `${C.gray}○${C.reset}`;
    const st = l.enabled ? `${C.green}on ${C.reset}` : `${C.gray}off${C.reset}`;
    const every = l.cadence ? ` ${C.gray}every ${safeDisplay(l.cadence)}${C.reset}` : '';
    const last = l.lastRun
      ? ` ${C.gray}· last ${new Date(l.lastRun).toLocaleTimeString()}${l.lastBy ? ' by ' + quoteBoard(l.lastBy) : ''}${C.reset}`
      : ` ${C.gray}· never run${C.reset}`;
    console.log(`     ${dot} ${st}${every}  ${safeDisplay(l.text)}  ${C.gray}${safeDisplay(l.id)}${C.reset}${last}`);
  });
  console.log('');
}
function validProtectionRow(row) {
  if (!isObject(row) || !['slide', 'object'].includes(row.kind) ||
      typeof row.slideId !== 'string' || !row.slideId.trim()) return false;
  const allowed = row.kind === 'slide'
    ? new Set(['kind', 'slideId', 'by', 'createdAt'])
    : new Set(['kind', 'slideId', 'objectId', 'objectKind', 'by', 'createdAt']);
  if (Object.keys(row).some((key) => !allowed.has(key))) return false;
  if (row.by !== undefined &&
      (typeof row.by !== 'string' || !row.by.trim() || row.by.length > 60)) return false;
  if (row.createdAt !== undefined &&
      (!Number.isSafeInteger(row.createdAt) || row.createdAt < 0)) return false;
  if (row.kind === 'slide') return row.objectId === undefined && row.objectKind === undefined;
  return typeof row.objectId === 'string' && !!row.objectId.trim() &&
    ['element', 'decor'].includes(row.objectKind);
}

function protectionRowKey(row) {
  return row.kind === 'slide'
    ? `slide:${safeDisplay(row.slideId)}`
    : `object:${safeDisplay(row.slideId)}:${safeDisplay(row.objectKind)}:${safeDisplay(row.objectId)}`;
}

function validProtectionRows(rows) {
  if (!Array.isArray(rows) || !rows.every(validProtectionRow)) return false;
  return new Set(rows.map(protectionRowKey)).size === rows.length;
}

function validProtectionHistoryRow(row) {
  if (!isObject(row) || !['lock', 'unlock'].includes(row.action) ||
      !['slide', 'object'].includes(row.kind) ||
      typeof row.slideId !== 'string' || !row.slideId.trim() ||
      typeof row.by !== 'string' || !row.by.trim() || row.by.length > 60 ||
      !Number.isSafeInteger(row.ts) || row.ts < 0) return false;
  const allowed = row.kind === 'slide'
    ? new Set(['action', 'kind', 'slideId', 'by', 'ts', 'taskId', 'authorizedBy', 'authorizedAt'])
    : new Set([
        'action', 'kind', 'slideId', 'objectId', 'objectKind', 'by', 'ts',
        'taskId', 'authorizedBy', 'authorizedAt'
      ]);
  if (Object.keys(row).some((key) => !allowed.has(key))) return false;
  const delegated = ['taskId', 'authorizedBy', 'authorizedAt']
    .filter((field) => row[field] !== undefined).length;
  if (delegated !== 0 && delegated !== 3) return false;
  if (delegated &&
      (typeof row.taskId !== 'string' || !row.taskId.trim() || row.taskId.length > 120 ||
       typeof row.authorizedBy !== 'string' || !row.authorizedBy.trim() || row.authorizedBy.length > 60 ||
       !Number.isSafeInteger(row.authorizedAt) || row.authorizedAt < 0 || row.authorizedAt > row.ts)) {
    return false;
  }
  if (row.kind === 'slide') return row.objectId === undefined && row.objectKind === undefined;
  return typeof row.objectId === 'string' && !!row.objectId.trim() &&
    ['element', 'decor'].includes(row.objectKind);
}

function validProtectionHistoryRows(rows) {
  return Array.isArray(rows) && rows.length <= 200 &&
    rows.every(validProtectionHistoryRow);
}

function sameProtectionTarget(a, b) {
  if (!isObject(a) || !isObject(b) || !['slide', 'object'].includes(a.kind) ||
      a.kind !== b.kind || typeof a.slideId !== 'string' || !a.slideId.trim() ||
      a.slideId !== b.slideId) return false;
  if (a.kind === 'slide') return true;
  return typeof a.objectId === 'string' && !!a.objectId.trim() &&
    a.objectId === b.objectId && ['element', 'decor'].includes(a.objectKind) &&
    a.objectKind === b.objectKind;
}

function sameProtectionHistoryRow(a, b) {
  return validProtectionHistoryRow(a) && validProtectionHistoryRow(b) &&
    a.action === b.action && a.kind === b.kind && a.slideId === b.slideId &&
    a.objectId === b.objectId && a.objectKind === b.objectKind &&
    a.by === b.by && a.ts === b.ts && a.taskId === b.taskId &&
    a.authorizedBy === b.authorizedBy && a.authorizedAt === b.authorizedAt;
}

function validProtectionToggleResult(body, requested) {
  if (!isObject(body) || body.ok !== true || typeof body.changed !== 'boolean' ||
      body.protected !== requested.protected || !validProtectionRow(body.protection) ||
      !sameProtectionTarget(body.protection, requested) ||
      !validProtectionRows(body.protections) ||
      !validProtectionHistoryRows(body.protectionHistory)) return false;
  if (!body.changed) return body.change === undefined;
  if (!validProtectionHistoryRow(body.change) ||
      body.change.action !== (requested.protected ? 'lock' : 'unlock') ||
      body.change.by !== requested.by ||
      !sameProtectionTarget(body.change, requested)) return false;
  const last = body.protectionHistory[body.protectionHistory.length - 1];
  return !!last && sameProtectionHistoryRow(last, body.change);
}

async function cmdProtections(flags) {
  const r = await api('GET', '/api/protections');
  const includeHistory = !!(flags && flags.history);
  const body = requireReadResult(
    r,
    'protections',
    (result) => validProtectionRows(result.protections) &&
      (result.protectionHistory === undefined ||
        validProtectionHistoryRows(result.protectionHistory)) &&
      (!includeHistory || Array.isArray(result.protectionHistory))
  );
  if (includeHistory) {
    const history = body.protectionHistory;
    if (flags.json) {
      console.log(safeJson(history, null, 2));
      return;
    }
    console.log('');
    console.log(`  ${C.bold}Protection History${C.reset}  ${C.gray}durable human lock/unlock decisions, most recent last${C.reset}`);
    if (!history.length) {
      console.log(`     ${C.gray}(no decisions recorded — absence is not an approval)${C.reset}\n`);
      return;
    }
    history.forEach((entry) => {
      const target = entry.kind === 'slide'
        ? `${C.bold}${safeDisplay(entry.slideId)}${C.reset} ${C.gray}(whole slide)${C.reset}`
        : `${C.bold}${safeDisplay(entry.slideId)}${C.reset} ${C.cyan}${safeDisplay(entry.objectId)}${C.reset} ${C.gray}(${safeDisplay(entry.objectKind)})${C.reset}`;
      const action = entry.action === 'lock'
        ? `${C.yellow}LOCK${C.reset}`
        : `${C.red}UNLOCK${C.reset}`;
      const delegated = entry.taskId
        ? ` via ${safeDisplay(entry.authorizedBy)}, task ${safeDisplay(entry.taskId)}`
        : '';
      console.log(`     ${action}  ${target}  ${C.gray}by ${safeDisplay(entry.by)}${delegated} · ${new Date(entry.ts).toLocaleString()}${C.reset}`);
    });
    console.log('');
    return;
  }
  const protections = body.protections;
  if (flags && flags.json) {
    console.log(safeJson(protections, null, 2));
    return;
  }
  console.log('');
  console.log(`  ${C.bold}Content Protections${C.reset}  ${C.gray}durable hard locks · humans must unprotect before editing${C.reset}`);
  if (!protections.length) {
    console.log(`     ${C.gray}(none — protect a slide with: ppt protect s4)${C.reset}\n`);
    return;
  }
  protections.forEach((protection) => {
    const target = protection.kind === 'slide'
      ? `${C.bold}${safeDisplay(protection.slideId)}${C.reset} ${C.gray}(whole slide)${C.reset}`
      : `${C.bold}${safeDisplay(protection.slideId)}${C.reset} ${C.cyan}${safeDisplay(protection.objectId)}${C.reset} ${C.gray}(${safeDisplay(protection.objectKind)})${C.reset}`;
    const owner = protection.by ? `  ${C.gray}by ${safeDisplay(protection.by)}${C.reset}` : '';
    const when = Number.isSafeInteger(protection.createdAt)
      ? `  ${C.gray}${new Date(protection.createdAt).toLocaleString()}${C.reset}`
      : '';
    console.log(`     ${C.yellow}🔒${C.reset} ${target}${owner}${when}`);
  });
  console.log('');
}

async function protectionObjectKind(slideId, objectId, requestedKind) {
  if (requestedKind !== undefined) {
    if (!['element', 'decor'].includes(requestedKind)) {
      die('--kind must be element or decor');
    }
    return requestedKind;
  }
  const r = await api('GET', '/api/state');
  const model = requireReadResult(
    r,
    'state',
    (body) => isObject(body.model) && Array.isArray(body.model.slides)
  ).model;
  const slide = model.slides.find((item) => item.id === slideId);
  if (!slide) die(`no such slide: ${safeDisplay(slideId)}`);
  const isElement = Array.isArray(slide.elements) && slide.elements.some((item) => item.id === objectId);
  const isDecor = Array.isArray(slide.decor) && slide.decor.some((item) => item.id === objectId);
  if (isElement && isDecor) {
    die(`object id ${safeDisplay(objectId)} is ambiguous; use --kind element or --kind decor`);
  }
  if (!isElement && !isDecor) {
    die(`no such element or decor id: ${safeDisplay(objectId)} on slide ${safeDisplay(slideId)}`);
  }
  return isElement ? 'element' : 'decor';
}

async function cmdToggleProtection(makeProtected, pos, flags) {
  if (pos.length < 1 || pos.length > 2) {
    die(`usage: ${makeProtected ? 'protect' : 'unprotect'} sID [objectID] [--kind element|decor] [--task taskID]`);
  }
  if (pos.length === 1 && flags.kind !== undefined) {
    die('--kind is valid only when an objectID is supplied');
  }
  const body = {
    kind: pos.length === 1 ? 'slide' : 'object',
    slideId: pos[0],
    protected: makeProtected,
    by: EDITOR
  };
  if (flags.task !== undefined) {
    if (typeof flags.task !== 'string' || !flags.task.trim()) die('--task needs a task id');
    if (!makeProtected) die('--task delegated protection control may only add protections');
    if (pos.length !== 2) die('--task may protect only a generated picture decor object, not a whole slide');
    body.taskId = flags.task.trim();
    body.delegatedMode = 'direct-generated-decor';
  }
  if (pos.length === 2) {
    body.objectId = pos[1];
    body.objectKind = await protectionObjectKind(pos[0], pos[1], flags.kind);
  }
  const r = await api('POST', '/api/protections/toggle', body);
  if (r.status !== 200 || !validProtectionToggleResult(r.body, body)) {
    die(`${C.red}✗ ${safeDisplay(r.body && r.body.error) || `protection update failed (HTTP ${safeDisplay(r.status)})`}${C.reset}`, 1);
  }
  const target = body.kind === 'slide'
    ? `slide ${safeDisplay(body.slideId)}`
    : `${safeDisplay(body.objectKind)} ${safeDisplay(body.objectId)} on ${safeDisplay(body.slideId)}`;
  if (r.body.changed === false) {
    console.log(`${C.gray}(${target} was already ${makeProtected ? 'protected' : 'unprotected'})${C.reset}`);
    return;
  }
  if (body.kind === 'slide') {
    console.log(makeProtected
      ? `${C.yellow}🔒 protected${C.reset} ${target} ${C.gray}(all child overrides cleared)${C.reset}`
      : `${C.green}✓ unprotected${C.reset} ${target} ${C.gray}(all child locks cleared)${C.reset}`);
    return;
  }
  console.log(makeProtected
    ? `${C.yellow}🔒 protected${C.reset} ${target}`
    : `${C.green}✓ unprotected${C.reset} ${target}`);
}

async function cmdLocks(flags) {
  const r = await api('GET', '/api/locks');
  const locks = requireReadResult(r, 'locks', (x) => Array.isArray(x.locks)).locks;
  if (flags && flags.json) { console.log(safeJson(locks, null, 2)); return; }
  console.log('');
  console.log(`  ${C.bold}Slide Locks${C.reset}  ${C.gray}advisory claims, not enforced — ppt lock/unlock · ${server()}${C.reset}`);
  if (!locks.length) { console.log(`     ${C.gray}(none claimed — claim one with: ppt lock s4)${C.reset}\n`); return; }
  locks.forEach((l) => {
    const age = Math.round((Date.now() - l.ts) / 60000);
    const mine = l.by === EDITOR ? ` ${C.green}(you)${C.reset}` : '';
    console.log(`     ${C.yellow}🔒${C.reset} ${C.bold}${safeDisplay(l.slideId)}${C.reset}  ${C.cyan}${safeDisplay(l.by)}${C.reset}${mine}  ${C.gray}${age}m ago${l.note ? ` · ${safeDisplay(l.note)}` : ''}${C.reset}`);
  });
  console.log('');
}

async function cmdHistory(flags) {
  const r = await api('GET', '/api/history');
  const body = requireReadResult(r, 'history', (x) => Array.isArray(x.undo) && Array.isArray(x.redo));
  const undo = body.undo;
  const redo = body.redo;
  if (flags && flags.json) { console.log(safeJson({ undo, redo }, null, 2)); return; }
  console.log('');
  console.log(`  ${C.bold}Edit History${C.reset}  ${C.gray}most recent first · ppt undo/redo · ${server()}${C.reset}`);
  console.log(`\n  ${C.cyan}undoable${C.reset} ${C.gray}(ppt undo reverts the top one)${C.reset}`);
  if (!undo.length) console.log(`     ${C.gray}(nothing to undo)${C.reset}`);
  undo.slice(0, 15).forEach((h, i) => {
    const t = new Date(h.ts).toLocaleTimeString();
    console.log(`     ${i === 0 ? C.yellow + '→' + C.reset : ' '} ${C.bold}${safeDisplay(h.editor)}${C.reset} ${safeDisplay(h.detail)}  ${C.gray}${t}${C.reset}`);
  });
  if (redo.length) {
    console.log(`\n  ${C.cyan}redoable${C.reset} ${C.gray}(ppt redo re-applies the top one)${C.reset}`);
    redo.slice(0, 15).forEach((h, i) => {
      const t = new Date(h.ts).toLocaleTimeString();
      console.log(`     ${i === 0 ? C.yellow + '→' + C.reset : ' '} ${C.bold}${safeDisplay(h.editor)}${C.reset} ${safeDisplay(h.detail)}  ${C.gray}${t}${C.reset}`);
    });
  }
  console.log('');
}

const LINT_LABEL = {
  'dash': 'em/en dash', 'min-size': 'under 20pt', 'header-align': 'header alignment', 'speaker-notes': 'speaker notes',
  'font-family': 'font family'
};

async function cmdLint(flags) {
  const r = await api('GET', '/api/lint');
  const body = requireReadResult(r, 'lint', (x) =>
    Number.isInteger(x.rev) && typeof x.ok === 'boolean' &&
    Number.isInteger(x.count) && Array.isArray(x.issues), true);
  const { rev, ok, count, issues } = body;
  if (flags && flags.json) { console.log(safeJson(body, null, 2)); return; }
  console.log('');
  console.log(`  ${C.bold}Quality Lint${C.reset}  ${C.gray}rev ${rev}${C.reset}`);
  if (ok) { console.log(`\n     ${C.green}✓ clean, no violations found${C.reset}\n`); return; }
  console.log(`\n     ${C.yellow}${count} violation${count === 1 ? '' : 's'}${C.reset}`);
  issues.forEach((i) => {
    const where = i.elementId ? `${safeDisplay(i.slideId)} ${safeDisplay(i.elementId)}` : safeDisplay(i.slideId);
    console.log(`     ${C.red}✗${C.reset} ${C.gray}[${safeDisplay(LINT_LABEL[i.type] || i.type)}]${C.reset} ${C.bold}${where}${C.reset}  ${safeDisplay(i.detail)}${i.text ? `  ${C.gray}"${safeDisplay(i.text)}"${C.reset}` : ''}`);
  });
  console.log('');
}

function fmtMMSS(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

async function cmdTiming(flags) {
  const r = await api('GET', '/api/timing');
  const t = requireReadResult(r, 'timing', (x) =>
    typeof x.wpm === 'number' && typeof x.totalWords === 'number' &&
    typeof x.totalSeconds === 'number' && Array.isArray(x.perSlide));
  if (flags && flags.json) { console.log(safeJson(t, null, 2)); return; }
  console.log('');
  console.log(`  ${C.bold}Speaking-Time Estimate${C.reset}  ${C.gray}~${safeDisplay(t.wpm)}wpm, visible slide text only, not a real rehearsal${C.reset}`);
  (t.perSlide || []).forEach((s) => {
    console.log(`     ${C.gray}${safeDisplay(s.slideId)}${C.reset}  ${safeDisplay(String(s.words).padStart(4))} words  ${C.gray}~${fmtMMSS(s.seconds)}${C.reset}`);
  });
  const totalColor = t.overCap ? C.red : (t.overTarget ? C.yellow : C.green);
  console.log('');
  console.log(`     total  ${C.bold}${safeDisplay(t.totalWords)} words${C.reset}  ${totalColor}${C.bold}~${fmtMMSS(t.totalSeconds)}${C.reset}  ` +
    `${C.gray}(target ${fmtMMSS(t.targetSeconds)}, hard cap ${fmtMMSS(t.capSeconds)})${C.reset}`);
  if (t.overCap) console.log(`     ${C.red}⚠ over the 12:00 hard cap, trim the longest slides first${C.reset}`);
  else if (t.overTarget) console.log(`     ${C.yellow}⚠ over the 11:00 target, some headroom left before the hard cap${C.reset}`);
  console.log('');
}

async function cmdWatch() {
  console.log(`${C.gray}watching ${server()} … (Ctrl+C to stop)${C.reset}`);
  const hb = setInterval(heartbeat, 5000); heartbeat();

  let backoff = 1000;
  let stopped = false;
  let wasDown = false;
  let reconnectTimer = null;

  function connect() {
    if (stopped) return;
    let settled = false; // req/res can both fire for the same drop; only act once
    const onLost = () => {
      if (stopped || settled) return;
      settled = true;
      wasDown = true;
      console.log(`${C.yellow}⚠ lost connection to the suite server, retrying in ${Math.round(backoff / 1000)}s…${C.reset}`);
      reconnectTimer = setTimeout(connect, backoff);
      backoff = Math.min(backoff * 1.6, 8000);
    };
    let buf = '';
    const req = http.request({ host: HOST, port: PORT, path: '/api/events', method: 'GET' }, (res) => {
      backoff = 1000;
      if (wasDown) { wasDown = false; console.log(`${C.green}✓ reconnected${C.reset}`); }
      res.setEncoding('utf8');
      res.on('data', (c) => {
        buf += c;
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
          const line = chunk.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          let ev; try { ev = JSON.parse(line.slice(6)); } catch (_) { continue; }
          const t = new Date(ev.ts || Date.now()).toLocaleTimeString();
          if (ev.type === 'edit') console.log(`${C.gray}${t}${C.reset} ${C.green}✎${C.reset} ${quoteBoard(ev.editor)} ${C.dim}${quoteBoard(ev.detail)}${C.reset}`);
          else if (ev.type === 'pause') console.log(`${C.gray}${t}${C.reset} ${C.yellow}⏸  PAUSED by ${quoteBoard(ev.by)}${C.reset}`);
          else if (ev.type === 'resume') console.log(`${C.gray}${t}${C.reset} ${C.green}▶  RESUMED by ${quoteBoard(ev.by)}${C.reset}`);
          else if (ev.type === 'render') console.log(`${C.gray}${t}${C.reset} ${ev.ok ? C.blue + '⤓ rendered pptx' : C.red + 'render failed: ' + quoteBoard(ev.error)}${C.reset}`);
          else if (ev.type === 'persist') console.log(`${C.gray}${t}${C.reset} ${C.red}✖ SAVE FAILED (${quoteBoard(ev.file || 'disk')}): ${quoteBoard(ev.error || 'unknown error')}${C.reset}`);
          else if (ev.type === 'board' && ev.note) {
            const n = ev.note;
            if (ev.action === 'delete') console.log(`${C.gray}${t}${C.reset} ${C.gray}board: note removed${C.reset}`);
            else if (n.pinned) console.log(`${C.gray}${t}${C.reset} ${C.yellow}📌 ${quoteBoard(n.author)} pinned: ${quoteBoard(n.text)}${C.reset}`);
            else console.log(`${C.gray}${t}${C.reset} ${C.cyan}✉ ${quoteBoard(n.author)}:${C.reset} ${quoteBoard(n.text)}`);
          }
          else if (ev.type === 'editors') console.log(`${C.gray}${t} editors: ${ev.editors.map((e) => quoteBoard(e.name)).join(', ') || 'none'}${C.reset}`);
        }
      });
      res.on('error', onLost);
      res.on('end', onLost);
    });
    req.on('error', onLost);
    req.end();
  }

  connect();
  process.on('SIGINT', () => {
    stopped = true; clearInterval(hb); if (reconnectTimer) clearTimeout(reconnectTimer);

    Promise.race([
      api('POST', '/api/leave', { id: EDITOR }).catch(() => {}),
      new Promise((r) => setTimeout(r, 1000)),
    ]).then(() => process.exit(0));
  });
}

function openBrowser(url) {
  if (process.platform === 'win32') execFile('cmd', ['/c', 'start', '""', url]);
  else if (process.platform === 'darwin') execFile('open', [url]);
  else execFile('xdg-open', [url]);
}

async function main() {
  const [, , cmd, ...rest] = process.argv;
  const { flags, pos } = parseFlags(rest);

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(`
${C.bold}ppt${C.reset} — presentation suite editor

  ${C.cyan}status${C.reset}                         show pause state, deck summary, editors
  ${C.cyan}show${C.reset}                           print the deck outline with ids
  ${C.cyan}search${C.reset} "text" [--json]         find which slides mention text (titles, bullets, body, notes)
  ${C.cyan}title${C.reset} "text"                   set the presentation title
  ${C.cyan}add-slide${C.reset} [--layout L] [--title T] [--after sID] [--index n]
  ${C.cyan}delete-slide${C.reset} sID
  ${C.cyan}move-slide${C.reset} sID <index>
  ${C.cyan}set-layout${C.reset} sID <layout>        (title|content|bullets|section|titleonly|blank|two|compare)
  ${C.cyan}set-transition${C.reset} sID fade [--duration 0.35]
  ${C.cyan}set-transition${C.reset} sID none
                                         fade duration is seconds (0.1..10); advance is click-only, with no sound
  ${C.cyan}set-text${C.reset} sID eID "text"
  ${C.cyan}set-bullets${C.reset} sID eID "a" "b" …
  ${C.cyan}add-element${C.reset} sID <type> [--text "…" | --items a b …]  ${C.gray}(overlay mode: only works on a brand-new add-slide slide, warns otherwise)${C.reset}
  ${C.cyan}delete-element${C.reset} sID eID
  ${C.cyan}notes${C.reset} sID "speaker notes"
  ${C.cyan}pause${C.reset} | ${C.cyan}resume${C.reset} | ${C.cyan}render${C.reset} | ${C.cyan}watch${C.reset} | ${C.cyan}open${C.reset}
  ${C.cyan}view${C.reset} <home|slide|board|tasks|history|lint|timing|status|help> [--json]  local read-only view
  ${C.cyan}lint${C.reset} [--json]                  scan for readability and consistency (typographic dashes, sub-20pt, header alignment, font)
  ${C.cyan}time${C.reset} [--json]                  estimate speaking time from visible slide text (rough proxy, not a rehearsal)
  ${C.cyan}export-pdf${C.reset}                     export presentation.pdf via PowerPoint (download at /api/pdf)
  ${C.cyan}history${C.reset} [--json]               preview what's undoable/redoable, most recent first
  ${C.cyan}undo${C.reset} / ${C.cyan}redo${C.reset}                       step the deck back/forward one edit at a time (any op type; gated by pause)

  ${C.bold}color & style${C.reset} ${C.gray}(ppt show lists each element's current style + decor ids)${C.reset}
  ${C.cyan}set-color${C.reset} sID eID "#RRGGBB"        set a text element's run color
  ${C.cyan}set-bold${C.reset} sID eID true|false        set a text element's bold weight
  ${C.cyan}set-size${C.reset} sID eID <points>          set a text element's font size (lint suggests 20pt or larger)
  ${C.cyan}set-align${C.reset} sID eID left|center|right|justify
  ${C.cyan}set-font${C.reset} sID eID "Font Family Name"  set a text element's font (ppt lint flags whichever font is the deck-wide minority)
  ${C.cyan}set-fill${C.reset} sID targetID "#RRGGBB"    fill color; targetID is an element or decor id from ${C.cyan}ppt show${C.reset}
  ${C.cyan}set-outline${C.reset} sID eID "#RRGGBB"      outline color for a text-backed card element
  ${C.cyan}set-corners${C.reset} sID targetID sharp     convert an eligible imported box/card AutoShape to true 90-degree corners
  ${C.cyan}set-box${C.reset} sID targetID [--x N --y N --w N --h N]   reposition/resize imported shapes, generated decor, or native text; native text without a box needs all four values first
  ${C.cyan}add-shape${C.reset} sID "#RRGGBB" --x N --y N --w N --h N   add generated rectangle decor (suite-native or imported slide)
  ${C.cyan}add-image${C.reset} sID "assets/file.png" --x N --y N --w N --h N [--task tID]   add generated picture decor; granted tasks remain limited to their assigned slide and operation
  ${C.cyan}add-video${C.reset} sID "assets/file.mp4" --x N --y N --w N --h N [--autoplay true|false] [--loop true|false]   embed video on suite-native or imported slide
  ${C.cyan}set-image${C.reset} sID decorID "assets/file.png"   update generated picture source in place; id, box, order, and history are preserved
  ${C.cyan}set-media${C.reset} sID decorID [--source "assets/file.mp4"] [--autoplay true|false] [--loop true|false]   update generated video in place; id, box, order, and history are preserved
  ${C.cyan}set-animation${C.reset} sID targetID appear|fade|wipe|rise-up [--trigger click|with-previous|after-previous] [--duration N] [--delay N] [--index N]
  ${C.cyan}set-animation${C.reset} sID targetID none      remove that object's build
  ${C.cyan}delete-decor${C.reset} sID decorID             delete only a generated rectangle/image/video; imported/backed decor is refused
  ${C.cyan}set-theme${C.reset} --accent "#RRGGBB"   theme accent color (native-added slides only)

  ${C.bold}message board${C.reset} ${C.gray}(coordinate with other sessions — works even when paused)${C.reset}
  ${C.cyan}board${C.reset} [--json]                 read pinned house rules + recent messages
  ${C.cyan}note${C.reset} "message" [--as name]     post a message for the other editor sessions
  Pin and unpin guidance in the authenticated dashboard.
  ${C.cyan}note-rm${C.reset} <noteId>               delete a note from the board

  ${C.bold}team status & tasks${C.reset} ${C.gray}(who is free/busy + a shared to-do queue; work while paused)${C.reset}
  ${C.cyan}free${C.reset}                           mark yourself available for tasks
  ${C.cyan}busy${C.reset} "what you're doing"       mark yourself busy (shows on the dashboard)
  ${C.cyan}who${C.reset} [--json]                   list sessions and their free/busy status
  ${C.cyan}task${C.reset} "do X" [--for name]       add a task, optionally aimed at a session
  ${C.cyan}task-update${C.reset} <id> [--text "instructions"] [--for editor|--unassign]
  ${C.cyan}task-protection-grant${C.reset} <id> sID [sID2 ...] [--minutes 60]  human grants the assigned agent scoped protection control
  ${C.cyan}task-protection-revoke${C.reset} <id>                         human revokes that task-scoped grant
  ${C.cyan}tasks${C.reset} [--mine] [--json]        list open/claimed tasks
  ${C.cyan}claim${C.reset} <taskId>                 claim a task as yours
  ${C.cyan}done${C.reset} <taskId>                  mark a task done
  ${C.cyan}next${C.reset} [--claim]                 show (or claim) the next task for you
  ${C.cyan}task-rm${C.reset} <taskId>              delete a task

  ${C.bold}standing loops${C.reset} ${C.gray}(recurring checks the human sets; external clients run them)${C.reset}
  ${C.cyan}loops${C.reset} [--on] [--json]           list standing loops (--on = enabled only)
  ${C.cyan}loop${C.reset} "continuously check …" [--every 10m] [--as name]   add a standing loop
  ${C.cyan}loop-on${C.reset} / ${C.cyan}loop-off${C.reset} <loopId>      enable / disable a loop
  ${C.cyan}loop-rm${C.reset} <loopId>                delete a loop
  ${C.cyan}loop-ran${C.reset} <loopId> [--note "…"]   record that you just ran it

  ${C.bold}content protections${C.reset} ${C.gray}(durable hard locks controlled by humans; survive restart and block edit/undo/redo)${C.reset}
  ${C.cyan}protect${C.reset} sID [objectID] [--kind element|decor] [--task tID]     protect a whole slide or one element/decor/picture/media; delegated task mode is generated image objects only
  ${C.cyan}unprotect${C.reset} sID [objectID] [--kind element|decor]                human-unlock that exact stable target
  ${C.cyan}protections${C.reset} [--json]                            list durable content protections
  ${C.cyan}protections --history${C.reset} [--json]                  list durable lock/unlock decisions (an unlock is distinct from initial absence)

  ${C.bold}slide locks${C.reset} ${C.gray}(advisory only — never blocks an edit, just warns of collisions; auto-expire in 20m)${C.reset}
  ${C.cyan}lock${C.reset} sID [sID2 …] [--note "…"] [--force]   claim slides you're about to edit (--force takes an unexpired lock from someone else)
  ${C.cyan}unlock${C.reset} sID [sID2 …] | --all       release your claim
  ${C.cyan}locks${C.reset} [--json]                 list who holds what (also shown in ${C.cyan}ppt show${C.reset}/${C.cyan}status${C.reset})

  env: SUITE_EDITOR="${safeDisplay(EDITOR)}"  SUITE_PORT=${PORT}
`);
    return;
  }

  await ensureUp();
  await heartbeat();

  switch (cmd) {
    case 'status': return cmdStatus();
    case 'show': case 'outline': return cmdShow();
    case 'search': case 'find': return cmdSearch(pos[0], flags);
    // /studio explicitly, not '/': the root redirects there anyway, but naming
    // it keeps the printed URL honest about where you actually land.
    case 'open': { openBrowser(`${server()}/studio`); console.log(`opening ${server()}/studio`); return; }
    case 'watch': return cmdWatch();
    case 'lint': return cmdLint(flags);
    case 'time': case 'timing': return cmdTiming(flags);

    // ---- shared message board (works even while the deck is paused)
    case 'board': return cmdBoard(flags);
    case 'note': case 'pin': {
      const text = (pos.join(' ').trim()) || (typeof flags.text === 'string' ? flags.text : '');
      if (!text) die(`usage: ${safeDisplay(cmd)} "${cmd === 'pin' ? 'house rule' : 'message'}" [--as name]`);
      const author = (typeof flags.as === 'string' ? flags.as : EDITOR);
      const pinned = cmd === 'pin';
      const r = await api('POST', '/api/board', { text, author, pinned });
      if (r.status !== 200 || !r.body.ok) die(`${C.red}✗ ${safeDisplay(r.body.error || 'post failed')}${C.reset}`, 1);
      if (pinned) console.log(`${C.yellow}📌 pinned house rule${C.reset} ${C.gray}${safeDisplay(r.body.note.id)}${C.reset}`);
      else console.log(`${C.green}✓${C.reset} posted note ${C.gray}${safeDisplay(r.body.note.id)}${C.reset}`);
      return;
    }
    case 'unpin': {
      if (!pos[0]) die('usage: unpin <noteId>');
      const r = await api('POST', '/api/board/pin', { id: pos[0], pinned: false });
      if (r.status !== 200 || !r.body.ok) die(`${C.red}✗ ${safeDisplay(r.body.error || 'failed')}${C.reset}`, 1);
      console.log(`${C.green}✓${C.reset} unpinned ${C.gray}${safeDisplay(pos[0])}${C.reset}`); return;
    }
    case 'note-rm': case 'board-rm': {
      if (!pos[0]) die('usage: note-rm <noteId>');
      const r = await api('POST', '/api/board/delete', { id: pos[0] });
      if (r.status !== 200 || !r.body.ok) die(`${C.red}✗ ${safeDisplay(r.body.error || 'failed')}${C.reset}`, 1);
      console.log(`${C.green}✓${C.reset} removed ${C.gray}${safeDisplay(pos[0])}${C.reset}`); return;
    }

    // ---- team status + shared task list (work even while the deck is paused)
    case 'free': { await setStatus('free', ''); console.log(`${C.green}● free${C.reset} ${C.gray}(available for tasks)${C.reset}`); return; }
    case 'busy': {
      const what = (pos.join(' ').trim()) || (typeof flags.text === 'string' ? flags.text : '');
      await setStatus('busy', what);
      console.log(`${C.yellow}● busy${C.reset}${what ? ` ${C.gray}${safeDisplay(what)}${C.reset}` : ''}`);
      return;
    }
    case 'who': case 'sessions': return cmdWho(flags);
    case 'tasks': return cmdTasks(flags);
    case 'task': {
      const text = (pos.join(' ').trim()) || (typeof flags.text === 'string' ? flags.text : '');
      if (!text) die('usage: task "what to do" [--for name]');
      const assignee = (typeof flags.for === 'string' ? flags.for : '');
      const r = await api('POST', '/api/tasks', {
        text, by: EDITOR, assignee,
      });
      if (r.status !== 200 || !r.body.ok) die(`${C.red}✗ ${safeDisplay(r.body.error || 'failed')}${C.reset}`, 1);
      console.log(`${C.green}✓${C.reset} task ${C.bold}${safeDisplay(r.body.task.id)}${C.reset}${assignee ? ` ${C.cyan}→ ${safeDisplay(assignee)}${C.reset}` : ` ${C.gray}(unassigned)${C.reset}`}`);
      return;
    }
    case 'task-update': {
      if (!pos[0]) die('usage: task-update <id> [--text "instructions"] [--for editor|--unassign]');
      if (flags.wake !== undefined) die('Unsupported flag: --wake');
      const body = {id:pos[0], by:EDITOR};
      if (flags.text !== undefined) {
        if (typeof flags.text !== 'string') die('--text needs an instruction');
        body.text = flags.text;
      }
      if (flags.for !== undefined && flags.unassign !== undefined) die('Use either --for or --unassign');
      if (flags.for !== undefined) {
        if (typeof flags.for !== 'string') die('--for needs an editor name');
        body.assignee = flags.for;
      }
      if (flags.unassign !== undefined) {
        if (flags.unassign !== true) die('--unassign takes no value');
        body.assignee = '';
      }
      if (!Object.hasOwn(body, 'text') && !Object.hasOwn(body, 'assignee')) die('Task update needs --text, --for or --unassign');
      const r = await api('POST', '/api/tasks/update', body);
      if (r.status !== 200 || !r.body.ok) die(r.body.error || 'Task update failed', 1);
      console.log(`Updated ${safeDisplay(r.body.task.id)} for ${quoteBoard(r.body.task.assignee || 'any editor')}`);
      return;
    }
    case 'task-protection-grant': {
      if (pos.length < 2) die('usage: task-protection-grant <taskId> sID [sID2 ...] [--minutes 60]');
      const minutes = flags.minutes === undefined ? 60 : strictInteger(flags.minutes, '--minutes');
      if (minutes < 1 || minutes > 240) die('--minutes must be from 1 to 240');
      const r = await api('POST', '/api/tasks/protection-grant', {
        id: pos[0], slideIds: pos.slice(1), minutes, by: EDITOR
      });
      if (r.status !== 200 || !r.body.ok) die(`${C.red}[error] ${safeDisplay(r.body.error || 'failed')}${C.reset}`, 1);
      const grant = r.body.task && r.body.task.protectionGrant;
      console.log(`${C.green}[ok]${C.reset} protection control granted to ${quoteBoard(r.body.task.assignee || r.body.task.claimedBy)} for ${grant.slideIds.map(safeDisplay).join(', ')} until ${new Date(grant.expiresAt).toLocaleString()}`);
      return;
    }
    case 'task-protection-revoke': {
      if (pos.length !== 1) die('usage: task-protection-revoke <taskId>');
      const r = await api('POST', '/api/tasks/protection-grant', {
        id: pos[0], revoke: true, by: EDITOR
      });
      if (r.status !== 200 || !r.body.ok) die(`${C.red}[error] ${safeDisplay(r.body.error || 'failed')}${C.reset}`, 1);
      console.log(r.body.changed
        ? `${C.green}[ok]${C.reset} revoked protection control for ${safeDisplay(pos[0])}`
        : `${C.gray}(task ${safeDisplay(pos[0])} had no active protection grant)${C.reset}`);
      return;
    }
    case 'claim': {
      if (!pos[0]) die('usage: claim <taskId>');
      const r = await api('POST', '/api/tasks/claim', { id: pos[0], by: EDITOR });
      if (r.status !== 200 || !r.body.ok) die(`${C.red}✗ ${safeDisplay(r.body.error || 'failed')}${C.reset}`, 1);
      console.log(`${C.green}✓${C.reset} claimed ${C.gray}${safeDisplay(pos[0])}${C.reset}: ${safeDisplay(r.body.task.text)}`);
      return;
    }
    case 'done': case 'task-done': {
      if (!pos[0]) die('usage: done <taskId>');
      const r = await api('POST', '/api/tasks/done', { id: pos[0], by: EDITOR });
      if (r.status !== 200 || !r.body.ok) die(`${C.red}✗ ${safeDisplay(r.body.error || 'failed')}${C.reset}`, 1);
      console.log(`${C.green}✓${C.reset} done ${C.gray}${safeDisplay(pos[0])}${C.reset}`);
      return;
    }
    case 'next': {
      const claim = !!flags.claim;
      const r = await api('POST', '/api/tasks/next', { by: EDITOR, claim });
      const t = r.body && r.body.task;
      if (!t) { console.log(`${C.gray}no open task for ${safeDisplay(EDITOR)}${C.reset}`); return; }
      console.log(`${claim ? C.green + '✓ claimed ' : C.cyan + 'next '}${C.reset}${C.bold}${safeDisplay(t.id)}${C.reset}: ${safeDisplay(t.text)}${t.assignee ? ` ${C.gray}(for ${safeDisplay(t.assignee)})${C.reset}` : ''}`);
      return;
    }
    case 'task-rm': {
      if (!pos[0]) die('usage: task-rm <taskId>');
      const r = await api('POST', '/api/tasks/delete', { id: pos[0] });
      if (r.status !== 200 || !r.body.ok) die(`${C.red}✗ ${safeDisplay(r.body.error || 'failed')}${C.reset}`, 1);
      console.log(`${C.green}✓${C.reset} removed ${C.gray}${safeDisplay(pos[0])}${C.reset}`);
      return;
    }
    case 'loops': return cmdLoops(flags);
    case 'loop': {
      const text = (pos.join(' ').trim()) || (typeof flags.text === 'string' ? flags.text : '');
      if (!text) die('usage: loop "continuously check …" [--every 10m] [--as name]');
      const author = (typeof flags.as === 'string' ? flags.as : EDITOR);
      const cadence = (typeof flags.every === 'string' ? flags.every : (typeof flags.cadence === 'string' ? flags.cadence : ''));
      const r = await api('POST', '/api/loops', { text, author, cadence });
      if (r.status !== 200 || !r.body.ok) die(`${C.red}✗ ${safeDisplay(r.body.error || 'failed')}${C.reset}`, 1);
      console.log(`${C.green}🔁 added loop${C.reset} ${C.bold}${safeDisplay(r.body.loop.id)}${C.reset}${cadence ? ` ${C.gray}every ${safeDisplay(cadence)}${C.reset}` : ''}`);
      return;
    }
    case 'loop-on': case 'loop-off': {
      if (!pos[0]) die(`usage: ${safeDisplay(cmd)} <loopId>`);
      const enabled = cmd === 'loop-on';
      const r = await api('POST', '/api/loops/toggle', { id: pos[0], enabled });
      if (r.status !== 200 || !r.body.ok) die(`${C.red}✗ ${safeDisplay(r.body.error || 'failed')}${C.reset}`, 1);
      console.log(`${enabled ? C.green + '● on' : C.gray + '○ off'}${C.reset} ${C.gray}${safeDisplay(pos[0])}${C.reset}`);
      return;
    }
    case 'loop-rm': {
      if (!pos[0]) die('usage: loop-rm <loopId>');
      const r = await api('POST', '/api/loops/delete', { id: pos[0] });
      if (r.status !== 200 || !r.body.ok) die(`${C.red}✗ ${safeDisplay(r.body.error || 'failed')}${C.reset}`, 1);
      console.log(`${C.green}✓${C.reset} removed ${C.gray}${safeDisplay(pos[0])}${C.reset}`);
      return;
    }
    case 'loop-ran': {
      if (!pos[0]) die('usage: loop-ran <loopId> [--note "what you found or fixed"]');
      const result = (typeof flags.note === 'string' ? flags.note : '');
      const r = await api('POST', '/api/loops/ran', { id: pos[0], by: EDITOR, result });
      if (r.status !== 200 || !r.body.ok) die(`${C.red}✗ ${safeDisplay(r.body.error || 'failed')}${C.reset}`, 1);
      console.log(`${C.green}✓${C.reset} recorded run of ${C.gray}${safeDisplay(pos[0])}${C.reset}`);
      return;
    }

    // ---- durable content protections (hard locks; human-controlled)
    case 'protections': return cmdProtections(flags);
    case 'protect': return cmdToggleProtection(true, pos, flags);
    case 'unprotect': return cmdToggleProtection(false, pos, flags);

    // ---- advisory slide locks (heads-up only; edits are never blocked by these)
    case 'locks': return cmdLocks(flags);
    case 'lock': {
      if (!pos.length) die('usage: lock sID [sID2 …] [--note "what you\'re doing"] [--force]');
      const note = (typeof flags.note === 'string' ? flags.note : '');
      const r = await api('POST', '/api/locks', { slideIds: pos, by: EDITOR, note, force: !!flags.force });
      if (r.status !== 200 || !r.body.ok) die(`${C.red}✗ ${safeDisplay(r.body.error || 'failed')}${C.reset}`, 1);
      console.log(`${C.yellow}🔒 locked${C.reset} ${r.body.locked.map(safeDisplay).join(', ') || '(none)'}`);
      // server.js's only conflicts.push() always sets refused:true (a live
      // lock is refused unless --force is passed, never silently
      // reassigned), so this always renders the same message; no live path
      // produces a conflict entry that isn't a refusal.
      (r.body.conflicts || []).forEach((c) => console.log(
        `${C.red}✗ ${safeDisplay(c.slideId)} is held by ${safeDisplay(c.heldBy)} (${Math.round(c.heldForMs / 60000)}m ago), not taken: coordinate on the board, or use --force to take it anyway${C.reset}`));
      (r.body.unknown || []).forEach((id) => console.log(`${C.red}✗ no such slide: ${safeDisplay(id)}${C.reset}`));
      return;
    }
    case 'unlock': {
      const all = !!flags.all;
      if (!all && !pos.length) die('usage: unlock sID [sID2 …]  |  unlock --all');
      const r = await api('POST', '/api/locks/release', { slideIds: all ? 'all' : pos, by: EDITOR });
      if (r.status !== 200 || !r.body.ok) die(`${C.red}✗ ${safeDisplay(r.body.error || 'failed')}${C.reset}`, 1);
      console.log(r.body.released ? `${C.green}✓ unlocked${C.reset}` : `${C.gray}(nothing to unlock)${C.reset}`);
      (r.body.notMine || []).forEach((id) => console.log(`${C.gray}· ${safeDisplay(id)} is held by someone else, left alone${C.reset}`));
      return;
    }

    case 'pause': {
      const r = await api('POST', '/api/pause', { by: EDITOR });
      requireControlResult(r, 'pause', true);
      console.log(`${C.yellow}⏸  paused${C.reset}`);
      return;
    }
    case 'resume': {
      const r = await api('POST', '/api/resume', { by: EDITOR });
      requireControlResult(r, 'resume', false);
      console.log(`${C.green}▶  resumed${C.reset}`);
      return;
    }
    case 'render': {

      const r = await api('POST', '/api/render');
      if (r.status === 423) {
        die(`${C.yellow}⏸  PAUSED${C.reset} — render was refused${r.body && r.body.pausedBy ? ` by ${safeDisplay(r.body.pausedBy)}` : ''}. ` +
            `Press Resume on the dashboard to continue.`, 3);
      }
      if (r.status === 404) {

        die(`${C.red}✗ server restart required: /api/render is not available; no render edit was sent${C.reset}`, 1);
      }
      if (r.status !== 200 || !r.body || r.body.ok === false) {
        die(`${C.red}✗ ${safeDisplay(r.body && r.body.error) || `render failed (HTTP ${safeDisplay(r.status)})`}${C.reset}`, 1);
      }
      console.log(`${C.green}✓${C.reset} re-render triggered`);
      return;
    }
    case 'export-pdf': case 'pdf': {
      console.log(`${C.gray}exporting PDF via PowerPoint (a few seconds)…${C.reset}`);
      const r = await api('POST', '/api/pdf/export', {}, 180000);
      if (r.status !== 200 || !r.body.ok) die(`${C.red}✗ ${safeDisplay(r.body.error || 'pdf export failed')}${C.reset}`, 1);
      console.log(`${C.green}✓ exported${C.reset} ${C.gray}(deck rev ${safeDisplay(r.body.rev)})${C.reset}  ${C.cyan}${server()}/api/pdf${C.reset}`);
      return;
    }

    case 'history': return cmdHistory(flags);
    case 'undo': {
      const r = await api('POST', '/api/undo', { editor: EDITOR });
      if (r.status === 423) {
        if (r.body && (r.body.error === 'protected' || r.body.protection)) {
          die(`${C.yellow}🔒 PROTECTED${C.reset} — ${safeDisplay(r.body.message || 'undo would change protected content; a human must unprotect it first')}.`, 4);
        }
        die(`${C.yellow}⏸  PAUSED${C.reset} — undo is an edit too, it's locked${r.body.pausedBy ? ` by ${safeDisplay(r.body.pausedBy)}` : ''}.`, 3);
      }
      if (r.status !== 200 || !r.body.ok) die(`${C.red}✗ ${safeDisplay(r.body.error || 'undo failed')}${C.reset}`, 1);
      const u = r.body.undone;
      console.log(`${C.green}✓ undid${C.reset} ${C.bold}${safeDisplay(u.editor)}${C.reset}'s ${safeDisplay(u.detail)}  ${C.gray}(now rev ${safeDisplay(r.body.rev)})${C.reset}`);
      return;
    }
    case 'redo': {
      const r = await api('POST', '/api/redo', { editor: EDITOR });
      if (r.status === 423) {
        if (r.body && (r.body.error === 'protected' || r.body.protection)) {
          die(`${C.yellow}🔒 PROTECTED${C.reset} — ${safeDisplay(r.body.message || 'redo would change protected content; a human must unprotect it first')}.`, 4);
        }
        die(`${C.yellow}⏸  PAUSED${C.reset} — redo is an edit too, it's locked${r.body.pausedBy ? ` by ${safeDisplay(r.body.pausedBy)}` : ''}.`, 3);
      }
      if (r.status !== 200 || !r.body.ok) die(`${C.red}✗ ${safeDisplay(r.body.error || 'redo failed')}${C.reset}`, 1);
      const u = r.body.redone;
      console.log(`${C.green}✓ redid${C.reset} ${C.bold}${safeDisplay(u.editor)}${C.reset}'s ${safeDisplay(u.detail)}  ${C.gray}(now rev ${safeDisplay(r.body.rev)})${C.reset}`);
      return;
    }

    case 'title': { if (!pos[0]) die('usage: title "New Title"'); await edit({ type: 'set-presentation-title', text: pos[0] }); console.log(`${C.green}✓${C.reset} title set`); return; }

    case 'add-slide': {
      const r = await edit({ type: 'add-slide', layout: flags.layout || 'content', title: flags.title, after: flags.after, index: flags.index != null ? strictInteger(flags.index, 'index') : undefined });
      console.log(`${C.green}✓${C.reset} added slide ${C.bold}${safeDisplay(r.affected.slideId)}${C.reset} (rev ${safeDisplay(r.rev)})`);
      return;
    }
    case 'delete-slide': { if (!pos[0]) die('usage: delete-slide sID'); await edit({ type: 'delete-slide', slideId: pos[0] }); console.log(`${C.green}✓${C.reset} slide deleted`); return; }
    case 'move-slide': { if (pos.length < 2) die('usage: move-slide sID <index>'); await edit({ type: 'move-slide', slideId: pos[0], index: strictInteger(pos[1], 'index') }); console.log(`${C.green}✓${C.reset} slide moved`); return; }
    case 'set-layout': { if (pos.length < 2) die('usage: set-layout sID <layout>'); await edit({ type: 'set-layout', slideId: pos[0], layout: pos[1] }); console.log(`${C.green}✓${C.reset} layout set`); return; }
    case 'set-transition': {
      if (pos.length !== 2) die('usage: set-transition sID fade [--duration 0.35] | set-transition sID none');
      const [slideId, effect] = pos;
      if (effect !== 'fade' && effect !== 'none') die('effect must be fade or none');
      if (effect === 'none') {
        if (flags.duration !== undefined) die('duration is only valid for fade');
        const r = await edit({ type: 'set-transition', slideId, effect: 'none' });
        console.log(`${C.green}✓${C.reset} transition set to none (click-only, no sound; rev ${safeDisplay(r.rev)})`);
        return;
      }
      const duration = flags.duration === undefined ? 0.35 : strictNumber(flags.duration, 'duration');
      if (duration < 0.1 || duration > 10) die('duration must be from 0.1 to 10 seconds');
      const r = await edit({ type: 'set-transition', slideId, effect: 'fade', duration });
      console.log(`${C.green}✓${C.reset} transition set to fade ${duration}s (click-only, no sound; rev ${safeDisplay(r.rev)})`);
      return;
    }
    case 'notes': { if (pos.length < 2) die('usage: notes sID "text"'); await edit({ type: 'set-notes', slideId: pos[0], text: pos[1] }); console.log(`${C.green}✓${C.reset} notes set`); return; }

    case 'set-text': { if (pos.length < 3) die('usage: set-text sID eID "text"'); const r = await edit({ type: 'set-text', slideId: pos[0], elementId: pos[1], text: pos[2] }); console.log(`${C.green}✓${C.reset} text set (rev ${safeDisplay(r.rev)})`); return; }
    case 'set-bullets': { if (pos.length < 3) die('usage: set-bullets sID eID "a" "b" …'); const r = await edit({ type: 'set-bullets', slideId: pos[0], elementId: pos[1], items: pos.slice(2) }); console.log(`${C.green}✓${C.reset} bullets set (rev ${safeDisplay(r.rev)})`); return; }

    case 'add-element': {
      if (pos.length < 2) die('usage: add-element sID <type> [--text ".." | --items a b ..]');
      const op = { type: 'add-element', slideId: pos[0], elementType: pos[1] };

      if (typeof flags.items === 'string') op.items = [flags.items, ...pos.slice(2)];
      else if (pos.length > 2) op.items = pos.slice(2);
      else op.text = flags.text || '';
      const r = await edit(op); console.log(`${C.green}✓${C.reset} added ${safeDisplay(pos[1])} ${C.bold}${safeDisplay(r.affected.elementId)}${C.reset}`); return;
    }
    case 'delete-element': { if (pos.length < 2) die('usage: delete-element sID eID'); await edit({ type: 'delete-element', slideId: pos[0], elementId: pos[1] }); console.log(`${C.green}✓${C.reset} element deleted`); return; }

    case 'set-color': {
      if (pos.length < 3) die('usage: set-color sID eID "#RRGGBB"');
      const r = await edit({ type: 'set-style', slideId: pos[0], elementId: pos[1], color: pos[2] });
      console.log(`${C.green}✓${C.reset} color set (rev ${safeDisplay(r.rev)})`); return;
    }
    case 'set-bold': {
      if (pos.length < 3) die('usage: set-bold sID eID true|false');
      const r = await edit({ type: 'set-style', slideId: pos[0], elementId: pos[1], bold: strictBoolean(pos[2], 'bold') });
      console.log(`${C.green}✓${C.reset} bold set (rev ${safeDisplay(r.rev)})`); return;
    }
    case 'set-size': {
      if (pos.length < 3) die('usage: set-size sID eID <points>');
      const r = await edit({ type: 'set-style', slideId: pos[0], elementId: pos[1], size: strictNumber(pos[2], 'size') });
      console.log(`${C.green}✓${C.reset} size set (rev ${safeDisplay(r.rev)})`); return;
    }
    case 'set-align': {
      if (pos.length < 3) die('usage: set-align sID eID left|center|right|justify');
      const r = await edit({ type: 'set-style', slideId: pos[0], elementId: pos[1], align: pos[2] });
      console.log(`${C.green}✓${C.reset} align set (rev ${safeDisplay(r.rev)})`); return;
    }
    case 'set-font': {
      if (pos.length < 3) die('usage: set-font sID eID "Font Family Name"');
      const r = await edit({ type: 'set-style', slideId: pos[0], elementId: pos[1], font: pos[2] });
      console.log(`${C.green}✓${C.reset} font set (rev ${safeDisplay(r.rev)})`); return;
    }
    case 'set-fill': {
      if (pos.length < 3) die('usage: set-fill sID targetID "#RRGGBB"  (targetID = an element id or decor id from ppt show)');
      const r = await edit({ type: 'set-fill', slideId: pos[0], elementId: pos[1], decorId: pos[1], color: pos[2] });
      console.log(`${C.green}✓${C.reset} fill set (rev ${safeDisplay(r.rev)})`); return;
    }
    case 'set-outline': {
      if (pos.length < 3) die('usage: set-outline sID eID "#RRGGBB"');
      const r = await edit({ type: 'set-outline', slideId: pos[0], elementId: pos[1], color: pos[2] });
      console.log(`${C.green}OK${C.reset} outline set (rev ${safeDisplay(r.rev)})`); return;
    }
    case 'set-corners': {
      if (pos.length !== 3 || pos[2] !== 'sharp') {
        die('usage: set-corners sID targetID sharp  (eligible imported box/card AutoShapes only)');
      }
      const r = await edit({
        type: 'set-corners',
        slideId: pos[0],
        targetId: pos[1],
        corners: pos[2],
      });
      console.log(`${C.green}✓${C.reset} corners set to sharp on ${safeDisplay(pos[1])} (rev ${safeDisplay(r.rev)})`); return;
    }
    case 'set-box': {
      if (pos.length < 2) die('usage: set-box sID targetID [--x N] [--y N] [--w N] [--h N]  (targetID = an element id or decor id from ppt show; x/y/w/h are fractions 0..1 of slide width/height)');
      const op = { type: 'set-box', slideId: pos[0], elementId: pos[1], decorId: pos[1] };
      for (const k of ['x', 'y', 'w', 'h']) {
        if (flags[k] !== undefined) op[k] = strictNumber(flags[k], k);
      }
      if (op.x === undefined && op.y === undefined && op.w === undefined && op.h === undefined) {
        die('usage: set-box sID targetID --x N --y N --w N --h N  (at least one of x/y/w/h, fractions 0..1 of slide width/height)');
      }
      const r = await edit(op);
      console.log(`${C.green}✓${C.reset} box set (rev ${safeDisplay(r.rev)})`); return;
    }
    case 'add-shape': {
      if (pos.length !== 2 || ['x', 'y', 'w', 'h'].some((k) => flags[k] === undefined)) {
        die('usage: add-shape sID "#RRGGBB" --x N --y N --w N --h N  (generated rectangle on a suite-native or imported slide; coordinates are fractions 0..1)');
      }
      const op = {
        type: 'add-shape',
        slideId: pos[0],
        shapeType: 'rect',
        fill: strictHex(pos[1], 'fill'),
        x: strictUnitNumber(flags.x, 'x', false),
        y: strictUnitNumber(flags.y, 'y', false),
        w: strictUnitNumber(flags.w, 'w', true),
        h: strictUnitNumber(flags.h, 'h', true),
      };
      const r = await edit(op);
      console.log(`${C.green}✓${C.reset} added generated rectangle ${C.bold}${safeDisplay(r.affected.decorId)}${C.reset} (rev ${safeDisplay(r.rev)})`); return;
    }
    case 'add-image': {
      if (pos.length !== 2 || ['x', 'y', 'w', 'h'].some((k) => flags[k] === undefined)) {
        die('usage: add-image sID "assets/file.png" --x N --y N --w N --h N [--task taskID]  (PNG/JPEG/GIF inside this project assets folder)');
      }
      const taskId = flags.task === undefined
        ? undefined
        : (typeof flags.task === 'string' && flags.task.trim() ? flags.task.trim() : die('--task needs a task id'));
      const r = await edit({
        type: 'add-image',
        slideId: pos[0],
        source: pos[1],
        x: strictUnitNumber(flags.x, 'x', false),
        y: strictUnitNumber(flags.y, 'y', false),
        w: strictUnitNumber(flags.w, 'w', true),
        h: strictUnitNumber(flags.h, 'h', true),
      }, taskId);
      console.log(`${C.green}✓${C.reset} added local image ${C.bold}${safeDisplay(r.affected.decorId)}${C.reset} (rev ${safeDisplay(r.rev)})`); return;
    }
    case 'add-video': {
      if (pos.length !== 2 || ['x', 'y', 'w', 'h'].some((k) => flags[k] === undefined)) {
        die('usage: add-video sID "assets/file.mp4" --x N --y N --w N --h N [--autoplay true|false] [--loop true|false]  (H.264 MP4 inside this project assets folder; embedded, not linked)');
      }
      const autoplay = flags.autoplay === undefined ? true : strictBoolean(flags.autoplay, 'autoplay');
      const loop = flags.loop === undefined ? true : strictBoolean(flags.loop, 'loop');
      const r = await edit({
        type: 'add-video',
        slideId: pos[0],
        source: pos[1],
        x: strictUnitNumber(flags.x, 'x', false),
        y: strictUnitNumber(flags.y, 'y', false),
        w: strictUnitNumber(flags.w, 'w', true),
        h: strictUnitNumber(flags.h, 'h', true),
        autoplay,
        loop,
      });
      console.log(`${C.green}✓${C.reset} added embedded video ${C.bold}${safeDisplay(r.affected.decorId)}${C.reset} autoplay=${autoplay ? 'on' : 'off'} loop=${loop ? 'on' : 'off'} (rev ${safeDisplay(r.rev)})`); return;
    }
    case 'set-image': {
      if (pos.length !== 3) {
        die('usage: set-image sID decorID "assets/file.png"  (updates an existing generated picture source without changing its id, box, or order)');
      }
      const r = await edit({ type: 'set-image', slideId: pos[0], decorId: pos[1], source: pos[2] });
      console.log(`${C.green}✓${C.reset} updated image ${C.bold}${safeDisplay(pos[1])}${C.reset} source=${safeDisplay(pos[2])} (rev ${safeDisplay(r.rev)})`); return;
    }
    case 'set-media': {
      if (pos.length !== 2) {
        die('usage: set-media sID decorID [--source "assets/file.mp4"] [--autoplay true|false] [--loop true|false]  (updates an existing generated video without changing its id, box, or order)');
      }
      const op = { type: 'set-media', slideId: pos[0], decorId: pos[1] };
      const changes = [];
      if (flags.source !== undefined) {
        if (typeof flags.source !== 'string' || !flags.source.trim()) {
          die('source must be a non-empty MP4 path');
        }
        op.source = flags.source;
        changes.push(`source=${flags.source}`);
      }
      if (flags.autoplay !== undefined) {
        op.autoplay = strictBoolean(flags.autoplay, 'autoplay');
        changes.push(`autoplay=${op.autoplay ? 'on' : 'off'}`);
      }
      if (flags.loop !== undefined) {
        op.loop = strictBoolean(flags.loop, 'loop');
        changes.push(`loop=${op.loop ? 'on' : 'off'}`);
      }
      if (!changes.length) {
        die('set-media needs at least one of --source, --autoplay, or --loop');
      }
      const r = await edit(op);
      console.log(`${C.green}✓${C.reset} updated embedded video ${C.bold}${safeDisplay(pos[1])}${C.reset} ${changes.map(safeDisplay).join(' ')} (rev ${safeDisplay(r.rev)})`); return;
    }
    case 'set-animation': {
      if (pos.length !== 3) {
        die('usage: set-animation sID targetID appear|fade|wipe|rise-up [--trigger click|with-previous|after-previous] [--duration N] [--delay N] [--index N] | set-animation sID targetID none');
      }
      const effect = pos[2];
      if (!['appear', 'fade', 'wipe', 'rise-up', 'none'].includes(effect)) {
        die('effect must be appear, fade, wipe, rise-up, or none');
      }
      const op = { type: 'set-animation', slideId: pos[0], targetId: pos[1], effect };
      if (flags.trigger !== undefined) op.trigger = flags.trigger;
      if (flags.duration !== undefined) op.duration = strictNumber(flags.duration, 'duration');
      if (flags.delay !== undefined) op.delay = strictNumber(flags.delay, 'delay');
      if (flags.index !== undefined) op.index = strictInteger(flags.index, 'index');
      const r = await edit(op);
      console.log(`${C.green}✓${C.reset} animation ${effect === 'none' ? 'removed' : 'set'} on ${safeDisplay(pos[1])} (rev ${safeDisplay(r.rev)})`); return;
    }
    case 'delete-decor': {
      if (pos.length !== 2) die('usage: delete-decor sID decorID  (only generated rectangle/image/video overlays can be deleted)');
      const r = await edit({ type: 'delete-decor', slideId: pos[0], decorId: pos[1] });
      console.log(`${C.green}✓${C.reset} deleted generated object ${safeDisplay(pos[1])} (rev ${safeDisplay(r.rev)})`); return;
    }
    case 'set-theme': {
      const accent = typeof flags.accent === 'string' ? flags.accent : undefined;
      if (!accent) die('usage: set-theme --accent "#RRGGBB"');
      const r = await edit({ type: 'set-theme', accent });
      console.log(`${C.green}✓${C.reset} theme set (rev ${safeDisplay(r.rev)})`); return;
    }

    default: die(`unknown command: ${safeDisplay(cmd)}  (try: ppt help)`, 1);
  }
}

main().catch((e) => die(`${C.red}error: ${safeDisplay(e.message)}${C.reset}`, 1));
