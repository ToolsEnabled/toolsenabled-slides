#!/usr/bin/env node
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('./lib/helper-paths');
const crypto = require('crypto');
const {editorColor, isExternalEditor} = require('./lib/editors');

const HERE = path.resolve(__dirname, '..');                                  // .../suite
const ROOT = process.env.SLIDES_WORKSPACE ? path.resolve(process.env.SLIDES_WORKSPACE) : path.resolve(HERE, '..');                  // .../Presentation
const DATA = process.env.SLIDES_WORKSPACE ? path.join(ROOT, '.slides-state') : path.join(HERE, 'data');
fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });
if (process.env.SLIDES_WORKSPACE) {
  // A refused lease is an expected condition: report it in one line, never as a stack trace.
  try { require('./lib/workspace').lease(DATA); }
  catch (error) { console.error(error.message); process.exit(1); }
}
const PUBLIC = path.join(HERE, 'public');
const MODEL_PATH = path.join(DATA, 'model.json');
const STATE_PATH = path.join(DATA, 'state.json');
const BOARD_PATH = path.join(DATA, 'board.json');
const ELEMENT_HISTORY_PATH = path.join(DATA, 'element-history.json');
const ELEMENT_HISTORY_PENDING_PATH = path.join(DATA, 'element-history.pending.json');
const RENDER_STATE_PATH = path.join(DATA, 'render-state.json');
const PPTX_PATH = path.join(ROOT, 'presentation.pptx');
const RENDER_PY = path.join(HERE, 'src/python/render_pptx.py');
const LINT_FONTS_PY = path.join(HERE, 'src/python/lint_fonts.py');
const THUMBS_PS1 = path.join(HERE, 'scripts/windows/export_thumbs.ps1');
const THUMBS_DIR = path.join(DATA, 'thumbs');
const THUMBS_SRC = path.join(DATA, 'thumbs-src.pptx'); // snapshot exported FROM, so a concurrent render can't rewrite the file the COM host has open
const PDF_PS1 = path.join(HERE, 'scripts/windows/export_pdf.ps1');
const PDF_PATH = path.join(DATA, 'presentation.pdf');
const COM_HOST_PS1 = path.join(HERE, 'scripts/windows/com_host.ps1');
const COM_HOST_PID_PATH = path.join(DATA, 'com_host.pid.json');

const PORT = parseInt(process.env.SUITE_PORT || '4599', 10);
const HOST = process.env.SUITE_HOST || '127.0.0.1';
if (!['127.0.0.1', 'localhost', '::1'].includes(HOST)) throw new Error('Slides must bind to loopback');
const dashboardSession = require('./lib/dashboard-session').createDashboardSession(PORT);
const PY = require('./lib/prerequisites').python();
const EDITOR_TTL = 15000;      // ms before a silent editor is considered gone
const LOCK_TTL = 20 * 60 * 1000;   // ms before an unrefreshed slide lock auto-expires
const UNDO_LIMIT = 50;         // max entries kept on either the undo or redo stack
const PROTECTION_HISTORY_LIMIT = 200; // dedicated approval/rejection audit, independent of the mixed activity log
const ELEMENT_HISTORY_VISIBLE_LIMIT = 10;
const ELEMENT_HISTORY_ARCHIVE_LIMIT = 100;
const ELEMENT_HISTORY_RESTORE_UNDO_LIMIT = 3;
const IS_WIN = process.platform === 'win32';
const BOOTED_AT = Date.now();
const INSTANCE_ID = crypto.randomBytes(24).toString('hex');
const PROJECT_ASSETS = path.join(ROOT, 'assets');
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif']);
const VIDEO_EXTENSIONS = new Set(['.mp4']);
const BOX_SHAPE_PRESETS = new Set([
  'rect',
  'roundRect',
  'round1Rect',
  'round2SameRect',
  'round2DiagRect',
  'snip1Rect',
  'snip2SameRect',
  'snip2DiagRect',
  'snipRoundRect',
]);

// ------------------------------------------------------------------ utilities
function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function storedImageSourceError(value) {
  if (typeof value !== 'string' || !value.trim()) return 'source must be a non-empty string';
  if (path.isAbsolute(value)) return 'source must be stored as a project-relative path';
  const normalized = value.replace(/\\/g, '/');
  if (normalized !== value || normalized.startsWith('/') || normalized.includes('\0')) {
    return 'source must use a normalized project-relative path';
  }
  const parts = normalized.split('/');
  if (parts.length < 2 || parts[0].toLowerCase() !== 'assets' ||
      parts.some((part) => !part || part === '.' || part === '..')) {
    return 'source must be inside the project assets folder';
  }
  if (!IMAGE_EXTENSIONS.has(path.extname(normalized).toLowerCase())) {
    return 'source must be a PNG, JPEG, or GIF image';
  }
  return null;
}

function resolveProjectImageSource(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return { ok: false, error: 'source must be a non-empty image path' };
  }
  let absolute = path.isAbsolute(value) ? path.resolve(value) : path.resolve(ROOT, value);
  let realRoot;
  let realAssets;
  try {
    realRoot = fs.realpathSync(ROOT);
    realAssets = fs.realpathSync(PROJECT_ASSETS);
    absolute = fs.realpathSync(absolute);
  } catch (_) {
    return { ok: false, error: 'image source does not exist' };
  }
  const inside = (parent, child) => child === parent || child.startsWith(parent + path.sep);
  if (!inside(realRoot, absolute) || !inside(realAssets, absolute)) {
    return { ok: false, error: 'image source must stay inside this project\'s assets folder' };
  }
  let stat;
  try { stat = fs.statSync(absolute); } catch (_) { /* handled below */ }
  if (!stat || !stat.isFile()) return { ok: false, error: 'image source must be a file' };
  if (!IMAGE_EXTENSIONS.has(path.extname(absolute).toLowerCase())) {
    return { ok: false, error: 'image source must be a PNG, JPEG, or GIF image' };
  }
  const source = path.relative(realRoot, absolute).split(path.sep).join('/');
  const invalid = storedImageSourceError(source);
  return invalid ? { ok: false, error: invalid } : { ok: true, source, absolute };
}

function storedVideoSourceError(value) {
  if (typeof value !== 'string' || !value.trim()) return 'source must be a non-empty string';
  if (path.isAbsolute(value)) return 'source must be stored as a project-relative path';
  const normalized = value.replace(/\\/g, '/');
  if (normalized !== value || normalized.startsWith('/') || normalized.includes('\0')) {
    return 'source must use a normalized project-relative path';
  }
  const parts = normalized.split('/');
  if (parts.length < 2 || parts[0].toLowerCase() !== 'assets' ||
      parts.some((part) => !part || part === '.' || part === '..')) {
    return 'source must be inside the project assets folder';
  }
  if (!VIDEO_EXTENSIONS.has(path.extname(normalized).toLowerCase())) {
    return 'source must be an MP4 video';
  }
  return null;
}

function resolveProjectVideoSource(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return { ok: false, error: 'source must be a non-empty MP4 path' };
  }
  let absolute = path.isAbsolute(value) ? path.resolve(value) : path.resolve(ROOT, value);
  let realRoot;
  let realAssets;
  try {
    realRoot = fs.realpathSync(ROOT);
    realAssets = fs.realpathSync(PROJECT_ASSETS);
    absolute = fs.realpathSync(absolute);
  } catch (_) {
    return { ok: false, error: 'video source does not exist' };
  }
  const inside = (parent, child) => child === parent || child.startsWith(parent + path.sep);
  if (!inside(realRoot, absolute) || !inside(realAssets, absolute)) {
    return { ok: false, error: 'video source must stay inside this project\'s assets folder' };
  }
  let stat;
  try { stat = fs.statSync(absolute); } catch (_) { /* handled below */ }
  if (!stat || !stat.isFile()) return { ok: false, error: 'video source must be a file' };
  if (!VIDEO_EXTENSIONS.has(path.extname(absolute).toLowerCase())) {
    return { ok: false, error: 'video source must be an MP4 video' };
  }
  const source = path.relative(realRoot, absolute).split(path.sep).join('/');
  const invalid = storedVideoSourceError(source);
  return invalid ? { ok: false, error: invalid } : { ok: true, source, absolute };
}

const validateModelDocument = require('./lib/model-validation')({
  DATA, BOX_SHAPE_PRESETS, storedImageSourceError, storedVideoSourceError,
});

function protectionKey(protection) {
  return protection.kind === 'slide'
    ? `slide:${protection.slideId}`
    : `object:${protection.slideId}:${protection.objectKind}:${protection.objectId}`;
}

function validateProtectionRecords(protections) {
  if (!Array.isArray(protections)) return 'protections must be an array';
  const seen = new Set();
  for (let i = 0; i < protections.length; i++) {
    const protection = protections[i];
    const label = `protections[${i}]`;
    if (!isRecord(protection)) return `${label} must be an object`;
    const allowed = protection.kind === 'slide'
      ? new Set(['kind', 'slideId', 'by', 'createdAt'])
      : new Set(['kind', 'slideId', 'objectId', 'objectKind', 'by', 'createdAt']);
    const unknown = Object.keys(protection).filter((key) => !allowed.has(key)).sort();
    if (unknown.length) return `${label} has unknown field: ${unknown[0]}`;
    if (!['slide', 'object'].includes(protection.kind)) {
      return `${label}.kind must be slide or object`;
    }
    if (typeof protection.slideId !== 'string' || !protection.slideId.trim()) {
      return `${label}.slideId must be a non-empty string`;
    }
    if (protection.kind === 'slide') {
      if (protection.objectId !== undefined || protection.objectKind !== undefined) {
        return `${label} slide protection cannot contain objectId or objectKind`;
      }
    } else {
      if (typeof protection.objectId !== 'string' || !protection.objectId.trim()) {
        return `${label}.objectId must be a non-empty string`;
      }
      if (!['element', 'decor'].includes(protection.objectKind)) {
        return `${label}.objectKind must be element or decor`;
      }
    }
    if (protection.by !== undefined &&
        (typeof protection.by !== 'string' || !protection.by.trim() || protection.by.length > 60)) {
      return `${label}.by must be a non-empty string no longer than 60 characters`;
    }
    if (protection.createdAt !== undefined &&
        (!Number.isSafeInteger(protection.createdAt) || protection.createdAt < 0)) {
      return `${label}.createdAt must be a non-negative safe integer`;
    }
    const key = protectionKey(protection);
    if (seen.has(key)) return `${label} duplicates ${key}`;
    seen.add(key);
  }
  return null;
}

// An exception is the inverse branch of a slide lock: the parent slide stays
// locked, while this stable child identity remains editable. Keeping these in
// their own array makes the two user workflows unambiguous and preserves the
// legacy meaning of `protections` (every row in that array is a lock).
function validateProtectionExceptionRecords(exceptions) {
  if (!Array.isArray(exceptions)) return 'protectionExceptions must be an array';
  const seen = new Set();
  for (let i = 0; i < exceptions.length; i++) {
    const exception = exceptions[i];
    const label = `protectionExceptions[${i}]`;
    if (!isRecord(exception)) return `${label} must be an object`;
    const allowed = new Set(['kind', 'slideId', 'objectId', 'objectKind', 'by', 'createdAt']);
    const unknown = Object.keys(exception).filter((key) => !allowed.has(key)).sort();
    if (unknown.length) return `${label} has unknown field: ${unknown[0]}`;
    if (exception.kind !== 'object') return `${label}.kind must be object`;
    if (typeof exception.slideId !== 'string' || !exception.slideId.trim()) {
      return `${label}.slideId must be a non-empty string`;
    }
    if (typeof exception.objectId !== 'string' || !exception.objectId.trim()) {
      return `${label}.objectId must be a non-empty string`;
    }
    if (!['element', 'decor'].includes(exception.objectKind)) {
      return `${label}.objectKind must be element or decor`;
    }
    if (typeof exception.by !== 'string' || !exception.by.trim() || exception.by.length > 60) {
      return `${label}.by must be a non-empty string no longer than 60 characters`;
    }
    if (!Number.isSafeInteger(exception.createdAt) || exception.createdAt < 0) {
      return `${label}.createdAt must be a non-negative safe integer`;
    }
    const key = protectionKey(exception);
    if (seen.has(key)) return `${label} duplicates ${key}`;
    seen.add(key);
  }
  return null;
}

function validateProtectionHistory(records) {
  if (!Array.isArray(records)) return 'protectionHistory must be an array';
  if (records.length > PROTECTION_HISTORY_LIMIT) {
    return `protectionHistory cannot exceed ${PROTECTION_HISTORY_LIMIT} entries`;
  }
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const label = `protectionHistory[${i}]`;
    if (!isRecord(record)) return `${label} must be an object`;
    const allowed = record.kind === 'slide'
      ? new Set(['action', 'kind', 'slideId', 'by', 'ts', 'taskId', 'authorizedBy', 'authorizedAt'])
      : new Set([
          'action', 'kind', 'slideId', 'objectId', 'objectKind', 'by', 'ts',
          'taskId', 'authorizedBy', 'authorizedAt'
        ]);
    const unknown = Object.keys(record).filter((key) => !allowed.has(key)).sort();
    if (unknown.length) return `${label} has unknown field: ${unknown[0]}`;
    if (!['lock', 'unlock'].includes(record.action)) {
      return `${label}.action must be lock or unlock`;
    }
    if (!['slide', 'object'].includes(record.kind)) {
      return `${label}.kind must be slide or object`;
    }
    if (typeof record.slideId !== 'string' || !record.slideId.trim()) {
      return `${label}.slideId must be a non-empty string`;
    }
    if (record.kind === 'slide') {
      if (record.objectId !== undefined || record.objectKind !== undefined) {
        return `${label} slide event cannot contain objectId or objectKind`;
      }
    } else {
      if (typeof record.objectId !== 'string' || !record.objectId.trim()) {
        return `${label}.objectId must be a non-empty string`;
      }
      if (!['element', 'decor'].includes(record.objectKind)) {
        return `${label}.objectKind must be element or decor`;
      }
    }
    if (typeof record.by !== 'string' || !record.by.trim() || record.by.length > 60) {
      return `${label}.by must be a non-empty string no longer than 60 characters`;
    }
    if (!Number.isSafeInteger(record.ts) || record.ts < 0) {
      return `${label}.ts must be a non-negative safe integer`;
    }
    const delegatedFields = ['taskId', 'authorizedBy', 'authorizedAt'];
    const delegatedCount = delegatedFields.filter((field) => record[field] !== undefined).length;
    if (delegatedCount !== 0 && delegatedCount !== delegatedFields.length) {
      return `${label} delegated audit fields must appear together`;
    }
    if (delegatedCount) {
      if (typeof record.taskId !== 'string' || !record.taskId.trim() || record.taskId.length > 120) {
        return `${label}.taskId must be a non-empty string no longer than 120 characters`;
      }
      if (typeof record.authorizedBy !== 'string' || !record.authorizedBy.trim() ||
          record.authorizedBy.length > 60 || isSuiteAgentActor(record.authorizedBy)) {
        return `${label}.authorizedBy must name a non-agent authorizer`;
      }
      if (!Number.isSafeInteger(record.authorizedAt) || record.authorizedAt < 0 ||
          record.authorizedAt > record.ts) {
        return `${label}.authorizedAt must be a safe integer no later than ts`;
      }
    }
  }
  return null;
}

function validateStateDocument(value) {
  if (!isRecord(value)) return 'root must be an object';
  if (typeof value.paused !== 'boolean') return 'paused must be a boolean';
  if (value.log !== undefined && !Array.isArray(value.log)) return 'log must be an array';
  if (value.protections !== undefined) {
    const invalidProtections = validateProtectionRecords(value.protections);
    if (invalidProtections) return invalidProtections;
  }
  if (value.protectionExceptions !== undefined) {
    const invalidExceptions = validateProtectionExceptionRecords(value.protectionExceptions);
    if (invalidExceptions) return invalidExceptions;
    const protections = Array.isArray(value.protections) ? value.protections : [];
    for (let i = 0; i < value.protectionExceptions.length; i++) {
      const exception = value.protectionExceptions[i];
      if (!protections.some((item) => item.kind === 'slide' && item.slideId === exception.slideId)) {
        return `protectionExceptions[${i}] requires a slide protection for ${exception.slideId}`;
      }
    }
  }
  if (value.protectionHistory !== undefined) {
    const invalidProtectionHistory = validateProtectionHistory(value.protectionHistory);
    if (invalidProtectionHistory) return invalidProtectionHistory;
  }
  if (value.pdfRev !== undefined && value.pdfRev !== null &&
      (!Number.isInteger(value.pdfRev) || value.pdfRev < 0)) return 'pdfRev must be null or a non-negative integer';

  return null;
}

function validateTaskProtectionGrant(grant, label) {
  if (!isRecord(grant)) return `${label} must be an object`;
  const allowed = new Set([
    'version', 'slideIds', 'editOps', 'protectionModes', 'grantedTo',
    'grantedBy', 'grantedAt', 'expiresAt', 'revokedAt', 'revokedBy'
  ]);
  const unknown = Object.keys(grant).filter((key) => !allowed.has(key)).sort();
  if (unknown.length) return `${label} has unknown field: ${unknown[0]}`;
  if (grant.version !== 1) return `${label}.version must be 1`;
  if (!Array.isArray(grant.slideIds) || !grant.slideIds.length ||
      grant.slideIds.some((item) => typeof item !== 'string' || !item.trim()) ||
      new Set(grant.slideIds).size !== grant.slideIds.length) {
    return `${label}.slideIds must be a non-empty unique string array`;
  }
  if (!Array.isArray(grant.editOps) ||
      grant.editOps.some((item) => item !== 'add-image') ||
      new Set(grant.editOps).size !== grant.editOps.length) {
    return `${label}.editOps may contain add-image once`;
  }
  const allowedModes = new Set(['direct-generated-decor']);
  if (!Array.isArray(grant.protectionModes) ||
      grant.protectionModes.some((item) => !allowedModes.has(item)) ||
      new Set(grant.protectionModes).size !== grant.protectionModes.length) {
    return `${label}.protectionModes contains an invalid or duplicate mode`;
  }
  for (const field of ['grantedTo', 'grantedBy']) {
    if (typeof grant[field] !== 'string' || !grant[field].trim() || grant[field].length > 60) {
      return `${label}.${field} must be a non-empty string no longer than 60 characters`;
    }
  }
  for (const field of ['grantedAt', 'expiresAt']) {
    if (!Number.isSafeInteger(grant[field]) || grant[field] < 0) {
      return `${label}.${field} must be a non-negative safe integer`;
    }
  }
  if (grant.expiresAt <= grant.grantedAt) return `${label}.expiresAt must follow grantedAt`;
  if (grant.revokedAt !== undefined) {
    if (!Number.isSafeInteger(grant.revokedAt) || grant.revokedAt < grant.grantedAt) {
      return `${label}.revokedAt must be a safe integer at or after grantedAt`;
    }
    if (typeof grant.revokedBy !== 'string' || !grant.revokedBy.trim() || grant.revokedBy.length > 60) {
      return `${label}.revokedBy must accompany revokedAt`;
    }
  } else if (grant.revokedBy !== undefined) {
    return `${label}.revokedBy requires revokedAt`;
  }
  return null;
}

function validateBoardDocument(value) {
  if (!isRecord(value)) return 'root must be an object';
  if (!Array.isArray(value.notes)) return 'notes must be an array';
  if (value.tasks !== undefined && !Array.isArray(value.tasks)) return 'tasks must be an array';
  if (value.loops !== undefined && !Array.isArray(value.loops)) return 'loops must be an array';
  for (let i = 0; i < value.notes.length; i++) {
    if (!isRecord(value.notes[i])) return `notes[${i}] must be an object`;
  }
  for (let i = 0; i < (value.tasks || []).length; i++) {
    if (!isRecord(value.tasks[i])) return `tasks[${i}] must be an object`;
    if (value.tasks[i].protectionGrant !== undefined) {
      const invalidGrant = validateTaskProtectionGrant(
        value.tasks[i].protectionGrant,
        `tasks[${i}].protectionGrant`
      );
      if (invalidGrant) return invalidGrant;
    }
  }
  for (let i = 0; i < (value.loops || []).length; i++) {
    if (!isRecord(value.loops[i])) return `loops[${i}] must be an object`;
  }
  return null;
}

// Missing files are a supported first-run case. Existing files are not:
// silently replacing malformed or structurally invalid persisted data with a
// default can unlock a paused project and then overwrite the only recoverable
// copy. Refuse to boot and name the exact file instead.
function loadJSON(file, fallback, validate) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return fallback;
    throw new Error(`Cannot read ${path.basename(file)}: ${error && (error.code || error.message)}`);
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`Cannot start with malformed ${path.basename(file)}: ${error.message}`);
  }
  const invalid = validate && validate(value);
  if (invalid) throw new Error(`Cannot start with invalid ${path.basename(file)}: ${invalid}`);
  return value;
}

function persistFailure(file, err) {
  const error = err && (err.code || err.message) || 'unknown error';
  console.error('saveJSONAtomic FAILED, disk is stale:', file, error);
  broadcast({ type: 'persist', ok: false, file: path.basename(file), error, ts: Date.now() });
  return false;
}

function saveJSONAtomic(file, obj) {
  let data;
  try { data = JSON.stringify(obj, null, 2); }
  catch (e) { return persistFailure(file, e); }
  const tmp = file + '.' + process.pid + '.' + crypto.randomBytes(3).toString('hex') + '.tmp';
  try { fs.writeFileSync(tmp, data); }
  catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) {}
    return persistFailure(file, e);
  }
  // On Windows, rename-over-existing can transiently fail (EPERM/EBUSY) if the
  // destination is briefly held open (AV, indexer, a reader). Retry, but never
  // fall back to an in-place overwrite: a crash/short write there can destroy
  // the last valid authoritative model/state/board.
  let lastErr = null;
  for (let i = 0; i < 8; i++) {
    try { fs.renameSync(tmp, file); return true; }
    catch (e) { lastErr = e; sleepMs(15 * (i + 1)); }
  }
  console.error('saveJSONAtomic preserved the old file; staged replacement remains at:', tmp);
  return persistFailure(file, lastErr || new Error('atomic rename failed'));
}
function sweepStaleTmpFiles() {
  let entries;
  try { entries = fs.readdirSync(DATA); } catch (_) { return; }
  const bases = [
    'model.json', 'state.json', 'board.json', 'render-state.json', 'exports.json',
    'element-history.json', 'element-history.pending.json', 'com_host.pid.json',
  ];
  for (const name of entries) {
    if (/^\.(?:pdf-source-\d+-\d+-[0-9a-f]{10}\.pptx(?:\.slides-validation\.json)?|pdf-output-\d+-\d+-[0-9a-f]{10}\.pdf)$/i.test(name)) {
      try { fs.unlinkSync(path.join(DATA, name)); } catch (_) {}
      continue;
    }
    if (/^\.(?:slides-render|io)-[a-z0-9]{6}$/i.test(name)) {
      try { fs.rmSync(path.join(DATA, name), {recursive:true, force:true}); } catch (_) {}
      continue;
    }
    if (!name.endsWith('.tmp')) continue;
    if (!bases.some((b) => name.startsWith(b + '.'))) continue;
    try { fs.unlinkSync(path.join(DATA, name)); console.log('swept stale atomic-write temp file:', name); } catch (_) {}
  }
  let rootEntries;
  try { rootEntries = fs.readdirSync(ROOT); } catch (_) { return; }
  for (const name of rootEntries) {
    if (!/^\.presentation-\d+-\d+-[0-9a-f]{8}\.pptx(?:\.slides-validation\.json)?$/i.test(name)) continue;
    try {
      fs.unlinkSync(path.join(ROOT, name));
      console.log('swept stale staged presentation:', name);
    } catch (_) {}
  }
}

function sleepMs(ms) {
  // synchronous, tiny — used only for the rare rename-retry backoff
  const end = Date.now() + ms;
  while (Date.now() < end) { /* spin briefly */ }
}

function validatePptxFile(file) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size < 22) throw new Error('renderer produced an empty PPTX');
  const bytes = fs.readFileSync(file);
  if (bytes.subarray(0, 2).toString('ascii') !== 'PK') throw new Error('renderer output is not a PPTX ZIP container');
  // A leading PK alone accepts a truncated or arbitrary ZIP. Require the ZIP
  // end record and the two package members every valid PowerPoint deck needs.
  if (bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) < 0 ||
      bytes.indexOf(Buffer.from('[Content_Types].xml')) < 0 ||
      bytes.indexOf(Buffer.from('ppt/presentation.xml')) < 0) {
    throw new Error('renderer output is an incomplete PowerPoint package');
  }
  return stat;
}

// The renderer writes a private same-volume file and only a validated result
// reaches presentation.pptx. Never fall back to an in-place overwrite here:
// preserving the last good deck is safer than replacing it with a partial file
// when antivirus, PowerPoint, or another reader holds the destination.
function commitStagedPptx(staged) {
  validatePptxFile(staged);
  let lastError = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      fs.renameSync(staged, PPTX_PATH);
      return;
    } catch (error) {
      lastError = error;
      sleepMs(20 * (attempt + 1));
    }
  }
  throw lastError || new Error('could not replace presentation.pptx');
}

function persistRenderMarker(rev) {
  const bytes = fs.readFileSync(PPTX_PATH);
  return saveJSONAtomic(RENDER_STATE_PATH, {
    rev,
    size: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    renderedAt: new Date().toISOString()
  });
}

function presentationFreshness() {
  try {
    const stat = validatePptxFile(PPTX_PATH);
    let marker = null;
    try {
      marker = JSON.parse(fs.readFileSync(RENDER_STATE_PATH, 'utf8'));
    } catch (error) {
      if (!error || error.code !== 'ENOENT') {
        return { current: false, error: 'render-state.json is malformed or unreadable' };
      }
    }
    if (marker) {
      if (!Number.isInteger(marker.rev) || typeof marker.sha256 !== 'string') {
        return { current: false, error: 'render-state.json is invalid' };
      }
      if (marker.rev !== model.rev) {
        return { current: false, error: `presentation.pptx is at rev ${marker.rev}, model is rev ${model.rev}` };
      }
      const hash = crypto.createHash('sha256').update(fs.readFileSync(PPTX_PATH)).digest('hex');
      if (hash !== marker.sha256 || (marker.size != null && marker.size !== stat.size)) {
        return { current: false, error: 'presentation.pptx does not match its render marker' };
      }
      return { current: true, error: null, rev: marker.rev };
    }
    return {
      current: false,
      error: 'presentation.pptx has no exact revision marker; a verification render is required',
      rev: null,
      legacy: true
    };
  } catch (error) {
    return { current: false, error: error.message || String(error) };
  }
}

function shortId(prefix) {
  return prefix + crypto.randomBytes(4).toString('hex');
}

function setReadOnly(file, on) {
  return new Promise((resolve) => {
    // A missing output is already "not read-only" and can be created by the
    // next render. It cannot satisfy a pause lock, however.
    if (!fs.existsSync(file)) return resolve(!on);
    if (IS_WIN) {
      execFile('attrib', [on ? '+R' : '-R', file], (err) => resolve(!err));
    } else {
      try { fs.chmodSync(file, on ? 0o444 : 0o644); resolve(true); }
      catch (_) { resolve(false); }
    }
  });
}

// THUMBS_SRC is a disposable copy of the deck, but Windows preserves the
// source PPTX's read-only bit when copying it. A paused deck therefore left
// the next thumbnail refresh unable to overwrite its own derived snapshot.
// Clear only that derived file immediately before every copy; the deck/model
// pause lock is never weakened.
async function refreshThumbsFromDeck(capturedRev, failurePrefix) {
  try {
    await setReadOnly(THUMBS_SRC, false);
    if (fs.existsSync(PPTX_PATH)) fs.copyFileSync(PPTX_PATH, THUMBS_SRC);
    runThumbs(capturedRev);
    return true;
  } catch (e) {
    console.error(failurePrefix, e.code || e.message);
    return false;
  }
}

// -------------------------------------------------------------------- state
let model = loadJSON(MODEL_PATH, defaultModel(), validateModelDocument);
let state = loadJSON(STATE_PATH, {
  paused: false, pausedBy: null, pausedAt: null, pdfRev: null
}, validateStateDocument);

if (state.protections === undefined) state.protections = [];
// Supported legacy state has no exception field. Exceptions are meaningful
// only beneath an active slide lock and are validated fail-closed when present.
if (state.protectionExceptions === undefined) state.protectionExceptions = [];

if (state.protectionHistory === undefined) state.protectionHistory = [];
for (let i = 0; i < state.protections.length; i++) {
  const protection = state.protections[i];
  const slide = model.slides.find((item) => item.id === protection.slideId);
  if (!slide) {
    throw new Error(`Cannot start with invalid state.json: protections[${i}] names missing slide "${protection.slideId}"`);
  }
  if (protection.kind !== 'object') continue;
  const objects = protection.objectKind === 'element' ? slide.elements : (slide.decor || []);
  if (!objects.some((item) => item.id === protection.objectId)) {
    throw new Error(
      `Cannot start with invalid state.json: protections[${i}] names missing ` +
      `${protection.objectKind} "${protection.objectId}" on slide "${protection.slideId}"`
    );
  }
}
for (let i = 0; i < state.protectionExceptions.length; i++) {
  const exception = state.protectionExceptions[i];
  const slide = model.slides.find((item) => item.id === exception.slideId);
  if (!slide) {
    throw new Error(`Cannot start with invalid state.json: protectionExceptions[${i}] names missing slide "${exception.slideId}"`);
  }
  const objects = exception.objectKind === 'element' ? slide.elements : (slide.decor || []);
  if (!objects.some((item) => item.id === exception.objectId)) {
    throw new Error(
      `Cannot start with invalid state.json: protectionExceptions[${i}] names missing ` +
      `${exception.objectKind} "${exception.objectId}" on slide "${exception.slideId}"`
    );
  }
}
// Pause/resume each change two operating-system locks across awaits. Keep the
// complete transition (including its state guard and response snapshot) in one
// FIFO lane so opposite clicks cannot interleave those locks.
let pauseTransitionTail = Promise.resolve();
function queuePauseTransition(work) {
  const job = pauseTransitionTail.then(work);
  // A failed transition must not leave every later pause/resume request stuck
  // behind a rejected promise. The initiating request still receives its own
  // failure; this catch only repairs the queue tail for the next request.
  pauseTransitionTail = job.catch((err) => {
    console.error('pause/resume transition failed:', err && (err.stack || err));
  });
  return job;
}
if (!Array.isArray(state.log)) state.log = [];
if (state.pdfRev === undefined) state.pdfRev = null;
let board = loadJSON(BOARD_PATH, defaultBoard(), validateBoardDocument);
if (!board || !Array.isArray(board.notes)) board = defaultBoard();
if (!Array.isArray(board.tasks)) board.tasks = [];   // free/busy task list lives alongside the notes
if (!Array.isArray(board.loops)) board.loops = [];   // standing recurring check prompts (see loopView)
const editors = new Map();           // id -> { id, name, lastSeen, joinedAt }
const locks = new Map();             // slideId -> { slideId, by, ts, note }
const sseClients = new Set();

let undoStack = [];   // [{ model, editor, opType, detail, rev, ts }], model = snapshot BEFORE that op
let redoStack = [];

let elementHistory = null;
const elementHistoryAssetCache = new Map();

function protectionView(sourceState) {
  return (sourceState || state).protections.map((protection) => Object.assign({}, protection));
}

function protectionExceptionView(sourceState) {
  return (sourceState || state).protectionExceptions.map((exception) => Object.assign({}, exception));
}

function protectionHistoryView(sourceState) {
  return (sourceState || state).protectionHistory.map((entry) => Object.assign({}, entry));
}

function protectionFromToggleBody(body) {
  if (!isRecord(body)) return { ok: false, error: 'body must be an object' };
  const unknown = Object.keys(body)
    .filter((key) => ![
      'kind', 'slideId', 'objectId', 'objectKind', 'protected', 'by',
      'taskId', 'delegatedMode'
    ].includes(key))
    .sort();
  if (unknown.length) return { ok: false, error: `unknown field: ${unknown[0]}` };
  if (!['slide', 'object'].includes(body.kind)) {
    return { ok: false, error: 'kind must be slide or object' };
  }
  if (typeof body.protected !== 'boolean') {
    return { ok: false, error: 'protected must be a boolean' };
  }
  if (typeof body.slideId !== 'string' || !body.slideId.trim()) {
    return { ok: false, error: 'slideId must be a non-empty string' };
  }
  const by = typeof body.by === 'string' ? body.by.trim() : '';
  if (!by || by.length > 60) {
    return { ok: false, error: 'by must be a non-empty string no longer than 60 characters' };
  }
  const slideId = body.slideId.trim();
  const slide = model.slides.find((item) => item.id === slideId);
  if (!slide) return { ok: false, error: `no such slide: ${slideId}` };
  if (body.kind === 'slide') {
    if (body.objectId !== undefined || body.objectKind !== undefined) {
      return { ok: false, error: 'slide protection cannot contain objectId or objectKind' };
    }
    return { ok: true, protected: body.protected, by, protection: { kind: 'slide', slideId } };
  }
  if (typeof body.objectId !== 'string' || !body.objectId.trim()) {
    return { ok: false, error: 'objectId must be a non-empty string' };
  }
  if (!['element', 'decor'].includes(body.objectKind)) {
    return { ok: false, error: 'objectKind must be element or decor' };
  }
  const objectId = body.objectId.trim();
  if (!protectionObject(slide, body.objectKind, objectId)) {
    return {
      ok: false,
      error: `no such ${body.objectKind}: ${objectId} on slide ${slideId}`
    };
  }
  return {
    ok: true,
    protected: body.protected,
    by,
    protection: {
      kind: 'object', slideId, objectId, objectKind: body.objectKind
    }
  };
}

function protectionObject(slide, objectKind, objectId) {
  if (!slide) return null;
  const collection = objectKind === 'element' ? slide.elements : (slide.decor || []);
  return collection.find((item) => item.id === objectId) || null;
}

function addScopeObject(objects, slideId, objectKind, objectId) {
  if (!objectId) return;
  objects.set(`${slideId}:${objectKind}:${objectId}`, { slideId, objectId, objectKind });
}

function addSlideObjectsToScope(objects, slide) {
  if (!slide) return;
  for (const element of slide.elements || []) addScopeObject(objects, slide.id, 'element', element.id);
  for (const decor of slide.decor || []) addScopeObject(objects, slide.id, 'decor', decor.id);
}

function protectionScopeBetween(beforeModel, afterModel, op) {
  const slides = new Set();
  const wholeSlides = new Set();
  const objects = new Map();
  const beforeSlides = new Map((beforeModel.slides || []).map((slide) => [slide.id, slide]));
  const afterSlides = new Map((afterModel.slides || []).map((slide) => [slide.id, slide]));
  const ids = new Set([...beforeSlides.keys(), ...afterSlides.keys()]);

  for (const slideId of ids) {
    const beforeSlide = beforeSlides.get(slideId);
    const afterSlide = afterSlides.get(slideId);
    if (!beforeSlide || !afterSlide) {
      slides.add(slideId);
      wholeSlides.add(slideId);
      addSlideObjectsToScope(objects, beforeSlide);
      addSlideObjectsToScope(objects, afterSlide);
      continue;
    }
    if (JSON.stringify(beforeSlide) !== JSON.stringify(afterSlide)) slides.add(slideId);

    // Child JSON and child animations can be carved out by an explicit object
    // exception. Every other slide property (notes, layout, transition, source,
    // etc.) remains a whole-slide change and cannot escape through one child.
    const slideWideState = (slide) => {
      const { elements, decor, animations, ...wide } = slide;
      return wide;
    };
    if (JSON.stringify(slideWideState(beforeSlide)) !== JSON.stringify(slideWideState(afterSlide))) {
      wholeSlides.add(slideId);
    }

    for (const objectKind of ['element', 'decor']) {
      const beforeItems = objectKind === 'element' ? beforeSlide.elements : (beforeSlide.decor || []);
      const afterItems = objectKind === 'element' ? afterSlide.elements : (afterSlide.decor || []);
      if (JSON.stringify(beforeItems.map((item) => item.id)) !==
          JSON.stringify(afterItems.map((item) => item.id))) {
        // Adding, deleting, or reordering children changes the parent structure.
        // Unlock the slide for structural work; object exceptions are for edits
        // to existing stable items.
        wholeSlides.add(slideId);
      }
      const beforeObjects = new Map(beforeItems.map((item) => [item.id, item]));
      const afterObjects = new Map(afterItems.map((item) => [item.id, item]));
      for (const objectId of new Set([...beforeObjects.keys(), ...afterObjects.keys()])) {
        if (JSON.stringify(beforeObjects.get(objectId)) !== JSON.stringify(afterObjects.get(objectId))) {
          addScopeObject(objects, slideId, objectKind, objectId);
        }
      }
    }

    // Native elements are assigned to layout placeholders in array order.
    // Adding/deleting a different element before a protected one can therefore
    // move the protected element without changing its own JSON.
    if (beforeSlide.src === undefined && afterSlide.src === undefined) {
      const beforeElementOrder = new Map(
        (beforeSlide.elements || []).map((element, index) => [element.id, index])
      );
      const afterElementOrder = new Map(
        (afterSlide.elements || []).map((element, index) => [element.id, index])
      );
      for (const objectId of new Set([...beforeElementOrder.keys(), ...afterElementOrder.keys()])) {
        if (!beforeElementOrder.has(objectId) || !afterElementOrder.has(objectId) ||
            beforeElementOrder.get(objectId) === afterElementOrder.get(objectId)) continue;
        addScopeObject(objects, slideId, 'element', objectId);
      }
      if (beforeSlide.layout !== afterSlide.layout) {
        for (const element of [...(beforeSlide.elements || []), ...(afterSlide.elements || [])]) {
          addScopeObject(objects, slideId, 'element', element.id);
        }
      }
    }

    // A slide transition is a visual effect applied to every child, not inert
    // metadata like speaker notes. Include all stable children so an object
    // lock cannot be bypassed by changing its parent transition.
    if (JSON.stringify(beforeSlide.transition) !== JSON.stringify(afterSlide.transition)) {
      addSlideObjectsToScope(objects, beforeSlide);
      addSlideObjectsToScope(objects, afterSlide);
    }

    // Animations live on the slide, but semantically change their named
    // element/decor. Include index as well as value so an animation reorder
    // cannot move a protected target around the build sequence.
    const animationState = (slide) => new Map((slide.animations || []).map((animation, index) => [
      animation.targetId, { index, animation }
    ]));
    const beforeAnimations = animationState(beforeSlide);
    const afterAnimations = animationState(afterSlide);
    for (const objectId of new Set([...beforeAnimations.keys(), ...afterAnimations.keys()])) {
      if (JSON.stringify(beforeAnimations.get(objectId)) === JSON.stringify(afterAnimations.get(objectId))) continue;
      const element = protectionObject(beforeSlide, 'element', objectId) ||
        protectionObject(afterSlide, 'element', objectId);
      addScopeObject(objects, slideId, element ? 'element' : 'decor', objectId);
    }
  }

  // Theme accents are global model state, but the renderer applies them only
  // to suite-native slides/elements. Treat those concrete targets as changed
  // so a global set-theme (and its undo/redo) cannot visually rewrite a
  // protected native target without naming it. Imported content and generated
  // decor keep their own backing/fill and remain outside this exact scope.
  if (JSON.stringify(beforeModel.theme || {}) !== JSON.stringify(afterModel.theme || {})) {
    for (const slideId of ids) {
      const slide = afterSlides.get(slideId) || beforeSlides.get(slideId);
      if (!slide || slide.src !== undefined) continue;
      slides.add(slideId);
      wholeSlides.add(slideId);
      for (const element of slide.elements || []) {
        addScopeObject(objects, slideId, 'element', element.id);
      }
    }
  }

  if (op && op.type === 'move-slide' && typeof op.slideId === 'string') {
    slides.add(op.slideId);
    wholeSlides.add(op.slideId);
    addSlideObjectsToScope(objects, beforeSlides.get(op.slideId) || afterSlides.get(op.slideId));
  }

  const beforeOrder = new Map((beforeModel.slides || []).map((slide, index) => [slide.id, index]));
  const afterOrder = new Map((afterModel.slides || []).map((slide, index) => [slide.id, index]));
  for (const slideId of ids) {
    if (!beforeOrder.has(slideId) || !afterOrder.has(slideId) ||
        beforeOrder.get(slideId) === afterOrder.get(slideId)) continue;
    slides.add(slideId);
    wholeSlides.add(slideId);
    addSlideObjectsToScope(objects, beforeSlides.get(slideId) || afterSlides.get(slideId));
  }

  return {
    slides: [...slides].sort(),
    wholeSlides: [...wholeSlides].sort(),
    objects: [...objects.values()].sort((a, b) =>
      `${a.slideId}:${a.objectKind}:${a.objectId}`.localeCompare(
        `${b.slideId}:${b.objectKind}:${b.objectId}`
      ))
  };
}

function protectionConflictForScope(scope) {
  const slideIds = new Set((scope && scope.slides) || []);
  const wholeSlideIds = new Set((scope && scope.wholeSlides) || []);
  const scopedObjects = (scope && scope.objects) || [];
  const objectKeys = new Set(scopedObjects.map((item) =>
    `${item.slideId}:${item.objectKind}:${item.objectId}`
  ));
  const exceptionKeys = new Set(state.protectionExceptions.map((item) =>
    `${item.slideId}:${item.objectKind}:${item.objectId}`
  ));

  // A direct object lock is overridden only while that same object is an
  // explicit editable exception beneath its locked parent slide.
  const objectConflict = state.protections.find((protection) => {
    if (protection.kind !== 'object') return false;
    const key = `${protection.slideId}:${protection.objectKind}:${protection.objectId}`;
    return objectKeys.has(key) && !exceptionKeys.has(key);
  });
  if (objectConflict) return objectConflict;

  return state.protections.find((protection) => {
    if (protection.kind !== 'slide' || !slideIds.has(protection.slideId)) return false;
    if (wholeSlideIds.has(protection.slideId)) return true;
    const children = scopedObjects.filter((item) => item.slideId === protection.slideId);
    // A slide-level delta with no attributable child stays fail-closed.
    if (!children.length) return true;
    return children.some((item) =>
      !exceptionKeys.has(`${item.slideId}:${item.objectKind}:${item.objectId}`)
    );
  }) || null;
}

function protectionDenial(protection, action) {
  const target = protection.kind === 'slide'
    ? `slide ${protection.slideId}`
    : `${protection.objectKind} ${protection.objectId} on slide ${protection.slideId}`;
  return {
    ok: false,
    error: 'protected',
    message: `${action || 'edit'} refused: ${target} is protected` +
      `${protection.by ? ` by ${protection.by}` : ''}; a human must unprotect it first`,
    protection: Object.assign({}, protection)
  };
}

function historyProtectionScope(entry, currentModel, candidateModel) {
  const scope = entry && entry.protectionScope;
  if (scope && Array.isArray(scope.slides) && Array.isArray(scope.wholeSlides) &&
      Array.isArray(scope.objects)) return scope;
  return protectionScopeBetween(currentModel, candidateModel, null);
}

function pushUndo(beforeModel, meta) {
  undoStack.push(Object.assign({ model: beforeModel }, meta));
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
}
function historySummary(entry) {
  return { editor: entry.editor, opType: entry.opType, detail: entry.detail, rev: entry.rev, ts: entry.ts };
}

function defaultModel() {
  return {
    title: 'Untitled Presentation',
    theme: { accent: '#2563eb' },
    rev: 0,
    updatedAt: null,
    slides: [{
      id: 's1', layout: 'title', notes: '',
      elements: [
        { id: 'e1', type: 'title', text: '' },
        { id: 'e2', type: 'subtitle', text: '' }
      ]
    }]
  };
}

function persistModel(nextModel) {
  const target = nextModel || model;
  target.updatedAt = new Date().toISOString();
  return saveJSONAtomic(MODEL_PATH, target);
}
function persistState(nextState) { return saveJSONAtomic(STATE_PATH, nextState || state); }

function emptyElementHistory(modelRev) {
  return { schemaVersion: 1, modelRev: Number.isInteger(modelRev) ? modelRev : 0, entries: {} };
}

function elementHistoryKey(ref) {
  // JSON tuple encoding is injective for arbitrary valid ids. A colon-joined
  // key lets different identities collide when an imported stable id itself
  // contains ':'.
  return JSON.stringify([ref.slideId, ref.objectKind, ref.objectId]);
}

function validateElementHistoryDocument(value) {
  if (!isRecord(value)) return 'root must be an object';
  if (value.schemaVersion !== 1) return 'schemaVersion must be 1';
  if (!Number.isInteger(value.modelRev) || value.modelRev < 0) return 'modelRev must be a non-negative integer';
  if (!isRecord(value.entries)) return 'entries must be an object';
  const entryRows = Object.entries(value.entries);
  if (entryRows.length > 10000) return 'entries exceeds the safety limit';
  for (const [key, entry] of entryRows) {
    if (!isRecord(entry) || !isRecord(entry.target)) return `entries.${key} must contain a target`;
    const target = entry.target;
    if (typeof target.slideId !== 'string' || !target.slideId ||
        !['element', 'decor'].includes(target.objectKind) ||
        typeof target.objectId !== 'string' || !target.objectId) {
      return `entries.${key}.target is invalid`;
    }
    if (elementHistoryKey(target) !== key) return `entries.${key}.target does not match its key`;
    if (!isRecord(entry.versions)) return `entries.${key}.versions must be an object`;
    const versionRows = Object.entries(entry.versions);
    if (versionRows.length > ELEMENT_HISTORY_ARCHIVE_LIMIT) {
      return `entries.${key}.versions exceeds the safety limit`;
    }
    for (const [versionId, version] of versionRows) {
      if (!isRecord(version) || version.id !== versionId || !/^v_[0-9a-f]{16,64}$/i.test(versionId)) {
        return `entries.${key}.versions.${versionId} has an invalid id`;
      }
      if (!Number.isInteger(version.createdAt) || version.createdAt < 0 ||
          typeof version.by !== 'string' || version.by.length > 60 ||
          typeof version.summary !== 'string' || version.summary.length > 240 ||
          !isRecord(version.state) || !isRecord(version.state.object) ||
          version.state.object.id !== target.objectId || !Array.isArray(version.state.animations)) {
        return `entries.${key}.versions.${versionId} is invalid`;
      }
      for (const row of version.state.animations) {
        if (!isRecord(row) || !Number.isInteger(row.index) || row.index < 0 ||
            !isRecord(row.animation) || row.animation.targetId !== target.objectId) {
          return `entries.${key}.versions.${versionId}.state.animations is invalid`;
        }
      }
    }
    if (!Array.isArray(entry.timeline) || !entry.timeline.length ||
        entry.timeline.length > ELEMENT_HISTORY_VISIBLE_LIMIT ||
        new Set(entry.timeline).size !== entry.timeline.length ||
        entry.timeline.some((id) => typeof id !== 'string' || !entry.versions[id])) {
      return `entries.${key}.timeline is invalid`;
    }
    if (!Array.isArray(entry.restoreUndos) ||
        entry.restoreUndos.length > ELEMENT_HISTORY_RESTORE_UNDO_LIMIT) {
      return `entries.${key}.restoreUndos is invalid`;
    }
    const checkpointTokens = new Set();
    for (const checkpoint of entry.restoreUndos) {
      if (!isRecord(checkpoint) || !/^r_[0-9a-f]{16,64}$/i.test(checkpoint.token || '') ||
          checkpointTokens.has(checkpoint.token) ||
          !Number.isInteger(checkpoint.createdAt) || checkpoint.createdAt < 0 ||
          !Array.isArray(checkpoint.timeline) || !checkpoint.timeline.length ||
          checkpoint.timeline.length > ELEMENT_HISTORY_VISIBLE_LIMIT ||
          new Set(checkpoint.timeline).size !== checkpoint.timeline.length ||
          checkpoint.timeline.some((id) => typeof id !== 'string' || !entry.versions[id])) {
        return `entries.${key}.restoreUndos contains an invalid checkpoint`;
      }
      checkpointTokens.add(checkpoint.token);
    }
  }
  return null;
}

function validateElementHistoryPendingDocument(value) {
  if (!isRecord(value) || value.schemaVersion !== 1 ||
      !Number.isInteger(value.modelRev) || value.modelRev < 0) {
    return 'pending transaction header is invalid';
  }
  if (!isRecord(value.history)) return 'history must be an object';
  const invalid = validateElementHistoryDocument(value.history);
  if (invalid) return `history: ${invalid}`;
  if (value.history.modelRev !== value.modelRev) return 'history.modelRev does not match modelRev';
  return null;
}

function cloneJSON(value) {
  return JSON.parse(JSON.stringify(value));
}

function elementHistoryRef(slideId, objectKind, objectId) {
  return { slideId: String(slideId || ''), objectKind: String(objectKind || ''), objectId: String(objectId || '') };
}

function findHistoryObject(sourceModel, ref) {
  const slide = (sourceModel.slides || []).find((item) => item.id === ref.slideId);
  if (!slide || !['element', 'decor'].includes(ref.objectKind)) return null;
  const collection = ref.objectKind === 'element' ? (slide.elements || []) : (slide.decor || []);
  const index = collection.findIndex((item) => item.id === ref.objectId);
  return index < 0 ? null : { slide, collection, index, object: collection[index] };
}

function sameFilesystemPath(a, b) {
  return IS_WIN
    ? String(a).toLowerCase() === String(b).toLowerCase()
    : String(a) === String(b);
}

function verifiedElementHistoryArchiveDir() {
  const dir = path.join(PROJECT_ASSETS, '.element-history');
  fs.mkdirSync(dir, { recursive: true });
  const realAssets = fs.realpathSync(PROJECT_ASSETS);
  const realDir = fs.realpathSync(dir);
  const expectedDir = path.join(realAssets, '.element-history');
  const insideAssets = realDir === realAssets || realDir.startsWith(realAssets + path.sep);
  if (!insideAssets || !sameFilesystemPath(realDir, expectedDir) || fs.lstatSync(dir).isSymbolicLink()) {
    throw new Error('element-history archive directory must be a real folder inside project assets');
  }
  return realDir;
}

function archiveElementHistoryAsset(object) {
  const copy = cloneJSON(object);
  if (!copy.generated || !['pic', 'media'].includes(copy.kind) || typeof copy.source !== 'string') return copy;
  const resolved = copy.kind === 'media'
    ? resolveProjectVideoSource(copy.source)
    : resolveProjectImageSource(copy.source);
  // A legacy/missing source should not prevent the coordinator from booting or
  // preserving text/geometry. The restore route revalidates it and refuses a
  // broken media restore instead of producing a deck with a dead link.
  if (!resolved.ok) return copy;
  const realDir = verifiedElementHistoryArchiveDir();
  const sourceStat = fs.statSync(resolved.absolute);
  const cached = elementHistoryAssetCache.get(resolved.absolute);
  if (cached && cached.size === sourceStat.size && cached.mtimeMs === sourceStat.mtimeMs &&
      cached.ctimeMs === sourceStat.ctimeMs) {
    const cachedResolved = copy.kind === 'media'
      ? resolveProjectVideoSource(cached.source)
      : resolveProjectImageSource(cached.source);
    if (cachedResolved.ok && sameFilesystemPath(cachedResolved.absolute, cached.absolute) &&
        sameFilesystemPath(path.dirname(cachedResolved.absolute), realDir)) {
      const archiveStat = fs.lstatSync(cachedResolved.absolute);
      if (archiveStat.isFile() && !archiveStat.isSymbolicLink() &&
          archiveStat.size === cached.archiveSize &&
          archiveStat.mtimeMs === cached.archiveMtimeMs &&
          archiveStat.ctimeMs === cached.archiveCtimeMs) {
        copy.source = cached.source;
        return copy;
      }
    }
  }
  const bytes = fs.readFileSync(resolved.absolute);
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const ext = path.extname(resolved.absolute).toLowerCase();
  const absolute = path.join(realDir, `${hash}${ext}`);
  if (!fs.existsSync(absolute)) {
    const staged = path.join(realDir, `.${hash}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`);
    try {
      fs.writeFileSync(staged, bytes, { flag: 'wx' });
      fs.renameSync(staged, absolute);
    } catch (error) {
      try { fs.unlinkSync(staged); } catch (_) {}
      // Content addressing makes an EEXIST winner equivalent to our staged
      // bytes. Any other error means this version could not be made durable.
      if (!fs.existsSync(absolute)) throw error;
    }
  } else {
    const storedStat = fs.lstatSync(absolute);
    if (!storedStat.isFile() || storedStat.isSymbolicLink() ||
        !sameFilesystemPath(path.dirname(fs.realpathSync(absolute)), realDir)) {
      throw new Error('element-history archive file is not a real file inside its archive directory');
    }
    // Do not trust a pre-created hash-named file. A wrong payload under the
    // right name would silently restore different artwork than the card shows.
    const storedHash = crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
    if (storedHash !== hash) throw new Error('element-history archive hash mismatch');
  }
  copy.source = path.relative(ROOT, absolute).split(path.sep).join('/');
  const archiveStat = fs.lstatSync(absolute);
  elementHistoryAssetCache.set(resolved.absolute, {
    size: sourceStat.size,
    mtimeMs: sourceStat.mtimeMs,
    ctimeMs: sourceStat.ctimeMs,
    absolute,
    source: copy.source,
    archiveSize: archiveStat.size,
    archiveMtimeMs: archiveStat.mtimeMs,
    archiveCtimeMs: archiveStat.ctimeMs
  });
  return copy;
}

function captureElementHistoryState(sourceModel, ref) {
  const found = findHistoryObject(sourceModel, ref);
  if (!found) return null;
  const animations = [];
  for (let i = 0; i < (found.slide.animations || []).length; i++) {
    const animation = found.slide.animations[i];
    if (animation && animation.targetId === ref.objectId) {
      animations.push({ index: i, animation: cloneJSON(animation) });
    }
  }
  return { object: archiveElementHistoryAsset(found.object), animations };
}

// Raw capture is deliberately side-effect free and cheap. It is used only to
// discover which stable targets actually changed. Archiving every picture and
// video while scanning an unrelated one-word edit would synchronously hash the
// whole deck twice and stall every request.
function captureRawElementHistoryState(sourceModel, ref) {
  const found = findHistoryObject(sourceModel, ref);
  if (!found) return null;
  const animations = [];
  for (let i = 0; i < (found.slide.animations || []).length; i++) {
    const animation = found.slide.animations[i];
    if (animation && animation.targetId === ref.objectId) {
      animations.push({ index: i, animation: cloneJSON(animation) });
    }
  }
  return { object: cloneJSON(found.object), animations };
}

function sameElementHistoryState(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function historyChangeSummary(beforeState, afterState, fallback) {
  if (!beforeState) return fallback || 'Initial version';
  const changed = [];
  const beforeObject = beforeState.object || {};
  const afterObject = afterState.object || {};
  for (const key of new Set([...Object.keys(beforeObject), ...Object.keys(afterObject)])) {
    if (JSON.stringify(beforeObject[key]) !== JSON.stringify(afterObject[key])) changed.push(key);
  }
  if (JSON.stringify(beforeState.animations) !== JSON.stringify(afterState.animations)) changed.push('animation');
  if (!changed.length) return fallback || 'Saved version';
  const concise = changed.slice(0, 4).join(', ');
  return `Changed ${concise}${changed.length > 4 ? ` +${changed.length - 4}` : ''}`.slice(0, 240);
}

function makeElementHistoryVersion(stateSnapshot, by, summary, createdAt) {
  return {
    id: `v_${crypto.randomBytes(12).toString('hex')}`,
    createdAt: createdAt || Date.now(),
    by: String(by || 'system').slice(0, 60),
    summary: String(summary || 'Saved version').slice(0, 240),
    state: cloneJSON(stateSnapshot)
  };
}

function pruneElementHistoryVersions(entry) {
  const required = new Set(entry.timeline);
  for (const checkpoint of entry.restoreUndos) {
    for (const id of checkpoint.timeline) required.add(id);
  }
  const ordered = Object.values(entry.versions).sort((a, b) => b.createdAt - a.createdAt);
  for (const version of ordered) {
    if (required.size >= ELEMENT_HISTORY_ARCHIVE_LIMIT) break;
    required.add(version.id);
  }
  for (const id of Object.keys(entry.versions)) {
    if (!required.has(id)) delete entry.versions[id];
  }
}

function ensureElementHistoryEntry(doc, sourceModel, ref, by, summary) {
  const stateSnapshot = captureElementHistoryState(sourceModel, ref);
  if (!stateSnapshot) return null;
  const key = elementHistoryKey(ref);
  let entry = doc.entries[key];
  if (!entry) {
    const version = makeElementHistoryVersion(stateSnapshot, by || 'system', summary || 'Initial version');
    entry = {
      target: cloneJSON(ref),
      versions: { [version.id]: version },
      timeline: [version.id],
      restoreUndos: []
    };
    doc.entries[key] = entry;
    return { entry, changed: true };
  }
  const head = entry.versions[entry.timeline[entry.timeline.length - 1]];
  if (!head || !sameElementHistoryState(head.state, stateSnapshot)) {
    const version = makeElementHistoryVersion(
      stateSnapshot, by || 'system', historyChangeSummary(head && head.state, stateSnapshot, summary)
    );
    entry.versions[version.id] = version;
    entry.timeline.push(version.id);
    if (entry.timeline.length > ELEMENT_HISTORY_VISIBLE_LIMIT) entry.timeline.shift();
    entry.restoreUndos = [];
    pruneElementHistoryVersions(entry);
    return { entry, changed: true };
  }
  return { entry, changed: false };
}

function allElementHistoryRefs(sourceModel) {
  const refs = [];
  for (const slide of sourceModel.slides || []) {
    for (const object of slide.elements || []) refs.push(elementHistoryRef(slide.id, 'element', object.id));
    for (const object of slide.decor || []) refs.push(elementHistoryRef(slide.id, 'decor', object.id));
  }
  return refs;
}

function reconcileElementHistory(doc, sourceModel, by, summary) {
  let changed = false;
  const refs = allElementHistoryRefs(sourceModel);
  const liveKeys = new Set(refs.map(elementHistoryKey));
  for (const ref of refs) {
    const result = ensureElementHistoryEntry(doc, sourceModel, ref, by, summary);
    if (result && result.changed) changed = true;
  }

  for (const key of Object.keys(doc.entries)) {
    if (!liveKeys.has(key)) {
      delete doc.entries[key];
      changed = true;
    }
  }
  doc.modelRev = sourceModel.rev || 0;
  return changed;
}

function initializeElementHistory() {
  let committed = loadJSON(
    ELEMENT_HISTORY_PATH,
    emptyElementHistory(model.rev || 0),
    validateElementHistoryDocument
  );
  let pending = null;
  let recoveredPending = false;
  try {
    pending = loadJSON(ELEMENT_HISTORY_PENDING_PATH, null, validateElementHistoryPendingDocument);
  } catch (error) {
    // A malformed transaction marker is ambiguous and must not be silently
    // discarded: it may be the only complete side of a committed model edit.
    throw error;
  }
  if (pending) {
    if (pending.modelRev <= (model.rev || 0) && pending.modelRev >= committed.modelRev) {
      committed = pending.history;
      recoveredPending = true;
    }
  }
  const historyModelRevBeforeReconcile = committed.modelRev;
  const changed = reconcileElementHistory(committed, model, 'system', 'Recovered current deck');
  const invalid = validateElementHistoryDocument(committed);
  if (invalid) throw new Error(`Cannot initialize element-history.json: ${invalid}`);
  if (changed || recoveredPending || !fs.existsSync(ELEMENT_HISTORY_PATH) ||
      historyModelRevBeforeReconcile !== model.rev) {
    committed.modelRev = model.rev || 0;
    if (!saveJSONAtomic(ELEMENT_HISTORY_PATH, committed)) {
      throw new Error('Cannot initialize durable element history');
    }
  }
  if (pending) {

    try { fs.unlinkSync(ELEMENT_HISTORY_PENDING_PATH); } catch (error) {
      if (error && error.code !== 'ENOENT') throw error;
    }
  }
  elementHistory = committed;
}

function historyPatchForEntries(beforeDoc, afterDoc, keys) {
  const beforeEntries = {};
  const afterEntries = {};
  for (const key of keys) {
    beforeEntries[key] = beforeDoc.entries[key] ? cloneJSON(beforeDoc.entries[key]) : null;
    afterEntries[key] = afterDoc.entries[key] ? cloneJSON(afterDoc.entries[key]) : null;
  }
  return { beforeEntries, afterEntries };
}

function historyCandidateForTransition(beforeModel, afterModel, by, summary) {
  const beforeDoc = elementHistory;
  const afterDoc = cloneJSON(elementHistory);
  const keys = new Set();
  const beforeRefs = new Map(allElementHistoryRefs(beforeModel).map((ref) => [elementHistoryKey(ref), ref]));
  const afterRefs = new Map(allElementHistoryRefs(afterModel).map((ref) => [elementHistoryKey(ref), ref]));
  for (const [key, ref] of afterRefs) {
    const beforeState = beforeRefs.has(key) ? captureRawElementHistoryState(beforeModel, ref) : null;
    const afterState = captureRawElementHistoryState(afterModel, ref);
    if (beforeState && sameElementHistoryState(beforeState, afterState) && afterDoc.entries[key]) continue;
    const oldEntry = afterDoc.entries[key] ? cloneJSON(afterDoc.entries[key]) : null;
    const ensured = ensureElementHistoryEntry(afterDoc, afterModel, ref, by, summary);
    if (ensured && (!oldEntry || JSON.stringify(oldEntry) !== JSON.stringify(afterDoc.entries[key]))) keys.add(key);
  }
  for (const key of beforeRefs.keys()) {
    if (afterRefs.has(key) || !afterDoc.entries[key]) continue;
    delete afterDoc.entries[key];
    keys.add(key);
  }
  afterDoc.modelRev = afterModel.rev || 0;
  return { history: afterDoc, patch: historyPatchForEntries(beforeDoc, afterDoc, keys) };
}

function applyElementHistoryPatch(baseDoc, patch, side, modelRev) {
  const candidate = cloneJSON(baseDoc);
  const rows = side === 'before' ? patch.beforeEntries : patch.afterEntries;
  for (const [key, entry] of Object.entries(rows || {})) {
    if (entry) candidate.entries[key] = cloneJSON(entry);
    else delete candidate.entries[key];
  }
  candidate.modelRev = modelRev;
  return candidate;
}

function persistModelAndElementHistory(candidateModel, candidateHistory) {
  candidateHistory.modelRev = candidateModel.rev || 0;
  const invalid = validateElementHistoryDocument(candidateHistory);
  if (invalid) return { ok: false, error: `invalid history candidate: ${invalid}` };

  if (fs.existsSync(ELEMENT_HISTORY_PENDING_PATH)) {
    if (!saveJSONAtomic(ELEMENT_HISTORY_PATH, elementHistory)) {
      return { ok: false, error: 'prior history promotion is still pending' };
    }
    try { fs.unlinkSync(ELEMENT_HISTORY_PENDING_PATH); }
    catch (error) {
      if (!error || error.code !== 'ENOENT') {
        return { ok: false, error: 'could not clear prior history transaction' };
      }
    }
  }
  const pending = {
    schemaVersion: 1,
    modelRev: candidateModel.rev || 0,
    history: candidateHistory
  };
  if (!saveJSONAtomic(ELEMENT_HISTORY_PENDING_PATH, pending)) {
    return { ok: false, error: 'history staging failed' };
  }
  if (!persistModel(candidateModel)) {
    try { fs.unlinkSync(ELEMENT_HISTORY_PENDING_PATH); } catch (_) {}
    return { ok: false, error: 'persist failed' };
  }
  const promoted = saveJSONAtomic(ELEMENT_HISTORY_PATH, candidateHistory);
  if (promoted) {
    try { fs.unlinkSync(ELEMENT_HISTORY_PENDING_PATH); } catch (_) {}
  }

  return { ok: true, promotionPending: !promoted };
}

function applyElementHistoryState(candidateModel, ref, stateSnapshot) {
  const found = findHistoryObject(candidateModel, ref);
  if (!found) return { ok: false, error: 'object no longer exists' };
  const replacement = cloneJSON(stateSnapshot.object);
  if (replacement.id !== ref.objectId) return { ok: false, error: 'history object id mismatch' };
  if (replacement.generated && replacement.kind === 'pic') {
    const resolved = resolveProjectImageSource(replacement.source);
    if (!resolved.ok) return { ok: false, error: `historical image unavailable: ${resolved.error}` };
  }
  if (replacement.generated && replacement.kind === 'media') {
    const resolved = resolveProjectVideoSource(replacement.source);
    if (!resolved.ok) return { ok: false, error: `historical video unavailable: ${resolved.error}` };
  }
  found.collection[found.index] = replacement;
  const retained = (found.slide.animations || []).filter((animation) =>
    !animation || animation.targetId !== ref.objectId
  );
  for (const row of [...stateSnapshot.animations].sort((a, b) => a.index - b.index)) {
    retained.splice(Math.min(row.index, retained.length), 0, cloneJSON(row.animation));
  }
  if (retained.length) found.slide.animations = retained;
  else delete found.slide.animations;
  return { ok: true };
}

function objectHistoryResponse(ref) {
  const entry = elementHistory.entries[elementHistoryKey(ref)];
  if (!entry) return null;
  const top = entry.restoreUndos[entry.restoreUndos.length - 1] || null;
  const found = findHistoryObject(model, ref);
  const labelObject = found && found.object;
  const label = labelObject && (labelObject.text || labelObject.name || labelObject.kind || labelObject.type) || ref.objectId;
  const conflict = protectionConflictForScope({ slides: [ref.slideId], wholeSlides: [], objects: [ref] });
  return {
    ok: true,
    target: Object.assign({}, ref, { label: trunc(label) }),
    versions: entry.timeline.map((id) => cloneJSON(entry.versions[id])),
    headId: entry.timeline[entry.timeline.length - 1],
    undoDepth: entry.restoreUndos.length,
    maxUndo: ELEMENT_HISTORY_RESTORE_UNDO_LIMIT,
    topCheckpointToken: top ? top.token : null,
    locked: !!conflict,
    paused: !!state.paused,
    totalSaved: Object.keys(entry.versions).length
  };
}

function parseObjectHistoryTarget(values) {
  const ref = elementHistoryRef(values.slideId, values.objectKind, values.objectId);
  if (!ref.slideId || !['element', 'decor'].includes(ref.objectKind) || !ref.objectId) {
    return { ok: false, error: 'slideId, objectKind (element|decor), and objectId are required' };
  }
  if (!findHistoryObject(model, ref)) return { ok: false, error: 'object not found' };
  const entry = elementHistory.entries[elementHistoryKey(ref)];
  if (!entry) return { ok: false, error: 'object history not found' };
  return { ok: true, ref, entry };
}

function isSuiteAgentActor(name) { return isExternalEditor(name); }

function isObjectHistoryAgentActor(name) { return isSuiteAgentActor(name); }

function assignDecorLocalIds() {
  let changed = false;
  for (const s of model.slides) {
    if (!Array.isArray(s.decor)) continue;
    s.decor.forEach((d, i) => {
      if (!d.id) { d.id = `${s.id}_d${i}`; changed = true; }
    });
  }
  return changed;
}
function normalizeModelBase() {
  if ((model.mode || 'native') !== 'overlay' || !model.base) return false;
  const expected = path.join(DATA, 'base.pptx');
  if (model.base === expected) return false;
  if (fs.existsSync(model.base)) return false;   // stored path still valid, leave it alone
  if (!fs.existsSync(expected)) return false;    // nothing to self-heal to either
  console.error(`model.base was stale (${model.base}), correcting to ${expected}`);
  model.base = expected;
  return true;
}

function backfillDecorSids() {
  return new Promise((resolve) => {
    if ((model.mode || 'native') !== 'overlay' || !model.base || !fs.existsSync(model.base)) return resolve(false);
    const needsSids = model.slides.some((s) => (s.decor || []).some(
      (d) => d.generated !== true && d.kind === 'shape' && d.sid == null
    ));
    if (!needsSids) return resolve(false);

    execFile(PY, [path.join(HERE, 'src/python/tools_decor_sids.py'), model.base], { cwd: HERE, maxBuffer: 10 * 1024 * 1024, timeout: 30000 }, (err, stdout) => {
      if (err) { console.error('decor sid backfill skipped:', err.message); return resolve(false); }
      let map;
      try { map = JSON.parse(stdout); } catch (e) { console.error('decor sid backfill: bad JSON from helper'); return resolve(false); }
      let changed = false;
      for (const s of model.slides) {
        if (!Number.isInteger(s.src) || !Array.isArray(s.decor)) continue;
        const importedDecor = s.decor.filter((d) => d.generated !== true);
        const sids = map[String(s.src)];
        if (!Array.isArray(sids) || sids.length !== importedDecor.length) continue;
        importedDecor.forEach((d, i) => {
          if (d.kind === 'shape' && d.sid == null && sids[i] != null) { d.sid = sids[i]; changed = true; }
        });
      }
      resolve(changed);
    });
  });
}

function backfillShapePresets() {
  return new Promise((resolve, reject) => {
    if ((model.mode || 'native') !== 'overlay' ||
        !model.base || !fs.existsSync(model.base)) return resolve(false);
    const requiresAudit = model.shapePresetSchema === 1 || model.slides.some((slide) =>
      [...(slide.elements || []), ...(slide.decor || [])].some((item) =>
        item.sourcePreset !== undefined || item.corners !== undefined
      )
    );
    const failed = (message) => {
      if (requiresAudit) {
        reject(new Error(`shape preset audit failed: ${message}`));
      } else {
        console.error(`shape preset backfill skipped: ${message}`);
        resolve(false);
      }
    };
    execFile(
      PY,
      [path.join(HERE, 'src/python/tools_shape_presets.py'), model.base],
      { cwd: HERE, maxBuffer: 10 * 1024 * 1024, timeout: 30000 },
      (err, stdout) => {
        if (err) {
          return failed(err.message);
        }
        let map;
        try {
          map = JSON.parse(stdout);
        } catch (_) {
          return failed('helper returned invalid JSON');
        }
        if (!isRecord(map)) {
          return failed('helper returned a non-object');
        }
        for (const slide of model.slides) {
          if (!Number.isInteger(slide.src)) continue;
          const byShapeId = map[String(slide.src)];
          if (!isRecord(byShapeId)) {
            return failed(`no source slide ${slide.src}`);
          }
          for (const object of [...(slide.elements || []), ...(slide.decor || [])]) {
            const sid = object.ref && object.ref.sid !== undefined
              ? object.ref.sid
              : object.sid;
            if (!Number.isInteger(sid)) continue;
            const expected = byShapeId[String(sid)];
            if (expected !== undefined && !BOX_SHAPE_PRESETS.has(expected)) {
              return failed(`invalid preset for ${slide.src}:${sid}`);
            }
            if (object.sourcePreset !== undefined && object.sourcePreset !== expected) {
              return failed(
                `source mismatch for ${slide.src}:${sid}: ` +
                `model=${object.sourcePreset}, base=${expected || 'ineligible'}`
              );
            }
          }
        }
        let changed = model.shapePresetSchema !== 1;
        for (const slide of model.slides) {
          if (!Number.isInteger(slide.src)) continue;
          const byShapeId = map[String(slide.src)];
          for (const object of [...(slide.elements || []), ...(slide.decor || [])]) {
            const sid = object.ref && object.ref.sid !== undefined
              ? object.ref.sid
              : object.sid;
            const preset = Number.isInteger(sid) ? byShapeId[String(sid)] : undefined;
            if (preset && object.sourcePreset !== preset) {
              object.sourcePreset = preset;
              changed = true;
            }
          }
        }
        model.shapePresetSchema = 1;
        resolve(changed);
      }
    );
  });
}

async function migrateModel() {
  const base = normalizeModelBase();
  if ((model.mode || 'native') === 'overlay') {
    let validBase = false;
    try { validBase = fs.statSync(model.base).isFile(); } catch (_) {}
    if (!validBase) throw new Error(`overlay base PowerPoint is unavailable: ${model.base}`);
  }
  const a = assignDecorLocalIds();
  const b = await backfillDecorSids();
  const c = await backfillShapePresets();
  const invalid = validateModelDocument(model, true);
  if (invalid) throw new Error(`model migration did not produce a valid model: ${invalid}`);
  if (base || a || b || c) {
    if (!persistModel()) {
      throw new Error('model migration could not be saved; refusing to serve an in-memory-only model');
    }
    console.log(
      `migrated model.json: ${base ? 'base path corrected, ' : ''}` +
      `decor ids${b ? ' + sids' : ''}${c ? ' + box/card presets' : ''} backfilled`
    );
  }
}

function appendStateLog(target, entry) {
  const e = Object.assign({ ts: Date.now() }, entry);
  if (!Array.isArray(target.log)) target.log = [];
  target.log.push(e);
  if (target.log.length > 300) target.log = target.log.slice(-300);
  return e;
}

function appendProtectionHistory(target, entry) {
  if (!Array.isArray(target.protectionHistory)) target.protectionHistory = [];
  const event = Object.assign({}, entry);
  target.protectionHistory.push(event);
  if (target.protectionHistory.length > PROTECTION_HISTORY_LIMIT) {
    target.protectionHistory = target.protectionHistory.slice(-PROTECTION_HISTORY_LIMIT);
  }
  return event;
}

function copyState() {
  return JSON.parse(JSON.stringify(state));
}

function addLog(entry) {
  const e = appendStateLog(state, entry);
  persistState();
  return e;
}

function defaultBoard() {
  return { notes: [], tasks: [], loops: [] };
}

function persistBoard(nextBoard) { return saveJSONAtomic(BOARD_PATH, nextBoard || board); }

function copyBoard(source) {
  return JSON.parse(JSON.stringify(source || board));
}

function transactBoard(mutator) {
  let candidate, result;
  try {
    candidate = copyBoard();
    result = mutator(candidate);
  } catch (e) {
    console.error('board mutation rejected:', e && (e.stack || e));
    return { ok: false, error: e instanceof Error ? e.message : 'board mutation failed' };
  }
  if (!result || result.ok === false) return result || { ok: false, error: 'board mutation failed' };
  // Agent messages share a bounded pool; human notes and pins are never evicted.
  // Legacy unpinned messages have no authenticated provenance and join that pool.
  const disposable = candidate.notes.filter(n => !n.pinned && !n.humanOrigin).sort((a,b) => a.ts-b.ts);
  let agentBytes = Buffer.byteLength(JSON.stringify(disposable));
  let totalBytes = Buffer.byteLength(JSON.stringify(candidate));
  for (const note of disposable) {
    // Keep the just-added note or reject the transaction; never acknowledge a lost write.
    if (result.note && note.id === result.note.id) continue;
    if (agentBytes <= 128 * 1024 && totalBytes <= 512 * 1024) break;
    candidate.notes = candidate.notes.filter(n => n.id !== note.id);
    agentBytes -= Buffer.byteLength(JSON.stringify(note)) + 1;
    totalBytes = Buffer.byteLength(JSON.stringify(candidate));
  }
  const bytes = totalBytes;
  if (bytes > 512 * 1024 && bytes >= Buffer.byteLength(JSON.stringify(board))) return {ok:false,error:'Board storage limit reached; remove older messages or tasks'};
  if (!persistBoard(candidate)) return { ok: false, error: 'could not save board' };
  board = candidate;
  return Object.assign({ ok: true }, result);
}

// pinned house rules first (stable, oldest-first), then messages newest-first
function boardPage(source, offset = 0, limit = 100) {
  const current = source || board;
  const pinned = current.notes.filter(n => n.pinned).sort((a,b) => a.ts-b.ts);
  const rest = current.notes.filter(n => !n.pinned).sort((a,b) => b.ts-a.ts);
  const all = pinned.concat(rest);
  const notes = []; let bytes = 0; let nextOffset = offset;
  for (const note of all.slice(offset, offset + limit)) {
    const size = Buffer.byteLength(JSON.stringify(note));
    if (bytes + size > 256 * 1024) break;
    notes.push(note); bytes += size; nextOffset++;
  }
  return {notes,hasMore:nextOffset < all.length,nextOffset,total:all.length};
}
function boardView(source) { return boardPage(source).notes; }

function addNoteTo(target, { text, author, pinned, humanOrigin = false }) {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(String(text)+String(author))) throw new Error('Board notes cannot contain control characters');
  const owner = String(author == null || author === '' ? 'anonymous' : author).slice(0,60);
  if (!humanOrigin && !pinned && target.notes.filter(n => !n.pinned && !n.humanOrigin && n.author === owner && Date.now()-n.ts < 60000).length >= 20) throw new Error('Board posting limit reached; wait one minute');
  const note = {
    id: shortId('n'),
    text: String(text == null ? '' : text).slice(0, 4000),
    author: String(author == null || author === '' ? 'anonymous' : author).slice(0, 60),
    pinned: !!pinned,
    humanOrigin: humanOrigin === true,
    ts: Date.now()
  };
  target.notes.push(note);
  const own = target.notes.filter(n => !n.pinned && !n.humanOrigin && n.author === note.author);
  if (own.length > 100) {
    const drop = new Set(own.slice(0,own.length-100).map(n => n.id));
    target.notes = target.notes.filter(n => !drop.has(n.id));
  }
  // Retain at most 400 unprivileged messages without evicting human notes.
  const nonPinned = target.notes.filter((n) => !n.pinned && !n.humanOrigin);
  if (nonPinned.length > 400) {
    const keep = new Set(nonPinned.slice(-400).map((n) => n.id));
    target.notes = target.notes.filter((n) => n.pinned || n.humanOrigin || keep.has(n.id));
  }
  return note;
}

function addNote(input) { return transactBoard((target) => ({ note: addNoteTo(target, input) })); }

function tasksView(source) {
  const current = source || board;
  const active = current.tasks.filter((t) => t.status !== 'done').sort((a, b) => a.ts - b.ts);
  const done = current.tasks.filter((t) => t.status === 'done').sort((a, b) => (b.doneTs || 0) - (a.doneTs || 0));
  return active.concat(done);
}

const TASK_REVISION_LIMIT = 50;
function addTaskTo(target, {text, by, assignee}) {
  const task = {id:shortId('t'), text:String(text).slice(0, 2000), by:String(by || 'anonymous').slice(0, 60),
    assignee:String(assignee || ''), status:'open', claimedBy:'', ts:Date.now(), doneTs:null};
  target.tasks.push(task);
  const done = target.tasks.filter(t => t.status === 'done');
  if (done.length > 200) {
    const keep = new Set(done.slice(-200).map(t => t.id));
    target.tasks = target.tasks.filter(t => t.status !== 'done' || keep.has(t.id));
  }
  return task;
}

function addTask(input) { return transactBoard(target => ({task:addTaskTo(target, input)})); }

function findTask(id, source) { return (source || board).tasks.find((t) => t.id === id); }

function delegatedProtectionGrant(actor, taskId, slideId, now) {
  const id = typeof taskId === 'string' ? taskId.trim() : '';
  if (!id) {
    return {
      ok: false,
      error: 'agents may not create or remove content protections without a human-granted task id'
    };
  }
  const task = findTask(id);
  if (!task) return { ok: false, error: 'no such delegated protection task' };
  if (!['open', 'claimed'].includes(task.status)) {
    return { ok: false, error: `delegated protection task is ${task.status}` };
  }
  const assignedToActor = task.assignee === actor || (!task.assignee && task.claimedBy === actor);
  if (!assignedToActor || (task.claimedBy && task.claimedBy !== actor)) {
    return { ok: false, error: 'delegated protection task is assigned to another editor' };
  }
  const grant = task.protectionGrant;
  if (!isRecord(grant) || !Array.isArray(grant.slideIds)) {
    return { ok: false, error: 'task has no human protection grant' };
  }
  if (grant.version !== 1 || grant.grantedTo !== actor) {
    return { ok: false, error: 'task protection grant belongs to another editor' };
  }
  if (grant.revokedAt) return { ok: false, error: 'task protection grant was revoked' };
  const at = Number.isSafeInteger(now) ? now : Date.now();
  if (!Number.isSafeInteger(grant.expiresAt) || grant.expiresAt <= at) {
    return { ok: false, error: 'task protection grant expired' };
  }
  if (typeof grant.grantedBy !== 'string' || !grant.grantedBy.trim() ||
      isSuiteAgentActor(grant.grantedBy)) {
    return { ok: false, error: 'task protection grant has no valid human authorizer' };
  }
  if (!grant.slideIds.includes(slideId)) {
    return { ok: false, error: `task protection grant does not include slide ${slideId}` };
  }
  return { ok: true, task, grant };
}

function delegatedProtectionMode(actor, taskId, protection, protectedValue, mode, now) {
  const delegated = delegatedProtectionGrant(actor, taskId, protection.slideId, now);
  if (!delegated.ok) return delegated;
  if (!delegated.grant.protectionModes.includes(mode)) {
    return { ok: false, error: `task protection grant does not allow ${mode}` };
  }
  if (protectedValue !== true) {
    return { ok: false, error: 'delegated protection control may only add protections' };
  }
  if (mode !== 'direct-generated-decor' ||
      protection.kind !== 'object' || protection.objectKind !== 'decor') {
    return { ok: false, error: 'direct-generated-decor requires a decor target' };
  }
  return delegated;
}

function delegatedProtectedEdit(actor, taskId, op, now) {
  if (!isSuiteAgentActor(actor)) {
    return { ok: false, error: 'taskId is only valid for an agent edit' };
  }
  const slideId = op && typeof op.slideId === 'string' ? op.slideId : '';
  const delegated = delegatedProtectionGrant(actor, taskId, slideId, now);
  if (!delegated.ok) return delegated;
  if (!delegated.grant.editOps.includes(op.type)) {
    return { ok: false, error: `task protection grant does not allow edit ${op.type || '(missing)'}` };
  }
  if (op.type !== 'add-image' || typeof op.source !== 'string') {
    return { ok: false, error: 'delegated add-image requires an image source' };
  }
  return delegated;
}

function taskAssigneeError(assignee) {
  if (assignee === undefined || assignee === '') return null;
  return typeof assignee === 'string' && /^[A-Za-z0-9][A-Za-z0-9._ -]{0,59}$/.test(assignee)
    ? null : 'Assignee must be an editor name of at most 60 characters';
}

function loopView(source) {
  return (source || board).loops.slice().sort((a, b) => (a.createdTs || 0) - (b.createdTs || 0));
}

function addLoopTo(target, { text, author, cadence }) {
  const loop = {
    id: shortId('loop'),
    text: String(text == null ? '' : text).slice(0, 4000),
    author: String(author == null || author === '' ? 'anonymous' : author).slice(0, 60),
    cadence: cadence == null || cadence === '' ? null : String(cadence).slice(0, 40),  // free-form hint, e.g. "each edit" or "10m"
    enabled: true,
    createdTs: Date.now(),
    lastRun: null,     // when a session last ran this loop
    lastBy: '',        // who ran it
    lastResult: null   // short summary of the last run
  };
  target.loops.push(loop);
  if (target.loops.length > 200) target.loops = target.loops.slice(-200);
  return loop;
}

function addLoop(input) { return transactBoard((target) => ({ loop: addLoopTo(target, input) })); }

function findLoop(id, source) { return (source || board).loops.find((l) => l.id === id); }

// --------------------------------------------------------------------- SSE
function broadcast(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of sseClients) {
    try { res.write(payload); } catch (_) { /* dropped on next tick */ }
  }
}

function editorList() {
  // Attach each editor's agent color+ink (a pure function of name), so the
  // /studio chips and per-agent region indicators resolve colors from the
  // same authoritative source. Humans/pseudo-editors get null (no chip).
  return [...editors.values()]
    .map((ed) => Object.assign({}, ed, editorColor(ed.name) || {}))
    .sort((a, b) => a.joinedAt - b.joinedAt);
}

function pruneEditors() {
  const now = Date.now();
  let changed = false;
  for (const [id, ed] of editors) {
    if (now - ed.lastSeen > EDITOR_TTL) { editors.delete(id); changed = true; }
  }
  if (changed) broadcast({ type: 'editors', editors: editorList(), ts: now });
}
setInterval(pruneEditors, 5000).unref();
setInterval(() => broadcast({ type: 'ping', ts: Date.now() }), 20000).unref();

function lockView() {
  return [...locks.values()].sort((a, b) => a.ts - b.ts);
}

function pruneLocks() {
  const now = Date.now();
  let changed = false;
  for (const [id, l] of locks) {
    if (now - l.ts > LOCK_TTL) { locks.delete(id); changed = true; }
  }
  if (changed) broadcast({ type: 'locks', locks: lockView(), ts: now });
}
setInterval(pruneLocks, 30000).unref();

function releaseLocksFor(by, slideIds) {
  if (!by) return false;
  let changed = false;
  const only = Array.isArray(slideIds) ? new Set(slideIds) : null;
  for (const [id, l] of locks) {
    if (l.by !== by) continue;
    if (only && !only.has(id)) continue;
    locks.delete(id);
    changed = true;
  }
  return changed;
}

// ------------------------------------------------------------ COM host

const COM_HOST_READY_TIMEOUT_MS = 10000;
const COM_HOST_JOB_TIMEOUT_MS = 15000;
const COM_HOST_STOP_TIMEOUT_MS = 4000;
const COM_HOST_KILL_SETTLE_MS = 5000;
const COM_HOST_STDOUT_FRAME_LIMIT = 256 * 1024;
const COM_HOST_STDERR_LIMIT = 64 * 1024;
let comHostSession = null;
let comHostStartPromise = null;
let comHostSweepPromise = null;
let comHostBlockedError = null;
let comHostGeneration = 0;
let comHostNextId = 1;
let comHostShuttingDown = false;

function validComHostPid(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function taskkillComHostPid(pid, includeTree) {
  if (!IS_WIN || !validComHostPid(pid)) return Promise.resolve(false);
  const args = ['/PID', String(pid)];
  if (includeTree) args.push('/T');
  args.push('/F');
  return new Promise((resolve) => {
    try {
      execFile('taskkill', args, { windowsHide: true }, (error) => resolve(!error));
    } catch (_) {
      resolve(false);
    }
  });
}

function queryWindowsProcess(pid) {
  if (!IS_WIN || !validComHostPid(pid)) return Promise.resolve({ exists: false });
  const command = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"`,
    "if ($null -eq $p) { [Console]::Out.Write('{\"exists\":false}'); exit 0 }",
    "$result = @{ exists = $true; name = [string]$p.Name; commandLine = [string]$p.CommandLine; startedAt = $p.CreationDate.ToUniversalTime().ToString('o') }",
    '[Console]::Out.Write(($result | ConvertTo-Json -Compress))',
  ].join('; ');
  return new Promise((resolve, reject) => {
    try {
      execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', command],
        { windowsHide: true, timeout: 2000, maxBuffer: 32 * 1024 }, (error, stdout) => {
          if (error) { reject(error); return; }
          let result;
          try { result = JSON.parse(String(stdout || '')); }
          catch (_) { reject(new Error('process identity query returned malformed JSON')); return; }
          if (result && result.exists === false) { resolve({ exists: false }); return; }
          const startedAt = Date.parse(result && result.startedAt);
          if (!result || result.exists !== true || typeof result.name !== 'string' ||
              typeof result.commandLine !== 'string' || !Number.isFinite(startedAt)) {
            reject(new Error('process identity query returned incomplete data'));
            return;
          }
          resolve({
            exists: true,
            name: result.name,
            commandLine: result.commandLine,
            startedAt,
          });
        });
    } catch (error) {
      reject(error);
    }
  });
}

async function staleComHostIdentity(stale) {
  if (!validComHostPid(stale.psPid)) return null;

  const processInfo = await queryWindowsProcess(stale.psPid);
  if (!processInfo.exists || !/^(powershell|pwsh)\.exe$/i.test(processInfo.name)) return null;
  const commandLine = processInfo.commandLine.toLowerCase();
  if (!commandLine.includes(String(COM_HOST_PS1).toLowerCase())) return null;
  if (typeof stale.token === 'string' && /^[a-f0-9]{32}$/.test(stale.token)) {
    if (!commandLine.includes(stale.token)) return null;
  } else {
    const approximateStart =
      typeof stale.startedAt === 'number' && Number.isFinite(stale.startedAt)
        ? stale.startedAt : NaN;
    if (!Number.isFinite(approximateStart) ||
        Math.abs(processInfo.startedAt - approximateStart) > 2 * 60 * 1000) return null;
  }
  return processInfo;
}

async function recordedPowerPointStart(pid, approximateStart) {
  let processInfo;
  try { processInfo = await queryWindowsProcess(pid); }
  catch (_) { return null; }
  if (!processInfo.exists || !/^powerpnt\.exe$/i.test(processInfo.name)) return null;
  if (Number.isFinite(approximateStart) &&
      Math.abs(processInfo.startedAt - approximateStart) > 2 * 60 * 1000) return null;
  return processInfo.startedAt;
}

async function terminateRecordedPowerPoint(pid, expectedStart) {
  if (!validComHostPid(pid)) return true;
  let before;
  try { before = await queryWindowsProcess(pid); }
  catch (_) { return false; }

  if (!before.exists || !/^powerpnt\.exe$/i.test(before.name)) return true;
  if (!Number.isFinite(expectedStart)) return false;
  if (Math.abs(before.startedAt - expectedStart) > 1500) return true;

  await taskkillComHostPid(pid, false);
  for (let attempt = 0; attempt < 4; attempt++) {
    let after;
    try { after = await queryWindowsProcess(pid); }
    catch (_) { return false; }
    if (!after.exists || !/^powerpnt\.exe$/i.test(after.name) ||
        Math.abs(after.startedAt - expectedStart) > 1500) return true;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return false;
}

async function terminateRecordedPowerShell(pid, expectedIdentity) {
  if (!validComHostPid(pid) || !expectedIdentity || !expectedIdentity.exists) return false;
  await taskkillComHostPid(pid, true);
  for (let attempt = 0; attempt < 4; attempt++) {
    let after;
    try { after = await queryWindowsProcess(pid); }
    catch (_) { return false; }
    if (!after.exists || !/^(powershell|pwsh)\.exe$/i.test(after.name) ||
        after.startedAt !== expectedIdentity.startedAt ||
        after.commandLine !== expectedIdentity.commandLine) return true;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return false;
}

async function sweepStaleComHost() {

  let stale;
  try { stale = JSON.parse(fs.readFileSync(COM_HOST_PID_PATH, 'utf8')); } catch (_) { return; }
  if (!stale || !IS_WIN) return;
  const powerShellIdentity = await staleComHostIdentity(stale);
  let powerpointStartedAt =
    typeof stale.powerpointStartedAt === 'number' && Number.isFinite(stale.powerpointStartedAt)
      ? stale.powerpointStartedAt : NaN;
  const markerStartedAt =
    typeof stale.startedAt === 'number' && Number.isFinite(stale.startedAt)
      ? stale.startedAt : NaN;
  // A tentative/legacy marker has no exact PowerPoint creation time. A new
  // tokenized marker can use its persisted startup window directly; a legacy
  // marker additionally needs the still-running, script-matched PowerShell
  // process to authenticate it.
  const tokenizedMarker =
    typeof stale.token === 'string' && /^[a-f0-9]{32}$/.test(stale.token);
  if (!Number.isFinite(powerpointStartedAt) &&
      (powerShellIdentity || (tokenizedMarker && Number.isFinite(markerStartedAt))) &&
      validComHostPid(stale.powerpointPid)) {
    powerpointStartedAt = await recordedPowerPointStart(
      stale.powerpointPid, markerStartedAt
    );
  }
  if (powerShellIdentity) {
    if (!await terminateRecordedPowerShell(stale.psPid, powerShellIdentity)) {
      throw new Error('Could not confirm stale COM host PowerShell cleanup');
    }
  } else if (validComHostPid(stale.psPid)) {
    console.error('Skipped stale COM host cleanup because its PID identity no longer matches');
  }
  const powerpointClean = await terminateRecordedPowerPoint(
    stale.powerpointPid, powerpointStartedAt
  );
  if (!powerpointClean) {
    throw new Error('Could not confirm stale COM host PowerPoint cleanup');
  }
  try { fs.unlinkSync(COM_HOST_PID_PATH); } catch (_) {}
}

function boundedComHostText(current, chunk, limit) {
  const combined = current + String(chunk);
  return combined.length <= limit ? combined : combined.slice(combined.length - limit);
}

function comHostMarker(session) {
  return {
    psPid: validComHostPid(session.psPid) ? session.psPid : session.proc.pid,
    powerpointPid: validComHostPid(session.powerpointPid) ? session.powerpointPid : null,
    powerpointStartedAt: Number.isFinite(session.powerpointStartedAt)
      ? session.powerpointStartedAt : null,
    startedAt: session.startedAt,
    token: session.token,
  };
}

function saveComHostMarker(session) {
  try { return saveJSONAtomic(COM_HOST_PID_PATH, comHostMarker(session)) !== false; }
  catch (_) { return false; }
}

function removeComHostMarker(session) {
  // A late exit from generation N must never delete generation N+1's marker.
  let marker;
  try { marker = JSON.parse(fs.readFileSync(COM_HOST_PID_PATH, 'utf8')); } catch (_) { return; }
  if (!marker || marker.token !== session.token) return;
  try { fs.unlinkSync(COM_HOST_PID_PATH); } catch (_) {}
}

function settleComHostReady(session, error) {
  if (session.readySettled) return;
  session.readySettled = true;
  clearTimeout(session.readyTimer);
  if (error) session.rejectReady(error);
  else {
    session.wasReady = true;
    session.resolveReady(session);
  }
}

function rejectComHostPending(session, error) {
  for (const [, pending] of session.pending) pending.reject(error);
  session.pending.clear();
}

function killComHostSession(session) {
  if (session.killIssued) return;
  session.killIssued = true;
  const psPid = validComHostPid(session.psPid) ? session.psPid : session.proc.pid;
  if (IS_WIN && validComHostPid(psPid)) {
    taskkillComHostPid(psPid, true);
  } else {
    try { session.proc.kill('SIGKILL'); } catch (_) {}
  }
}

function finalizeComHostSession(session, error, terminationConfirmed) {
  if (!session.active) return;
  session.active = false;
  clearTimeout(session.readyTimer);
  clearTimeout(session.killSettleTimer);
  rejectComHostPending(session, error);
  settleComHostReady(session, error);
  if (comHostSession === session) comHostSession = null;
  if (terminationConfirmed) removeComHostMarker(session);
  else {
    // Do not overlap a new PowerPoint owner with a process the OS never
    // confirmed dead. A server restart will re-run the token-checked sweep.
    comHostBlockedError = new Error('COM host termination was not confirmed; restart the suite before retrying');
  }
  session.resolveRetired();
}

function beginComHostRetirement(session, error, kill) {
  if (!session.active) return session.retiredPromise;
  if (!session.retiring) {
    session.retiring = true;
    session.retireReason = error;
    rejectComHostPending(session, error);
  }
  if (kill) {
    killComHostSession(session);
    if (!session.killSettleTimer) {
      session.killSettleTimer = setTimeout(
        () => finalizeComHostSession(session, session.retireReason || error, false),
        COM_HOST_KILL_SETTLE_MS
      );
    }
  }
  return session.retiredPromise;
}

function failComHostProtocol(session, error) {
  if (!session.active || session.retiring) return;
  session.stderr = boundedComHostText(session.stderr, '\n' + error.message, COM_HOST_STDERR_LIMIT);
  beginComHostRetirement(session, error, true);
}

function handleComHostLine(session, rawLine) {
  if (!session.active || session.retiring) return;
  const line = rawLine.trim();
  if (!line) return;
  if (line.length > COM_HOST_STDOUT_FRAME_LIMIT) {
    failComHostProtocol(session, new Error('COM host stdout frame exceeded limit'));
    return;
  }
  let msg;
  try { msg = JSON.parse(line); }
  catch (_) {
    failComHostProtocol(session, new Error('COM host emitted malformed JSON'));
    return;
  }
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || !Number.isSafeInteger(msg.id)) {
    failComHostProtocol(session, new Error('COM host emitted an invalid protocol message'));
    return;
  }
  if (msg.id === 0) {
    if (session.readyMessageReceived || session.readySettled || session.wasReady) {
      failComHostProtocol(session, new Error('COM host emitted a duplicate ready message'));
      return;
    }
    if (msg.ok !== true) {
      beginComHostRetirement(session, new Error(msg.error || 'COM host failed to start'), true);
      return;
    }
    if (!validComHostPid(msg.psPid) ||
        (validComHostPid(session.proc.pid) && msg.psPid !== session.proc.pid) ||
        (msg.powerpointPid !== null && msg.powerpointPid !== undefined &&
         (!validComHostPid(msg.powerpointPid) || msg.powerpointPid === msg.psPid))) {
      failComHostProtocol(session, new Error('COM host reported invalid process identity'));
      return;
    }
    session.readyMessageReceived = true;
    session.psPid = msg.psPid;
    session.powerpointPid = msg.powerpointPid || null;
    // Persist the tentative secondary PID before the asynchronous CIM lookup.
    // If this server is hard-killed during that lookup, the next boot can
    // validate its executable and creation window instead of losing the only
    // record of a PowerPoint process this generation may own.
    if (!saveComHostMarker(session)) {
      beginComHostRetirement(session, new Error('Could not persist COM host process identity'), true);
      return;
    }
    session.readyIdentityPromise = (async () => {
      if (validComHostPid(session.powerpointPid)) {
        const identity = await queryWindowsProcess(session.powerpointPid);
        if (!identity.exists || !/^powerpnt\.exe$/i.test(identity.name) ||
            Math.abs(identity.startedAt - session.startedAt) > 2 * 60 * 1000) {
          throw new Error('COM host reported a PowerPoint PID with the wrong process identity');
        }
        session.powerpointStartedAt = identity.startedAt;
      }
    })();
    session.readyIdentityPromise.then(() => {
      if (!session.active || session.retiring) return;
      if (!saveComHostMarker(session)) {
        beginComHostRetirement(session, new Error('Could not persist COM host process identity'), true);
        return;
      }
      settleComHostReady(session, null);
    }, (error) => {
      if (session.active && !session.retiring) {
        beginComHostRetirement(session, error, true);
      }
    });
    return;
  }
  if (!session.wasReady || msg.id <= 0 || typeof msg.ok !== 'boolean') {
    failComHostProtocol(session, new Error('COM host emitted an out-of-sequence job message'));
    return;
  }
  const pending = session.pending.get(msg.id);
  if (!pending) {
    failComHostProtocol(session, new Error('COM host emitted a reply for an unknown job'));
    return;
  }
  session.pending.delete(msg.id);
  msg.ok ? pending.resolve(msg) : pending.reject(new Error(msg.error || 'job failed'));
}

function launchComHostSession() {
  const token = crypto.randomBytes(16).toString('hex');
  let proc;
  try {
    proc = spawn('powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', COM_HOST_PS1,
       '--suite-com-host-token', token],
      { cwd: HERE, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (error) {
    return Promise.reject(error);
  }

  const session = {
    generation: ++comHostGeneration,
    token,
    proc,
    psPid: validComHostPid(proc.pid) ? proc.pid : null,
    powerpointPid: null,
    powerpointStartedAt: null,
    startedAt: Date.now(),
    stdout: '',
    stderr: '',
    pending: new Map(),
    active: true,
    retiring: false,
    retireReason: null,
    readySettled: false,
    readyMessageReceived: false,
    wasReady: false,
    killIssued: false,
    exitHandling: false,
    readyTimer: null,
    killSettleTimer: null,
    resolveReady: null,
    rejectReady: null,
    resolveRetired: null,
    readyIdentityPromise: null,
  };
  session.readyPromise = new Promise((resolve, reject) => {
    session.resolveReady = resolve;
    session.rejectReady = reject;
  });
  session.retiredPromise = new Promise((resolve) => { session.resolveRetired = resolve; });
  comHostSession = session;

  const streamError = (label) => (error) => {
    failComHostProtocol(session, new Error(`COM host ${label} error: ${error && error.message ? error.message : error}`));
  };

  if (!proc.stdout || !proc.stderr || !proc.stdin) {
    beginComHostRetirement(session, new Error('COM host did not provide all stdio streams'), true);
  } else {
    proc.stdout.on('data', (chunk) => {
      if (!session.active || session.retiring) return;
      session.stdout += chunk.toString();
      let newline;
      while ((newline = session.stdout.indexOf('\n')) >= 0) {
        const line = session.stdout.slice(0, newline);
        session.stdout = session.stdout.slice(newline + 1);
        handleComHostLine(session, line);
        if (!session.active || session.retiring) return;
      }
      if (session.stdout.length > COM_HOST_STDOUT_FRAME_LIMIT) {
        failComHostProtocol(session, new Error('COM host stdout frame exceeded limit'));
      }
    });
    proc.stderr.on('data', (chunk) => {
      if (!session.active) return;
      session.stderr = boundedComHostText(session.stderr, chunk, COM_HOST_STDERR_LIMIT);
    });
    proc.stdout.on('error', streamError('stdout'));
    proc.stderr.on('error', streamError('stderr'));
    proc.stdin.on('error', streamError('stdin'));
  }

  proc.on('error', streamError('process'));
  const exited = () => {
    if (!session.active || session.exitHandling) return;
    session.exitHandling = true;
    const wasReady = session.wasReady;
    const unexpected = !session.retiring && !comHostShuttingDown;
    const error = session.retireReason ||
      new Error(`COM host exited${wasReady ? '' : ' before ready'}: ${session.stderr.slice(-300)}`);
    session.retiring = true;
    session.retireReason = error;
    rejectComHostPending(session, error);
    clearTimeout(session.killSettleTimer);
    session.killSettleTimer = setTimeout(
      () => finalizeComHostSession(session, error, false),
      COM_HOST_KILL_SETTLE_MS
    );
    (async () => {
      if (session.readyIdentityPromise) {
        try { await session.readyIdentityPromise; } catch (_) {}
      }
      const powerpointClean = await terminateRecordedPowerPoint(
        session.powerpointPid, session.powerpointStartedAt
      );
      if (!session.active) return; // stale async completion cannot touch N+1
      finalizeComHostSession(session, error, powerpointClean);
      if (unexpected && wasReady && powerpointClean) {
        console.error('COM host exited unexpectedly, will restart lazily on next thumbs job');
      }
    })().catch(() => {
      if (session.active) finalizeComHostSession(session, error, false);
    });
  };
  proc.once('exit', exited);
  proc.once('close', exited);

  // Record the PowerShell PID immediately, not only after COM is ready. A
  // startup hang followed by a hard server kill is otherwise unsweepable.
  if (validComHostPid(proc.pid) && !saveComHostMarker(session)) {
    beginComHostRetirement(session, new Error('Could not persist COM host process identity'), true);
  }
  session.readyTimer = setTimeout(() => {
    if (!session.active || session.readySettled) return;
    const detail = session.stderr.slice(-300);
    beginComHostRetirement(session,
      new Error(`COM host ready timeout (${COM_HOST_READY_TIMEOUT_MS}ms): ${detail}`), true);
  }, COM_HOST_READY_TIMEOUT_MS);
  return session.readyPromise;
}

function startComHost() {
  if (!IS_WIN) return Promise.reject(new Error('COM host needs Windows'));
  if (comHostShuttingDown) return Promise.reject(new Error('COM host is shutting down'));
  if (comHostBlockedError) return Promise.reject(comHostBlockedError);
  if (comHostSession) {
    if (comHostSession.retiring) {
      return comHostSession.retiredPromise.then(() => startComHost());
    }
    return comHostSession.readyPromise;
  }
  if (comHostStartPromise) return comHostStartPromise;

  if (!comHostSweepPromise) comHostSweepPromise = Promise.resolve().then(sweepStaleComHost);
  const starting = comHostSweepPromise.then(() => {
    if (comHostShuttingDown) throw new Error('COM host is shutting down');
    if (comHostBlockedError) throw comHostBlockedError;
    return comHostSession ? startComHost() : launchComHostSession();
  });
  comHostStartPromise = starting;
  starting.then(
    () => { if (comHostStartPromise === starting) comHostStartPromise = null; },
    () => { if (comHostStartPromise === starting) comHostStartPromise = null; }
  );
  return starting;
}

async function comHostJob(src, outDir, width, slideNumbers) {
  const session = await startComHost();
  if (!session.active || session.retiring || comHostSession !== session ||
      !session.proc.stdin || !session.proc.stdin.writable) {
    const error = new Error('COM host not writable');
    await beginComHostRetirement(session, error, true);
    throw error;
  }
  return new Promise((resolve, reject) => {
    const id = comHostNextId++;
    const pending = {
      settled: false,
      timer: null,
      resolve: (msg) => {
        if (pending.settled) return;
        pending.settled = true;
        clearTimeout(pending.timer);
        resolve(msg);
      },
      reject: (error) => {
        if (pending.settled) return;
        pending.settled = true;
        clearTimeout(pending.timer);
        reject(error);
      },
    };
    pending.timer = setTimeout(() => {
      if (pending.settled) return;
      session.pending.delete(id);
      const error = new Error(`COM host job timeout (${COM_HOST_JOB_TIMEOUT_MS}ms)`);
      // A timed-out PowerPoint call can leave the single-threaded host
      // permanently wedged. Retire it before any later job is allowed to retry.
      beginComHostRetirement(session, error, true).then(() => pending.reject(error));
    }, COM_HOST_JOB_TIMEOUT_MS);
    session.pending.set(id, pending);
    const payload = JSON.stringify({
      id, cmd: 'thumbs', src, outDir, width, slides: slideNumbers,
    }) + '\n';
    try {
      session.proc.stdin.write(payload, (error) => {
        if (!error || pending.settled) return;
        session.pending.delete(id);
        beginComHostRetirement(
          session, new Error(`COM host stdin write failed: ${error.message}`), true
        ).then(() => pending.reject(error));
      });
    } catch (error) {
      session.pending.delete(id);
      beginComHostRetirement(
        session, new Error(`COM host stdin write failed: ${error.message}`), true
      ).then(() => pending.reject(error));
    }
  });
}

async function stopComHost() {
  comHostShuttingDown = true;
  if (!comHostSession && comHostStartPromise) {
    try { await comHostStartPromise; } catch (_) {}
  }
  const session = comHostSession;
  if (!session) return;
  const shutdownError = new Error('COM host is shutting down');
  session.retiring = true;
  session.retireReason = shutdownError;
  rejectComHostPending(session, shutdownError);
  try {
    if (!session.proc.stdin || !session.proc.stdin.writable) throw new Error('stdin is not writable');
    session.proc.stdin.write('quit\n', (error) => {
      if (error) beginComHostRetirement(session, shutdownError, true);
    });
  } catch (_) {
    beginComHostRetirement(session, shutdownError, true);
  }
  await Promise.race([
    session.retiredPromise,
    new Promise((resolve) => setTimeout(resolve, COM_HOST_STOP_TIMEOUT_MS)),
  ]);
  if (session.active) {
    // Graceful quit did not land in time: target this generation's exact
    // process tree and uniquely identified PowerPoint PID.
    beginComHostRetirement(session, shutdownError, true);
    await session.retiredPromise;
  }
}

// ------------------------------------------------------------------- render
let renderTimer = null;
let shuttingDown = false;
let rendering = false;
let renderAgain = false;
// dirtySlides / dirtyAll track which slides actually changed since the last
// successful thumbnail export, so the COM host can export just those instead
// of the whole deck. Structural ops (slide added/removed/reordered/relaid
// out) and undo/redo can shift what slide N even means, so those mark
// dirtyAll instead of trying to diff two arbitrary snapshots.
let dirtySlides = new Set();
let dirtyAll = true; // first render after boot always exports everything
// add-slide DOES carry affected.slideId (the new slide), but inserting or
// removing a slide shifts the PNG numbering of every slide after it, so
// these ops must force dirtyAll regardless of what `affected` says.
const STRUCTURAL_OPS = new Set(['add-slide', 'delete-slide', 'move-slide', 'set-layout', 'set-theme', 'set-presentation-title']);
function markDirty(opType, affected) {
  if (STRUCTURAL_OPS.has(opType)) { dirtyAll = true; return; }
  if (affected && affected.slideId) { dirtySlides.add(affected.slideId); return; }
  dirtyAll = true; // unrecognized op or unknown affected shape: stay conservative
}
// firstDirtyAt anchors a hard ceiling on top of the trailing debounce below:
// under a steady stream of edits (multiple agents editing faster than the
// 600ms debounce settles) the debounce alone would reset on every edit and
// never fire, freezing the view indefinitely. RENDER_MAX_WAIT_MS guarantees
// a render happens at least that often even while edits keep arriving.
let firstDirtyAt = null;
const RENDER_DEBOUNCE_MS = 600;
const RENDER_MAX_WAIT_MS = 2000;

function scheduleRender() {
  if (state.paused || shuttingDown) return;
  if (renderTimer) clearTimeout(renderTimer);
  const now = Date.now();
  if (firstDirtyAt === null) firstDirtyAt = now;
  const delay = Math.max(0, Math.min(RENDER_DEBOUNCE_MS, RENDER_MAX_WAIT_MS - (now - firstDirtyAt)));
  renderTimer = setTimeout(runRender, delay);
}

async function runRender() {
  renderTimer = null;
  if (state.paused || shuttingDown) return;
  if (rendering) { renderAgain = true; return; }
  rendering = true;
  firstDirtyAt = null;
  const capturedRev = model.rev; // the rev THIS render's pixels will represent, even if edits keep arriving during it
  const stagedPptx = path.join(
    ROOT,
    `.presentation-${process.pid}-${capturedRev}-${crypto.randomBytes(4).toString('hex')}.pptx`
  );
  // Pipe the model through stdin ('-') so python never opens model.json.
  // PYTHONUTF8=1 guarantees the pipe is decoded as UTF-8 on Windows.
  const snapshotJson = JSON.stringify(model);
  const rendered = await runCapturedProcess(
    PY, [RENDER_PY, '-', stagedPptx],
    { cwd: HERE, env: Object.assign({}, process.env, { PYTHONUTF8: '1' }), windowsHide: true },
    snapshotJson, 60000
  );
  let ok = rendered.ok;
  let error = rendered.error || '';
  let published = false;
  let superseded = false;
  if (ok) {
    if (state.paused) {
      ok = false;
      error = 'pause completed before this render could be published';
    } else if (capturedRev !== model.rev) {

      superseded = true;
      renderAgain = true;
    } else {
      try {
        await queuePauseTransition(async () => {
          // Rendering happens entirely in a private file, so there is no reason
          // to weaken the pause lock while Python is working. Publication uses
          // the exact same FIFO as pause/resume: this prevents a late re-lock
          // from racing a queued resume, and prevents a pause from interleaving
          // between the final gate check and the synchronous artifact commits.
          if (state.paused) throw new Error('pause completed before this render could be published');
          if (capturedRev !== model.rev) {
            superseded = true;
            renderAgain = true;
            return;
          }
          const deckExisted = fs.existsSync(PPTX_PATH);
          const unlocked = await setReadOnly(PPTX_PATH, false);
          if (deckExisted && !unlocked) {
            throw new Error('could not unlock presentation.pptx for atomic publication');
          }
          if (state.paused) throw new Error('pause completed before this render could be published');
          if (capturedRev !== model.rev) {
            superseded = true;
            renderAgain = true;
            return;
          }
          commitStagedPptx(stagedPptx);
          if (!persistRenderMarker(capturedRev)) throw new Error('could not save the render revision marker');
          published = true;
        });
      } catch (commitError) {
        ok = false;
        error = String(commitError && (commitError.message || commitError));
      }
    }
  }
  try { fs.unlinkSync(stagedPptx); } catch (_) {}
  try { fs.unlinkSync(stagedPptx + '.slides-validation.json'); } catch (_) {}
  rendering = false;
  if (superseded) {
    broadcast({ type: 'render-superseded', rev: capturedRev, currentRev: model.rev, ts: Date.now() });
  } else {
    if (!ok) console.error('render failed:', error.slice(0, 600));
    broadcast({ type: 'render', ok, rev: capturedRev, error: ok ? null : error.slice(0, 600), ts: Date.now() });
  }
  if (published) {
    // Snapshot into THUMBS_SRC before exporting: the COM host may still be
    // mid-export from a previous render and PowerPoint must see stable bytes.
    await refreshThumbsFromDeck(capturedRev, 'thumbs snapshot copy failed, skipping this thumbs pass:');
  }
  if (renderAgain) {
    renderAgain = false;
    runRender(); // direct: don't re-open a starvable debounce window
  }
}

// ---- true slide thumbnails via PowerPoint COM (best-effort; dashboard falls
// ---- back to the positioned CSS view when thumbnails are unavailable)
let thumbsVer = 0;
let thumbsRunning = false;
let thumbsAgain = false;
let thumbsAgainRev = null;
// PDF export (below) spawns its OWN separate powershell+PowerPoint against

let pdfRunning = false;

function slideIdToNumber(id) {
  const i = model.slides.findIndex((s) => s.id === id);
  return i < 0 ? null : i + 1; // PNG numbering follows model.slides array order, 1-indexed
}

// Legacy path: spawn a fresh powershell + fresh COM instance, full deck only
// (ignores dirty-slide targeting). This is the pre-COM-host behavior, kept
// as a fallback so a COM host problem makes thumbnails slow again instead of
// broken outright.
function legacyExportThumbs() {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', THUMBS_PS1,
      '-Path', THUMBS_SRC, '-OutDir', THUMBS_DIR, '-Width', '1100', '-KeepAlive'
    ], { cwd: HERE, windowsHide: true });
    let err = '';
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', (e) => { err += String(e); });
    // Use an explicit timeout: spawn() has no built-in timeout, and a
    // hung child here leaves thumbsRunning stuck true forever (runThumbs's
    // own re-entrancy guard), permanently blocking every future thumbs
    // export, not just this one.
    const killTimer = setTimeout(() => { try { child.kill(); } catch (_) {} }, 60000);
    child.on('close', (code) => {
      clearTimeout(killTimer);
      code === 0 ? resolve() : reject(new Error(err.slice(0, 400) || `exit ${code}`));
    });
  });
}

function cleanupOrphanedThumbs() {
  let entries;
  try { entries = fs.readdirSync(THUMBS_DIR); } catch (_) { return; }
  const maxSlide = model.slides.length;
  for (const name of entries) {
    const m = /^slide-(\d+)\.png$/.exec(name);
    if (m && Number(m[1]) > maxSlide) {
      try { fs.unlinkSync(path.join(THUMBS_DIR, name)); } catch (_) {}
    }
  }
}

function runThumbs(capturedRev) {
  if (shuttingDown) return;
  if (IS_WIN !== true && !process.env.SLIDES_WORKSPACE) return;
  if (thumbsRunning || pdfRunning) { thumbsAgain = true; thumbsAgainRev = capturedRev; return; }
  thumbsRunning = true;

  const exportAll = dirtyAll || dirtySlides.size === 0;
  const attemptedIds = exportAll ? null : new Set(dirtySlides);
  const slideNumbers = exportAll ? [] : Array.from(attemptedIds).map(slideIdToNumber).filter((n) => n !== null);

  const finish = (ok, error) => {
    thumbsRunning = false;
    if (ok) {
      thumbsVer++;
      cleanupOrphanedThumbs();
      if (exportAll) dirtyAll = false; else attemptedIds.forEach((id) => dirtySlides.delete(id));
      broadcast({ type: 'thumbs', ok: true, ver: thumbsVer, rev: capturedRev, slides: exportAll ? null : Array.from(attemptedIds), ts: Date.now() });
    } else if (shuttingDown) {
      console.error('thumbnail render cancelled at shutdown');
    } else {
      console.error('thumbnail export failed:', error);
      broadcast({ type: 'thumbs', ok: false, rev: capturedRev, error: String(error).slice(0, 400), ts: Date.now() });
    }
    if (thumbsAgain) { thumbsAgain = false; const r = thumbsAgainRev; thumbsAgainRev = null; runThumbs(r); }
  };

  if (process.env.SLIDES_WORKSPACE) {
    require('./lib/renderer').convert(THUMBS_SRC, THUMBS_DIR, 'png', {cacheDirectory:path.join(DATA,'static-images')})
      .then(r => { console.error(`Thumbnails renderer: ${r.renderer}`); finish(true); })
      .catch(e => finish(false, e.message));
    return;
  }
  comHostJob(THUMBS_SRC, THUMBS_DIR, 1100, slideNumbers)
    .then(() => finish(true))
    .catch((hostErr) => {
      console.error('COM host thumbs failed, falling back to a fresh PowerPoint instance for this pass:', hostErr && hostErr.message);
      legacyExportThumbs()
        .then(() => finish(true))
        .catch((legacyErr) => finish(false, (legacyErr && legacyErr.message) || legacyErr));
    });
}

// ---- on-demand PDF export via the same PowerPoint COM approach as thumbs.

let pdfVer = 0;
let pdfExportTail = Promise.resolve();
const pdfExportsByRev = new Map();

const capturedChildren = new Set();
function runCapturedProcess(command, args, options, stdinText, timeoutMs) {
  return require('./lib/python-jobs').run(() => captureProcess(command, args, options, stdinText, timeoutMs))
    .catch(error => ({ok:false,error:error.message}));
}

function captureProcess(command, args, options, stdinText, timeoutMs) {
  if (shuttingDown) return Promise.resolve({ok:false,error:'Suite is shutting down'});
  return new Promise((resolve) => {
    const child = spawn(command, args, options);
    capturedChildren.add(child);
    let stderr = '';
    let settled = false;
    let timer = null;
    let terminationTimer = null;
    let timedOut = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (terminationTimer) clearTimeout(terminationTimer);
      resolve(result);
    };
    // Always drain both streams. An unread stdout pipe can fill and deadlock
    // even when the parent only cares about the exit code.
    if (child.stdout) child.stdout.on('data', () => {});
    if (child.stderr) child.stderr.on('data', (chunk) => {
      if (stderr.length < 64 * 1024) stderr += chunk.toString().slice(0, 64 * 1024 - stderr.length);
    });
    child.on('error', (error) => {console.error('Helper launch failed:',error);finish({ok:false,error:'Render helper could not start; see the local suite log'});});
    child.on('close', (code, signal) => {
      capturedChildren.delete(child);
      const suffix = signal ? ` (signal ${signal})` : '';
      if (code !== 0 || timedOut) console.error('Render helper failed:',stderr);
      finish({
        ok: !timedOut && code === 0,
        error: timedOut ? 'Render helper timed out' : (code === 0 ? '' : `Render helper failed (exit ${code}${suffix}); see the local suite log`)
      });
    });
    if (child.stdin) {
      child.stdin.on('error', () => {});
      child.stdin.end(stdinText === undefined ? undefined : stdinText);
    }
    timer = setTimeout(() => {
      timedOut = true;
      stderr = (stderr + `\nprocess timed out after ${timeoutMs}ms`).slice(0, 64 * 1024);
      if (process.platform === 'win32' && child.pid) {
        // Kill the exact process tree, never a blanket python/PowerPoint kill.
        // A COM-created PowerPoint process may be a child of PowerShell.
        execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
      } else {
        try { child.kill('SIGKILL'); } catch (_) {}
      }
      // close is the normal completion signal. Keep a bounded final escape
      // hatch for a broken OS process table; PDF jobs use unique output paths,
      // so even this worst case can never overwrite the canonical PDF later.
      terminationTimer = setTimeout(
        () => finish({ ok: false, error: 'Render helper did not confirm termination' }),
        10000
      );
    }, timeoutMs);
  });
}

async function exportPdfSnapshot(snapshotJson, capturedRev) {
  const token = `${process.pid}-${capturedRev}-${crypto.randomBytes(5).toString('hex')}`;
  const snapshotPptx = path.join(DATA, `.pdf-source-${token}.pptx`);
  const snapshotPdf = path.join(DATA, `.pdf-output-${token}.pdf`);
  let result = { ok: false, error: 'PDF export failed', rev: capturedRev };
  try {
    pdfRunning = true;
    const deadline = Date.now() + 15000;
    while (thumbsRunning && Date.now() < deadline) await new Promise((r) => setTimeout(r, 150));

    const rendered = await runCapturedProcess(
      PY, [RENDER_PY, '-', snapshotPptx],
      { cwd: HERE, env: Object.assign({}, process.env, { PYTHONUTF8: '1' }), windowsHide: true },
      snapshotJson, 60000
    );
    if (!rendered.ok) throw new Error(`snapshot render failed: ${rendered.error}`);
    const pptxHead = Buffer.alloc(2);
    const pptxFd = fs.openSync(snapshotPptx, 'r');
    try { fs.readSync(pptxFd, pptxHead, 0, 2, 0); } finally { fs.closeSync(pptxFd); }
    if (pptxHead.toString('ascii') !== 'PK') throw new Error('snapshot renderer did not produce a valid PPTX container');

    // The PowerShell helper stages and atomically replaces its destination.
    const exported = process.env.SLIDES_WORKSPACE ? await require('./lib/renderer').convert(snapshotPptx, snapshotPdf, 'pdf', {cacheDirectory:path.join(DATA,'static-images')}).then(r => ({ok:true, renderer:r.renderer})) : await runCapturedProcess(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PDF_PS1,
       '-Path', snapshotPptx, '-OutPath', snapshotPdf],
      { cwd: HERE, windowsHide: true },
      undefined, 60000
    );
    if (!exported.ok) throw new Error(exported.error || 'PowerPoint PDF export failed');
    const pdfHead = Buffer.alloc(5);
    const pdfFd = fs.openSync(snapshotPdf, 'r');
    try { fs.readSync(pdfFd, pdfHead, 0, 5, 0); } finally { fs.closeSync(pdfFd); }
    if (pdfHead.toString('ascii') !== '%PDF-') throw new Error('PowerPoint did not produce a valid PDF');
    let publishError = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      try { fs.renameSync(snapshotPdf, PDF_PATH); publishError = null; break; }
      catch (error) { publishError = error; sleepMs(20 * (attempt + 1)); }
    }
    if (publishError) throw publishError;

    const next = copyState();
    next.pdfRev = capturedRev;
    if (!persistState(next)) throw new Error('PDF was written but its revision could not be saved');
    state = next;
    pdfVer++;
    result = { ok: true, error: null, rev: capturedRev, renderer: exported.renderer || 'powerpoint' };
  } catch (error) {
    const message = String(error && (error.message || error)).slice(0, 400);
    console.error('pdf export failed:', message);
    result = { ok: false, error: message, rev: capturedRev };
  } finally {
    try { fs.unlinkSync(snapshotPptx); } catch (_) {}
    try { fs.unlinkSync(snapshotPptx + '.slides-validation.json'); } catch (_) {}
    try { fs.unlinkSync(snapshotPdf); } catch (_) {}
    pdfRunning = false;
    broadcast({
      type: 'pdf', ok: result.ok, ver: pdfVer, rev: state.pdfRev,
      error: result.ok ? null : result.error, ts: Date.now()
    });
    if (thumbsAgain) {
      thumbsAgain = false;
      const rev = thumbsAgainRev;
      thumbsAgainRev = null;
      runThumbs(rev);
    }
  }
  return result;
}

function runPdfExport() {
  if (!IS_WIN && !process.env.SLIDES_WORKSPACE) return Promise.resolve({ ok: false, error: 'PDF export needs Windows + PowerPoint (PowerShell/COM)' });
  const capturedRev = model.rev;
  const existing = pdfExportsByRev.get(capturedRev);
  if (existing) return existing;
  const snapshotJson = JSON.stringify(model);
  const job = pdfExportTail.then(() => exportPdfSnapshot(snapshotJson, capturedRev));
  pdfExportTail = job.catch(() => {});
  pdfExportsByRev.set(capturedRev, job);
  job.finally(() => {
    if (pdfExportsByRev.get(capturedRev) === job) pdfExportsByRev.delete(capturedRev);
  });
  return job;
}

// -------------------------------------------------------------- edit engine
function findSlide(id) { return model.slides.find((s) => s.id === id); }
function findElement(slide, id) { return slide && slide.elements.find((e) => e.id === id); }

const {DASH_RE,LINT_MIN_SIZE,lintModel,estimateTiming}=require('./lib/quality');

function lintFonts(m) {
  return new Promise((resolve) => {
    const failure = (detail) => [{
      type: 'font-lint-error', slideId: null, elementId: null,
      field: 'font', detail: String(detail).slice(0, 400)
    }];
    if (!fs.existsSync(PPTX_PATH)) return resolve(failure('presentation.pptx is missing; font lint did not run'));
    // timeout: matches backfillDecorSids' fix. Without it a hung python
    // process here doesn't just fail this call (already handled below, per
    // this function's own "never throws" comment), it hangs the whole
    // GET /api/lint request forever with no response, the callback that
    // would resolve this promise simply never fires.
    execFile(PY, [LINT_FONTS_PY, PPTX_PATH], { cwd: HERE, maxBuffer: 20 * 1024 * 1024, timeout: 30000 }, (err, stdout) => {
      if (err) {
        console.error('font lint failed:', err.message);
        return resolve(failure('Font lint failed; see the local suite log'));
      }
      let data;
      try { data = JSON.parse(stdout); }
      catch (e) {
        console.error('font lint: bad JSON from helper');
        return resolve(failure('font lint returned malformed output'));
      }
      if (!data || !Array.isArray(data.runs)) return resolve(failure('font lint returned an invalid result'));
      const runs = Array.isArray(data.runs) ? data.runs : [];
      const coverageIssues = [];
      if (data.coverage && data.coverage.complete === false) {
        const unresolved = Number(data.coverage.unresolved) || 0;
        const total = Number(data.coverage.total) || (runs.length + unresolved);
        const sample = Array.isArray(data.coverage.unresolvedRuns) && data.coverage.unresolvedRuns[0];
        coverageIssues.push({
          type: 'font-lint-coverage',
          slideId: sample && m.slides[sample.slide] ? m.slides[sample.slide].id : null,
          elementId: null,
          field: 'font',
          detail: `${unresolved}/${total} text runs inherit a font the checker could not resolve; font lint is incomplete`
        });
      }
      if (!runs.length) return resolve(coverageIssues);

      const counts = new Map();
      for (const r of runs) counts.set(r.font, (counts.get(r.font) || 0) + 1);
      const majority = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a))[0];
      const issues = [];
      for (const r of runs) {
        if (r.font === majority) continue;
        const slide = m.slides[r.slide];
        issues.push({
          type: 'font-family', slideId: slide ? slide.id : `pptx-slide-${r.slide + 1}`, elementId: null,
          field: 'font', detail: `uses "${r.font}", ${counts.get(majority)}/${runs.length} other runs use "${majority}"`,
          text: r.text,
        });
      }
      resolve(coverageIssues.concat(issues));
    });
  });
}

async function fullLint(m) {
  let artifact;
  try { const stat = fs.statSync(PPTX_PATH); artifact = `${stat.mtimeMs}:${stat.size}`; }
  catch { artifact = 'missing'; }
  const key = `${m.rev}:${artifact}`;
  if (fullLint.cache?.key === key) return fullLint.cache.value;
  if (fullLint.pending) { await fullLint.pending; return fullLint(m); }
  fullLint.pending = (async () => {
    const base = lintModel(m);
    const fontIssues = await require('./lib/python-jobs').run(() => lintFonts(m));
    const issues = base.issues.concat(fontIssues);
    const value = {rev:m.rev,ok:issues.length === 0,count:issues.length,issues};
    fullLint.cache = {key,value};
    return value;
  })();
  try { return await fullLint.pending; }
  finally { fullLint.pending = null; }
}

// Scoped version of the same checks for exactly the element/notes an op just
// touched, so /api/edit can hand back instant feedback on the edit that just
// happened instead of waiting for the next full `ppt lint` pass. Returns short
// detail strings (not full issue objects) meant to fold into the existing
// advisory `warning` field alongside the lock-collision warning.
function lintAffected(affected) {
  const msgs = [];
  if (!affected || !affected.slideId) return msgs;
  const slide = findSlide(affected.slideId);
  if (!slide) return msgs;
  if (affected.elementId) {
    const el = findElement(slide, affected.elementId);
    if (el) {
      const texts = Array.isArray(el.items) ? el.items : [el.text];
      for (const t of texts) {
        const hit = String(t == null ? '' : t).match(DASH_RE);
        if (hit) { msgs.push(`contains "${hit[0]}" (typographic dash)`); break; }
      }
      const st = el.style || {};
      if (typeof st.size === 'number' && st.size < LINT_MIN_SIZE) {
        msgs.push(`${st.size}pt is under the ${LINT_MIN_SIZE}pt floor`);
      }
    }
  }
  if (affected.notes) {
    const s = String(slide.notes || '');
    if (DASH_RE.test(s)) msgs.push('notes contain an em/en dash');
  }
  return msgs;
}


function defaultElements(layout) {
  switch (layout) {
    case 'title':    return [{ id: shortId('e'), type: 'title', text: '' },
                             { id: shortId('e'), type: 'subtitle', text: '' }];
    case 'section':  return [{ id: shortId('e'), type: 'title', text: '' }];
    case 'titleonly':return [{ id: shortId('e'), type: 'title', text: '' }];
    case 'blank':    return [];
    case 'content':
    case 'bullets':
    default:         return [{ id: shortId('e'), type: 'title', text: '' },
                             { id: shortId('e'), type: 'bullets', items: [] }];
  }
}

const {NATIVE_LAYOUTS,ELEMENT_TYPES}=require('./lib/deck-choices');

function generatedBoxError(box) {
  if (!isRecord(box)) return 'box must be an object';
  for (const key of ['x', 'y', 'w', 'h']) {
    const value = box[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return `${key} must be a finite number`;
    }
    if (value < 0 || value > 1) return `${key} must be between 0 and 1`;
    if ((key === 'w' || key === 'h') && value <= 0) return `${key} must be greater than 0`;
  }
  if (box.x + box.w > 1 || box.y + box.h > 1) {
    return 'the generated object must fit within the slide';
  }
  return null;
}

function uneditableElementReason(slide, element) {
  if (!element) return 'no such element';
  if (element.readonly) return 'that element is read-only';
  if ((model.mode || 'native') === 'overlay' && Number.isInteger(slide && slide.src) && !element.ref) {
    return 'that imported-slide element has no backing PowerPoint shape';
  }
  return null;
}

// Returns { ok, error?, affected }. Mutates `model` on success.
function applyOp(op) {
  if (!op || typeof op.type !== 'string') return { ok: false, error: 'missing op.type' };
  const t = op.type;

  if (t === 'set-presentation-title') {
    if (typeof op.text !== 'string') return { ok: false, error: 'text must be a string' };
    model.title = op.text;
    return { ok: true, affected: { scope: 'presentation' } };
  }

  if (t === 'add-slide') {

    if (op.layout !== undefined && typeof op.layout !== 'string') return { ok: false, error: 'layout must be a string' };
    const layout = op.layout || 'content';
    if (!NATIVE_LAYOUTS.has(layout)) return { ok: false, error: `unknown layout "${layout}"` };
    if (op.title !== undefined && typeof op.title !== 'string') return { ok: false, error: 'title must be a string' };
    const slide = { id: shortId('s'), layout, notes: '', elements: defaultElements(layout) };
    if (typeof op.title === 'string' && slide.elements[0] && slide.elements[0].type === 'title') {
      slide.elements[0].text = op.title;
    }

    let idx = model.slides.length;
    if (op.index !== undefined) {
      if (!Number.isInteger(op.index)) return { ok: false, error: 'index must be an integer' };
      idx = Math.max(0, Math.min(op.index, model.slides.length));
    } else if (op.after !== undefined) {
      const a = model.slides.findIndex((s) => s.id === op.after);
      if (a < 0) return { ok: false, error: 'no such slide: ' + op.after };
      idx = a + 1;
    }
    model.slides.splice(idx, 0, slide);
    return { ok: true, affected: { slideId: slide.id }, newSlide: slide, index: idx };
  }

  if (t === 'delete-slide') {
    const i = model.slides.findIndex((s) => s.id === op.slideId);
    if (i < 0) return { ok: false, error: 'no such slide' };

    if (model.slides.length <= 1) return { ok: false, error: 'cannot delete the last remaining slide' };
    model.slides.splice(i, 1);

    const lockReleased = locks.has(op.slideId);
    return { ok: true, affected: { removedSlideId: op.slideId }, lockReleased };
  }

  if (t === 'move-slide') {
    const i = model.slides.findIndex((s) => s.id === op.slideId);
    if (i < 0) return { ok: false, error: 'no such slide' };
    if (!Number.isInteger(op.index)) return { ok: false, error: 'index must be an integer' };
    let j = Math.max(0, Math.min(op.index, model.slides.length - 1));
    const [s] = model.slides.splice(i, 1);
    model.slides.splice(j, 0, s);
    return { ok: true, affected: { slideId: op.slideId } };
  }

  if (t === 'set-layout') {
    const s = findSlide(op.slideId);
    if (!s) return { ok: false, error: 'no such slide' };

    if (typeof op.layout !== 'string') return { ok: false, error: 'layout must be a string' };
    if (!NATIVE_LAYOUTS.has(op.layout)) return { ok: false, error: `unknown layout "${op.layout}"` };
    if ((model.mode || 'native') === 'overlay' && Number.isInteger(s.src)) {
      return { ok: false, error: 'cannot change the layout of an imported slide; its layout comes from base.pptx' };
    }
    s.layout = op.layout;
    return { ok: true, affected: { slideId: s.id } };
  }

  if (t === 'set-transition') {
    const s = findSlide(op.slideId);
    if (!s) return { ok: false, error: 'no such slide' };
    if (!['fade', 'none'].includes(op.effect)) {
      return { ok: false, error: 'effect must be fade or none' };
    }
    if (op.effect === 'none') {
      if (op.duration !== undefined) {
        return { ok: false, error: 'duration is only valid for fade' };
      }
      s.transition = { effect: 'none' };
      return { ok: true, affected: { slideId: s.id } };
    }
    const duration = op.duration === undefined ? 0.35 : op.duration;
    if (typeof duration !== 'number' || !Number.isFinite(duration) ||
        duration < 0.1 || duration > 10) {
      return { ok: false, error: 'duration must be a finite number from 0.1 to 10 seconds' };
    }
    s.transition = { effect: 'fade', duration };
    return { ok: true, affected: { slideId: s.id } };
  }

  if (t === 'set-notes') {
    const s = findSlide(op.slideId);
    if (!s) return { ok: false, error: 'no such slide' };
    if (typeof op.text !== 'string') return { ok: false, error: 'text must be a string' };
    s.notes = op.text;
    return { ok: true, affected: { slideId: s.id, notes: true } };
  }

  if (t === 'add-element') {
    const s = findSlide(op.slideId);
    if (!s) return { ok: false, error: 'no such slide' };
    if ((model.mode || 'native') === 'overlay' && Number.isInteger(s.src)) {
      return { ok: false, error: 'cannot add an element to an imported slide because it has no backing PowerPoint shape; add a new slide or edit an existing element' };
    }
    const elementType = op.elementType === undefined ? 'body' : op.elementType;
    if (typeof elementType !== 'string' || !ELEMENT_TYPES.has(elementType)) {
      return { ok: false, error: `elementType must be one of: ${Array.from(ELEMENT_TYPES).join(', ')}` };
    }
    if (op.index !== undefined && !Number.isInteger(op.index)) return { ok: false, error: 'index must be an integer' };
    const el = { id: shortId('e'), type: elementType };
    if (op.items !== undefined) {
      if (!Array.isArray(op.items) || !op.items.every((item) => typeof item === 'string')) {
        return { ok: false, error: 'items must be an array of strings' };
      }
      el.items = op.items.slice();
    } else {
      if (op.text !== undefined && typeof op.text !== 'string') return { ok: false, error: 'text must be a string' };
      el.text = op.text || '';
    }
    if (op.index !== undefined) s.elements.splice(Math.max(0, Math.min(op.index, s.elements.length)), 0, el);
    else s.elements.push(el);
    return { ok: true, affected: { slideId: s.id, elementId: el.id } };
  }

  if (t === 'add-shape') {
    const s = findSlide(op.slideId);
    if (!s) return { ok: false, error: 'no such slide' };
    const isNativeSlide = s.src === undefined;
    const isImportedOverlaySlide =
      (model.mode || 'native') === 'overlay' && Number.isInteger(s.src);
    if (!isNativeSlide && !isImportedOverlaySlide) {
      return { ok: false, error: 'generated shapes require a suite-native or imported overlay slide' };
    }
    const shapeType = op.shapeType === undefined ? 'rect' : op.shapeType;
    if (shapeType !== 'rect') return { ok: false, error: 'shapeType must be rect' };
    if (typeof op.fill !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(op.fill)) {
      return { ok: false, error: 'fill must be a #RRGGBB hex string' };
    }
    const box = { x: op.x, y: op.y, w: op.w, h: op.h };
    const invalidBox = generatedBoxError(box);
    if (invalidBox) return { ok: false, error: invalidBox };
    const decor = {
      id: shortId('d'),
      kind: 'shape',
      sid: null,
      generated: true,
      shapeType: 'rect',
      box,
      fill: op.fill
    };
    s.decor = s.decor || [];
    s.decor.push(decor);
    return { ok: true, affected: { slideId: s.id, decorId: decor.id } };
  }

  if (t === 'add-image') {
    const s = findSlide(op.slideId);
    if (!s) return { ok: false, error: 'no such slide' };
    const isNativeSlide = s.src === undefined;
    const isImportedOverlaySlide =
      (model.mode || 'native') === 'overlay' && Number.isInteger(s.src);
    if (!isNativeSlide && !isImportedOverlaySlide) {
      return { ok: false, error: 'generated images require a suite-native or imported overlay slide' };
    }
    const resolved = resolveProjectImageSource(op.source);
    if (!resolved.ok) return { ok: false, error: resolved.error };
    const box = { x: op.x, y: op.y, w: op.w, h: op.h };
    const invalidBox = generatedBoxError(box);
    if (invalidBox) return { ok: false, error: invalidBox };
    const decor = {
      id: shortId('d'),
      kind: 'pic',
      sid: null,
      generated: true,
      source: resolved.source,
      box,
    };
    s.decor = s.decor || [];
    s.decor.push(decor);
    return { ok: true, affected: { slideId: s.id, decorId: decor.id } };
  }

  if (t === 'add-video') {
    const s = findSlide(op.slideId);
    if (!s) return { ok: false, error: 'no such slide' };
    const isNativeSlide = s.src === undefined;
    const isImportedOverlaySlide =
      (model.mode || 'native') === 'overlay' && Number.isInteger(s.src);
    if (!isNativeSlide && !isImportedOverlaySlide) {
      return { ok: false, error: 'generated videos require a suite-native or imported overlay slide' };
    }
    const resolved = resolveProjectVideoSource(op.source);
    if (!resolved.ok) return { ok: false, error: resolved.error };
    const box = { x: op.x, y: op.y, w: op.w, h: op.h };
    const invalidBox = generatedBoxError(box);
    if (invalidBox) return { ok: false, error: invalidBox };
    const autoplay = op.autoplay === undefined ? true : op.autoplay;
    const loop = op.loop === undefined ? true : op.loop;
    if (typeof autoplay !== 'boolean') return { ok: false, error: 'autoplay must be a boolean' };
    if (typeof loop !== 'boolean') return { ok: false, error: 'loop must be a boolean' };
    const decor = {
      id: shortId('d'),
      kind: 'media',
      sid: null,
      generated: true,
      source: resolved.source,
      box,
      autoplay,
      loop,
    };
    s.decor = s.decor || [];
    s.decor.push(decor);
    return { ok: true, affected: { slideId: s.id, decorId: decor.id } };
  }

  if (t === 'set-media') {
    const s = findSlide(op.slideId);
    if (!s) return { ok: false, error: 'no such slide' };
    if (typeof op.decorId !== 'string' || !op.decorId) {
      return { ok: false, error: 'decorId must name an existing generated media item' };
    }
    const media = (s.decor || []).find((item) => item.id === op.decorId);
    if (!media) return { ok: false, error: 'no such decor id: ' + op.decorId };
    if (media.generated !== true || media.kind !== 'media') {
      return { ok: false, error: 'set-media requires an existing generated media decor' };
    }

    const hasSource = op.source !== undefined;
    const hasAutoplay = op.autoplay !== undefined;
    const hasLoop = op.loop !== undefined;
    if (!hasSource && !hasAutoplay && !hasLoop) {
      return { ok: false, error: 'set-media needs at least one of source, autoplay, or loop' };
    }

    let source;
    if (hasSource) {
      const resolved = resolveProjectVideoSource(op.source);
      if (!resolved.ok) return { ok: false, error: resolved.error };
      source = resolved.source;
    }
    if (hasAutoplay && typeof op.autoplay !== 'boolean') {
      return { ok: false, error: 'autoplay must be a boolean' };
    }
    if (hasLoop && typeof op.loop !== 'boolean') {
      return { ok: false, error: 'loop must be a boolean' };
    }

    if (hasSource) media.source = source;
    if (hasAutoplay) media.autoplay = op.autoplay;
    if (hasLoop) media.loop = op.loop;
    return { ok: true, affected: { slideId: s.id, decorId: media.id, media: true } };
  }

  if (t === 'set-image') {
    const s = findSlide(op.slideId);
    if (!s) return { ok: false, error: 'no such slide' };
    if (typeof op.decorId !== 'string' || !op.decorId) {
      return { ok: false, error: 'decorId must name an existing generated picture item' };
    }
    const pic = (s.decor || []).find((item) => item.id === op.decorId);
    if (!pic) return { ok: false, error: 'no such decor id: ' + op.decorId };
    if (pic.generated !== true || pic.kind !== 'pic') {
      return { ok: false, error: 'set-image requires an existing generated picture decor' };
    }
    const resolved = resolveProjectImageSource(op.source);
    if (!resolved.ok) return { ok: false, error: resolved.error };

    pic.source = resolved.source;
    return { ok: true, affected: { slideId: s.id, decorId: pic.id, pic: true } };
  }

  if (t === 'set-animation') {
    const s = findSlide(op.slideId);
    if (!s) return { ok: false, error: 'no such slide' };
    if (typeof op.targetId !== 'string' || !op.targetId) {
      return { ok: false, error: 'targetId must name an element or decor item' };
    }
    const element = findElement(s, op.targetId);
    const decor = (s.decor || []).find((item) => item.id === op.targetId);
    if (!element && !decor) return { ok: false, error: 'no such element or decor id: ' + op.targetId };
    if (decor && decor.kind === 'media') {
      return { ok: false, error: 'media playback is configured by add-video and cannot use object animations' };
    }
    if ((model.mode || 'native') === 'overlay' && Number.isInteger(s.src)) {
      if (element && !element.ref) {
        return { ok: false, error: 'that imported element has no backing PowerPoint shape to animate' };
      }
      if (decor && decor.generated !== true && decor.sid == null) {
        return { ok: false, error: 'that decor item has no backing PowerPoint shape to animate' };
      }
    }
    s.animations = Array.isArray(s.animations) ? s.animations : [];
    const existingIndex = s.animations.findIndex((animation) => animation.targetId === op.targetId);
    if (op.effect === 'none') {
      if (op.trigger !== undefined || op.duration !== undefined || op.delay !== undefined ||
          op.index !== undefined) {
        return { ok: false, error: 'trigger, duration, delay, and index are not valid when effect is none' };
      }
      if (existingIndex >= 0) s.animations.splice(existingIndex, 1);
      if (!s.animations.length) delete s.animations;
      else if (s.animations[0].trigger !== 'click') s.animations[0].trigger = 'click';
      return { ok: true, affected: { slideId: s.id, targetId: op.targetId, animation: true } };
    }
    if (!['appear', 'fade', 'wipe', 'rise-up'].includes(op.effect)) {
      return { ok: false, error: 'effect must be appear, fade, wipe, rise-up, or none' };
    }
    const trigger = op.trigger === undefined ? 'click' : op.trigger;
    if (!['click', 'with-previous', 'after-previous'].includes(trigger)) {
      return { ok: false, error: 'trigger must be click, with-previous, or after-previous' };
    }
    const duration = op.duration === undefined ? (op.effect === 'appear' ? 0.1 : 0.5) : op.duration;
    if (typeof duration !== 'number' || !Number.isFinite(duration) ||
        duration < 0.1 || duration > 10) {
      return { ok: false, error: 'duration must be a finite number from 0.1 to 10 seconds' };
    }
    const delay = op.delay === undefined ? 0 : op.delay;
    if (typeof delay !== 'number' || !Number.isFinite(delay) || delay < 0 || delay > 30) {
      return { ok: false, error: 'delay must be a finite number from 0 to 30 seconds' };
    }
    if (op.index !== undefined && (!Number.isInteger(op.index) || op.index < 0)) {
      return { ok: false, error: 'index must be a non-negative integer' };
    }
    const animation = { targetId: op.targetId, effect: op.effect, trigger, duration, delay };
    let insertAt;
    if (existingIndex >= 0) {
      s.animations.splice(existingIndex, 1);
      insertAt = op.index === undefined ? existingIndex : op.index;
    } else {
      insertAt = op.index === undefined ? s.animations.length : op.index;
    }
    insertAt = Math.min(insertAt, s.animations.length);
    if (insertAt === 0 && trigger !== 'click') {
      return { ok: false, error: 'the first animation on a slide must trigger on click' };
    }
    s.animations.splice(insertAt, 0, animation);
    return { ok: true, affected: { slideId: s.id, targetId: op.targetId, animation: true } };
  }

  if (t === 'delete-element') {
    const s = findSlide(op.slideId);
    if (!s) return { ok: false, error: 'no such slide' };
    const i = s.elements.findIndex((e) => e.id === op.elementId);
    if (i < 0) return { ok: false, error: 'no such element' };
    const reason = uneditableElementReason(s, s.elements[i]);
    if (reason) return { ok: false, error: reason };
    const removedId = s.elements[i].id;
    s.elements.splice(i, 1);
    if (Array.isArray(s.animations)) {
      s.animations = s.animations.filter((animation) => animation.targetId !== removedId);
      if (!s.animations.length) delete s.animations;
      else if (s.animations[0].trigger !== 'click') s.animations[0].trigger = 'click';
    }
    return { ok: true, affected: { slideId: s.id } };
  }

  if (t === 'delete-decor') {
    const s = findSlide(op.slideId);
    if (!s) return { ok: false, error: 'no such slide' };
    const index = (s.decor || []).findIndex((decor) => decor.id === op.decorId);
    if (index < 0) return { ok: false, error: 'no such decor item' };
    if (s.decor[index].generated !== true) {
      return { ok: false, error: 'imported decor cannot be deleted' };
    }
    const removedId = s.decor[index].id;
    s.decor.splice(index, 1);
    if (Array.isArray(s.animations)) {
      s.animations = s.animations.filter((animation) => animation.targetId !== removedId);
      if (!s.animations.length) delete s.animations;
      else if (s.animations[0].trigger !== 'click') s.animations[0].trigger = 'click';
    }
    return { ok: true, affected: { slideId: s.id, removedDecorId: op.decorId } };
  }

  if (t === 'set-text') {
    const s = findSlide(op.slideId);
    const e = findElement(s, op.elementId);
    const reason = uneditableElementReason(s, e);
    if (reason) return { ok: false, error: reason };
    if (typeof op.text !== 'string') return { ok: false, error: 'text must be a string' };
    e.text = op.text;
    delete e.items;
    return { ok: true, affected: { slideId: s.id, elementId: e.id } };
  }

  if (t === 'set-bullets') {
    const s = findSlide(op.slideId);
    const e = findElement(s, op.elementId);
    const reason = uneditableElementReason(s, e);
    if (reason) return { ok: false, error: reason };
    if (!Array.isArray(op.items) || !op.items.every((item) => typeof item === 'string')) {
      return { ok: false, error: 'items must be an array of strings' };
    }
    e.items = op.items.slice();
    delete e.text;
    return { ok: true, affected: { slideId: s.id, elementId: e.id } };
  }

  // Text run styling (color / bold / size / align) on a text element. The
  // renderer applies this to every run in the shape each time it renders, so
  // it's the one way to change color/weight/size without touching base.pptx.
  if (t === 'set-style') {
    const s = findSlide(op.slideId);
    const e = findElement(s, op.elementId);
    const reason = uneditableElementReason(s, e);
    if (reason) return { ok: false, error: reason };
    const styleFields = ['color', 'bold', 'size', 'align', 'font'];
    if (!styleFields.some((field) => op[field] !== undefined)) {
      return { ok: false, error: 'set-style needs at least one of color/bold/size/align/font' };
    }
    e.style = e.style || {};
    if (op.color !== undefined) {
      const c = String(op.color || '');

      if (!/^#[0-9a-fA-F]{6}$/.test(c)) return { ok: false, error: 'color must be a #RRGGBB hex string' };
      e.style.color = c;
    }
    if (op.bold !== undefined) {
      if (typeof op.bold !== 'boolean') return { ok: false, error: 'bold must be a boolean' };
      e.style.bold = op.bold;
    }
    if (op.size !== undefined) {
      const n = op.size;
      if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || n > 400) {
        return { ok: false, error: 'size must be a number greater than 0 and no more than 400' };
      }
      e.style.size = n;
    }
    if (op.align !== undefined) {
      if (!['left', 'center', 'right', 'justify'].includes(op.align)) return { ok: false, error: 'align must be left/center/right/justify' };
      e.style.align = op.align;
    }
    if (op.font !== undefined) {
      const f = String(op.font || '').trim();
      // Restricted to a safe charset (letters/digits/spaces/hyphens) so a font
      // name can never break out of the dashboard's inline style="..." attribute
      // (elPosHtml interpolates style.font unescaped, same as color/fill do,
      // which are safe only because they're already regex-validated hex).
      if (!/^[A-Za-z0-9 \-]{1,60}$/.test(f)) return { ok: false, error: 'font must be 1-60 characters, letters/digits/spaces/hyphens only' };
      e.style.font = f;
    }
    return { ok: true, affected: { slideId: s.id, elementId: e.id, style: true } };
  }

  // Solid fill color, on either a text element's background box or a decor
  // shape (colored bars, bullet-marker squares, callout panels). Tries the
  // element namespace first, then decor, since callers pass one target id.
  if (t === 'set-fill') {
    const s = findSlide(op.slideId);
    if (!s) return { ok: false, error: 'no such slide' };
    const color = String(op.color || '');
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) return { ok: false, error: 'color must be a #RRGGBB hex string' };
    if (op.elementId) {
      const e = findElement(s, op.elementId);
      if (e) {
        const reason = uneditableElementReason(s, e);
        if (reason) return { ok: false, error: reason };
        e.style = e.style || {}; e.style.fill = color;
        return { ok: true, affected: { slideId: s.id, elementId: e.id, fill: true } };
      }
    }
    if (op.decorId) {
      const d = (s.decor || []).find((x) => x.id === op.decorId);
      if (d) {
        if (d.kind !== 'shape' || (d.generated !== true && d.sid == null)) {
          return { ok: false, error: 'that decor item is not colorable' };
        }
        d.fill = color; return { ok: true, affected: { slideId: s.id, decorId: d.id, fill: true } };
      }
    }
    return { ok: false, error: 'no such element or decor id: ' + (op.elementId || op.decorId) };
  }

  // Explicit outline color for text-backed cards. Imported cards can retain
  // a stale source border even after their fill moves onto the deck palette.
  if (t === 'set-outline') {
    const s = findSlide(op.slideId);
    const e = findElement(s, op.elementId);
    const reason = uneditableElementReason(s, e);
    if (reason) return { ok: false, error: reason };
    const color = String(op.color || '');
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
      return { ok: false, error: 'color must be a #RRGGBB hex string' };
    }
    e.style = e.style || {};
    e.style.outline = color;
    return { ok: true, affected: { slideId: s.id, elementId: e.id, outline: true } };
  }

  if (t === 'set-corners') {
    const s = findSlide(op.slideId);
    if (!s) return { ok: false, error: 'no such slide' };
    if (op.corners !== 'sharp') return { ok: false, error: 'corners must be sharp' };
    if (typeof op.targetId !== 'string' || !op.targetId) {
      return { ok: false, error: 'targetId must name an imported box/card element or decor item' };
    }
    if ((model.mode || 'native') !== 'overlay' || !Number.isInteger(s.src)) {
      return { ok: false, error: 'set-corners is supported only on imported overlay slides' };
    }
    const element = findElement(s, op.targetId);
    if (element) {
      const reason = uneditableElementReason(s, element);
      if (reason) return { ok: false, error: reason };
      if (!element.ref || !BOX_SHAPE_PRESETS.has(element.sourcePreset)) {
        return { ok: false, error: 'that element is not an eligible imported box/card AutoShape' };
      }
      element.corners = 'sharp';
      return {
        ok: true,
        affected: { slideId: s.id, elementId: element.id, corners: true }
      };
    }
    const decor = (s.decor || []).find((item) => item.id === op.targetId);
    if (!decor) {
      return { ok: false, error: 'no such element or decor id: ' + op.targetId };
    }
    if (decor.generated === true) {
      return { ok: false, error: 'generated objects cannot use set-corners; generated rectangles are already sharp' };
    }
    if (decor.kind !== 'shape' || !Number.isInteger(decor.sid) ||
        !BOX_SHAPE_PRESETS.has(decor.sourcePreset)) {
      return { ok: false, error: 'that decor item is not an eligible imported box/card AutoShape' };
    }
    decor.corners = 'sharp';
    return {
      ok: true,
      affected: { slideId: s.id, decorId: decor.id, corners: true }
    };
  }

  if (t === 'set-box') {
    const s = findSlide(op.slideId);
    if (!s) return { ok: false, error: 'no such slide' };
    const isNativeSlide = s.src === undefined;
    const isImportedOverlaySlide =
      (model.mode || 'native') === 'overlay' && Number.isInteger(s.src);
    if (!isNativeSlide && !isImportedOverlaySlide) {
      return { ok: false, error: 'box geometry requires a suite-native or imported overlay slide' };
    }
    const patch = {};
    for (const k of ['x', 'y', 'w', 'h']) {
      if (op[k] === undefined) continue;

      const n = op[k];
      if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1) return { ok: false, error: `${k} must be a number between 0 and 1 (a fraction of slide width/height)` };
      if ((k === 'w' || k === 'h') && n === 0) return { ok: false, error: `${k} must be greater than 0` };
      patch[k] = n;
    }
    if (!Object.keys(patch).length) return { ok: false, error: 'need at least one of x/y/w/h' };
    if (op.elementId) {
      const e = findElement(s, op.elementId);
      if (e) {
        const reason = uneditableElementReason(s, e);
        if (reason) return { ok: false, error: reason };
        if (isNativeSlide) {
          const nextBox = Object.assign({}, e.box, patch);
          const invalidBox = generatedBoxError(nextBox);
          if (invalidBox) {
            return {
              ok: false,
              error: e.box
                ? invalidBox
                : `native text needs x, y, w, and h for its first explicit box: ${invalidBox}`
            };
          }
          e.box = nextBox;
          return { ok: true, affected: { slideId: s.id, elementId: e.id, box: true } };
        }
        e.box = Object.assign({}, e.box, patch);
        return { ok: true, affected: { slideId: s.id, elementId: e.id, box: true } };
      }
    }
    if (op.decorId) {
      const d = (s.decor || []).find((x) => x.id === op.decorId);
      if (d) {
        if (isNativeSlide && d.generated !== true) {
          return { ok: false, error: 'set-box is supported only for generated decor on a native slide' };
        }
        if (d.generated !== true && d.sid == null) {
          return { ok: false, error: 'that decor item has no backing PowerPoint shape' };
        }
        const nextBox = Object.assign({}, d.box, patch);
        if (d.generated === true) {
          const invalidBox = generatedBoxError(nextBox);
          if (invalidBox) return { ok: false, error: invalidBox };
        }
        d.box = nextBox;
        return { ok: true, affected: { slideId: s.id, decorId: d.id, box: true } };
      }
    }
    return { ok: false, error: 'no such element or decor id: ' + (op.elementId || op.decorId) };
  }

  // Theme accent colors. Only affects slides/elements added natively inside
  // the suite (overlay-mode shapes keep whatever base.pptx + set-style give
  // them) — see fill_native() in render_pptx.py.
  if (t === 'set-theme') {

    if (op.accent !== undefined && !/^#[0-9a-fA-F]{6}$/.test(String(op.accent))) {
      return { ok: false, error: 'accent must be a #RRGGBB hex string' };
    }
    if (op.accent === undefined && op.accent2 === undefined) return { ok: false, error: 'set-theme needs an accent color' };
    if (op.accent2 !== undefined) return { ok: false, error: 'accent2 is not supported by the renderer' };
    model.theme = model.theme || {};
    if (op.accent !== undefined) model.theme.accent = String(op.accent);
    return { ok: true, affected: { scope: 'theme' } };
  }

  return { ok: false, error: 'unknown op.type: ' + t };
}

// ----------------------------------------------------------- pause / resume
async function lockPauseFiles() {
  const pptxLocked = (process.env.SLIDES_WORKSPACE && !fs.existsSync(PPTX_PATH)) || await setReadOnly(PPTX_PATH, true);
  const modelLocked = await setReadOnly(MODEL_PATH, true);
  return pptxLocked && modelLocked;
}

async function verifyPauseFiles() {
  if (await lockPauseFiles()) return true;
  return lockPauseFiles();
}

async function doPause(by) {
  if (state.paused) {
    const verified = await verifyPauseFiles();
    if (!verified) return { ok: false, error: 'presentation is paused, but its read-only locks could not be verified' };
    return { ok: true };
  }
  // Persist the complete future state before exposing the in-memory edit gate.
  // A failed write must leave both the current gate and the OS locks untouched.
  const next = copyState();
  next.paused = true;
  next.pausedBy = by || 'dashboard';
  next.pausedAt = Date.now();
  appendStateLog(next, { kind: 'pause', by: next.pausedBy });
  if (!persistState(next)) return { ok: false, error: 'could not save pause state; editing is unchanged' };

  state = next;                              // set the gate before any awaits
  if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
  const verified = await verifyPauseFiles();
  // The durable edit gate is already closed, so every viewer must learn about
  // the pause even when an OS-level defence-in-depth lock is incomplete.
  broadcast({
    type: 'pause', by: state.pausedBy, at: state.pausedAt,
    locksVerified: verified, ts: Date.now()
  });
  if (!verified) {

    console.error('pause committed but could not verify both read-only locks');
    return { ok: false, error: 'pause was saved, but presentation locks could not be verified; editing remains paused' };
  }
  return { ok: true };
}

async function doResume(by) {
  if (!state.paused) {
    // Idempotent resume is also a repair operation. A crash can persist the
    // unpaused gate after clearing only one read-only attribute (or vice
    // versa); claiming success without checking leaves edits unable to save.
    const modelUnlocked = await setReadOnly(MODEL_PATH, false);
    const pptxUnlocked = await setReadOnly(PPTX_PATH, false);
    return modelUnlocked && pptxUnlocked
      ? { ok: true }
      : { ok: false, error: 'presentation is unpaused, but its writable file state could not be verified' };
  }
  // Keep the in-memory gate closed until BOTH OS locks are clear and the
  // unpaused state is durable. A failed save must immediately fail closed.
  const modelUnlocked = await setReadOnly(MODEL_PATH, false);
  const pptxUnlocked = await setReadOnly(PPTX_PATH, false);
  if (!modelUnlocked || !pptxUnlocked) {
    const restored = await lockPauseFiles();
    console.error('resume could not verify both writable files; relock result:', restored);
    return { ok: false, error: 'could not unlock the presentation; editing remains paused' };
  }

  const next = copyState();
  next.paused = false;
  next.pausedBy = null;
  next.pausedAt = null;
  appendStateLog(next, { kind: 'resume', by: by || 'dashboard' });
  if (!persistState(next)) {
    const restored = await lockPauseFiles();
    console.error('resume state did not persist; relock result:', restored);
    return { ok: false, error: 'could not save resume state; editing remains paused' };
  }

  state = next;
  broadcast({ type: 'resume', by: by || 'dashboard', ts: Date.now() });
  scheduleRender();
  return { ok: true };
}

// --------------------------------------------------------------- http layer
class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'RequestError';
    this.status = status;
  }
}

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const REQUEST_BODY_TIMEOUT_MS = Math.max(
  25,
  Number.parseInt(process.env.SUITE_REQUEST_BODY_TIMEOUT_MS || '15000', 10) || 15000
);

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = [];
    let bytes = 0;
    let done = false;
    let timer = null;
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      fn(value);
    };
    const declared = Number.parseInt(req.headers['content-length'] || '', 10);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      req.resume();
      finish(reject, new RequestError(413, `request body exceeds ${MAX_BODY_BYTES} bytes`));
      return;
    }
    timer = setTimeout(() => {
      req.resume();
      finish(reject, new RequestError(408, `request body was not completed within ${REQUEST_BODY_TIMEOUT_MS}ms`));
    }, REQUEST_BODY_TIMEOUT_MS);
    if (timer.unref) timer.unref();
    req.on('data', (chunk) => {
      if (done) return;
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_BODY_BYTES) {
        data = [];
        // Drain rather than destroy the socket: destroying it prevents the
        // caller from receiving the structured 413 response.
        req.resume();
        finish(reject, new RequestError(413, `request body exceeds ${MAX_BODY_BYTES} bytes`));
        return;
      }
      data.push(Buffer.from(chunk));
    });
    req.on('end', () => {
      if (done) return;
      if (!bytes) return finish(resolve, {});
      let parsed;
      try { parsed = JSON.parse(Buffer.concat(data).toString('utf8')); }
      catch (_) { return finish(reject, new RequestError(400, 'request body must be valid JSON')); }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return finish(reject, new RequestError(400, 'request body must be a JSON object'));
      }
      for (const field of ['id', 'name', 'by', 'editor', 'author', 'assignee']) {
        if (parsed[field] === undefined || parsed[field] === null) continue;
        const value = parsed[field];
        if (typeof value !== 'string' || value.length > 60 || /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/.test(value)) {
          return finish(reject, new RequestError(400, `${field} must be at most 60 characters without controls or bidi formatting`));
        }
      }
      finish(resolve, parsed);
    });
    req.on('error', (error) => finish(reject, new RequestError(400, `request body error: ${error.message}`)));
  });
}

function requireControlJson(req, res) {
  const contentType = String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    json(res, 415, { ok: false, error: 'control requests must use Content-Type: application/json' });
    return false;
  }
  const origin = String(req.headers.origin || '');
  const configured = new Set([
    `http://${HOST}:${PORT}`,
    `http://127.0.0.1:${PORT}`,
    `http://localhost:${PORT}`,
  ]);
  for (const item of String(process.env.SUITE_ALLOWED_ORIGINS || '').split(',')) {
    if (item.trim()) configured.add(item.trim());
  }
  // Do not compare Origin with Host: Host is supplied by the requester and a
  // DNS-rebinding request can make both attacker-controlled values agree.
  if (origin && !configured.has(origin)) {
    json(res, 403, { ok: false, error: 'cross-origin control request refused' });
    return false;
  }
  return true;
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  // These replies deliberately carry no CORS header. That alone does not stop
  // a browser from sending a simple cross-origin POST, so sensitive controls
  // additionally enforce JSON plus same-origin above.
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

const STATIC = {
  '/dashboard-session.js': ['dashboard-session.js', 'text/javascript; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/studio': ['studio.html', 'text/html; charset=utf-8'],
  '/studio.html': ['studio.html', 'text/html; charset=utf-8'],
  '/studio.js': ['studio.js', 'text/javascript; charset=utf-8'],
  '/studio.css': ['studio.css', 'text/css; charset=utf-8'],
  '/animation-preview.js': ['animation-preview.js', 'text/javascript; charset=utf-8'],
  '/animation-preview.css': ['animation-preview.css', 'text/css; charset=utf-8']
};

function serveStatic(res, file, type) {
  fs.readFile(path.join(PUBLIC, file), (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}

// Read-only and model-bound: the browser may request only a picture already
// named by a current slide/decor id. This gives the approximate entrance-build
// preview its source pixels without exposing an arbitrary filesystem path.
function serveAnimationPreviewAsset(res, url) {
  const slideId = String(url.searchParams.get('slideId') || '');
  const objectId = String(url.searchParams.get('objectId') || '');
  const slide = (model.slides || []).find((item) => item.id === slideId);
  const object = slide && (slide.decor || []).find((item) => item.id === objectId);
  if (!object || object.kind !== 'pic' || storedImageSourceError(object.source)) {
    json(res, 404, { ok: false, error: 'preview artwork not found' });
    return;
  }
  const resolved = resolveProjectImageSource(object.source);
  if (!resolved.ok) {
    json(res, 404, { ok: false, error: 'preview artwork not found' });
    return;
  }
  const types = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
  };
  fs.readFile(resolved.absolute, (error, body) => {
    if (error) {
      json(res, 404, { ok: false, error: 'preview artwork not found' });
      return;
    }
    res.writeHead(200, {
      'Content-Type': types[path.extname(resolved.absolute).toLowerCase()] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(body);
  });
}

function parseSingleByteRange(value, size) {
  if (value === undefined) return { ok: true, range: null };
  if (typeof value !== 'string' || value.includes(',')) return { ok: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2]) || size <= 0) return { ok: false };
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return { ok: false };
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)
        || start < 0 || start >= size || end < start) return { ok: false };
    end = Math.min(end, size - 1);
  }
  return { ok: true, range: { start, end } };
}

// Read-only, model-bound streaming for generated MP4 decor. The URL accepts
// stable slide/object ids only; the source path always comes back out of the
// validated live model and is re-resolved beneath the real assets directory.
function serveMediaPreviewAsset(req, res, url) {
  const slideId = String(url.searchParams.get('slideId') || '');
  const objectId = String(url.searchParams.get('objectId') || '');
  const slide = (model.slides || []).find((item) => item.id === slideId);
  const object = slide && (slide.decor || []).find((item) => item.id === objectId);
  if (!object || object.kind !== 'media' || object.generated !== true
      || storedVideoSourceError(object.source)) {
    json(res, 404, { ok: false, error: 'preview video not found' });
    return;
  }
  const resolved = resolveProjectVideoSource(object.source);
  if (!resolved.ok) {
    json(res, 404, { ok: false, error: 'preview video not found' });
    return;
  }
  fs.stat(resolved.absolute, (statError, stat) => {
    if (statError || !stat || !stat.isFile()) {
      json(res, 404, { ok: false, error: 'preview video not found' });
      return;
    }
    const rangeResult = parseSingleByteRange(req.headers.range, stat.size);
    const baseHeaders = {
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Content-Disposition': 'inline',
    };
    if (!rangeResult.ok) {
      res.writeHead(416, Object.assign(baseHeaders, {
        'Content-Range': `bytes */${stat.size}`,
        'Content-Length': 0,
      }));
      res.end();
      return;
    }
    const range = rangeResult.range;
    const start = range ? range.start : 0;
    const end = range ? range.end : Math.max(0, stat.size - 1);
    const length = stat.size === 0 ? 0 : end - start + 1;
    const headers = Object.assign(baseHeaders, { 'Content-Length': length });
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
    res.writeHead(range ? 206 : 200, headers);
    if (req.method === 'HEAD' || length === 0) {
      res.end();
      return;
    }
    const stream = fs.createReadStream(resolved.absolute, { start, end });
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  });
}

function serveObjectHistoryAsset(req, res, url) {
  const ref = elementHistoryRef(
    url.searchParams.get('slideId'),
    url.searchParams.get('objectKind'),
    url.searchParams.get('objectId')
  );
  const entry = elementHistory && elementHistory.entries[elementHistoryKey(ref)];
  const versionId = String(url.searchParams.get('versionId') || '');
  const version = entry && entry.timeline.includes(versionId) && entry.versions[versionId];
  const object = version && version.state && version.state.object;
  if (!findHistoryObject(model, ref) || !object || !object.generated ||
      !['pic', 'media'].includes(object.kind)) {
    json(res, 404, { ok: false, error: 'saved preview asset not found' });
    return;
  }
  const resolved = object.kind === 'media'
    ? resolveProjectVideoSource(object.source)
    : resolveProjectImageSource(object.source);
  if (!resolved.ok) {
    json(res, 404, { ok: false, error: 'saved preview asset not found' });
    return;
  }
  if (object.kind === 'pic') {
    const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif' };
    fs.stat(resolved.absolute, (statError, stat) => {
      if (statError || !stat || !stat.isFile()) {
        json(res, 404, { ok: false, error: 'saved preview asset not found' });
        return;
      }
      res.writeHead(200, {
        'Content-Type': types[path.extname(resolved.absolute).toLowerCase()] || 'application/octet-stream',
        'Content-Length': stat.size,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Resource-Policy': 'same-origin',
        'Content-Disposition': 'inline',
      });
      if (req.method === 'HEAD') return res.end();
      const stream = fs.createReadStream(resolved.absolute);
      stream.on('error', () => res.destroy());
      stream.pipe(res);
    });
    return;
  }
  fs.stat(resolved.absolute, (statError, stat) => {
    if (statError || !stat || !stat.isFile()) {
      json(res, 404, { ok: false, error: 'saved preview asset not found' });
      return;
    }
    const rangeResult = parseSingleByteRange(req.headers.range, stat.size);
    const baseHeaders = {
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Content-Disposition': 'inline',
    };
    if (!rangeResult.ok) {
      res.writeHead(416, Object.assign(baseHeaders, {
        'Content-Range': `bytes */${stat.size}`,
        'Content-Length': 0,
      }));
      return res.end();
    }
    const range = rangeResult.range;
    const start = range ? range.start : 0;
    const end = range ? range.end : Math.max(0, stat.size - 1);
    const length = stat.size === 0 ? 0 : end - start + 1;
    const headers = Object.assign(baseHeaders, { 'Content-Length': length });
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
    res.writeHead(range ? 206 : 200, headers);
    if (req.method === 'HEAD' || length === 0) return res.end();
    const stream = fs.createReadStream(resolved.absolute, { start, end });
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  });
}

function snapshot(extra) {
  return Object.assign({
    model,
    paused: state.paused,
    pausedBy: state.pausedBy,
    pausedAt: state.pausedAt,
    rev: model.rev,
    editors: editorList(),
    thumbs: thumbsVer,
    board: boardView(),
    tasks: tasksView(),
    loops: loopView(),
    locks: lockView(),
    protections: protectionView(),
    protectionExceptions: protectionExceptionView(),
    protectionHistory: protectionHistoryView(),
    pdfVer, pdfRev: state.pdfRev,
    presentation: presentationFreshness(),
    undoCount: undoStack.length,
    redoCount: redoStack.length,
    port: PORT,
    bootedAt: BOOTED_AT
  }, extra || {});
}

let pluginJobActive = false;

async function handleRequest(req, res) {

  const url = new URL(req.url || '/', 'http://localhost');
  const p = url.pathname;
  res.setHeader('X-Slides-Instance', INSTANCE_ID);
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const fetchSite = req.headers['sec-fetch-site'];
  if ((p.startsWith('/api/') || p.startsWith('/thumbs/')) && fetchSite && !['same-origin','none'].includes(fetchSite)) return json(res,403,{error:'Cross-origin resource request refused'});
  if (req.headers['x-slides-instance'] && req.headers['x-slides-instance'] !== INSTANCE_ID) return json(res,409,{error:'Suite instance changed; restart the MCP client'});
  const allowedHosts = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`]);
  if (!allowedHosts.has(req.headers.host)) return json(res, 403, {error:'Invalid Host header'});
  if (req.headers.origin && !Array.from(allowedHosts).some(h => req.headers.origin === `http://${h}`)) return json(res, 403, {error:'Cross-origin request refused'});

  if (await dashboardSession.handle(req, res, url, readBody)) return;

  if (req.method === 'OPTIONS') { json(res, 204, {}); return; }
  if (req.method === 'GET' && p === '/api/animation-preview-asset') {
    serveAnimationPreviewAsset(res, url);
    return;
  }
  if ((req.method === 'GET' || req.method === 'HEAD') && p === '/api/media-preview-asset') {
    serveMediaPreviewAsset(req, res, url);
    return;
  }
  if ((req.method === 'GET' || req.method === 'HEAD') && p === '/api/object-history/asset') {
    serveObjectHistoryAsset(req, res, url);
    return;
  }
  if (req.method === 'POST' && p.startsWith('/api/') && !requireControlJson(req, res)) return;

  if (req.method === 'POST' && p.startsWith('/api/plugin/') && process.env.SLIDES_WORKSPACE) {
    const b = await readBody(req);
    const {confined: confinedPath} = require('./lib/workspace');
    // Confinement refusals describe the caller's own path argument: pass the reason through to the tool result.
    const confined = (root, value, options) => {
      try { return confinedPath(root, value, options); }
      catch (error) { throw new RequestError(400, error.syscall ? 'Path is not readable inside the workspace; check the relative path' : error.message); }
    };
    const {checkPython} = require('./lib/prerequisites');
    const {convert,detectRenderer} = require('./lib/renderer');
    if (p === '/api/plugin/renderer') {
      try { const py = checkPython(); const renderer = detectRenderer(); return json(res,200,{ok:true,pythonAvailable:true,pythonPptx:py.pythonPptx,renderer:renderer.renderer,version:renderer.version,png:renderer.png,rasterizer:renderer.rasterizer}); }
      catch(e) { console.error('Renderer probe failed:',e); return json(res,422,{error:'Renderer unavailable; run npm run doctor in the installation directory'}); }
    }
    if (!['/api/plugin/import','/api/plugin/export'].includes(p)) return json(res,404,{error:'Unknown operation'});
    const importing = p.endsWith('/import');
    if (state.paused) return json(res,423,{error:'paused',pausedBy:state.pausedBy});
    const capturedRev=model.rev;
    const editor=String(b.editor||'mcp-agent').slice(0,60);
    const checkImport=()=>{
      if(state.paused)throw new RequestError(423,'paused');
      if(model.rev!==capturedRev)throw new RequestError(409,'Deck changed during import; review it before retrying');
      for(const slide of model.slides){const lock=locks.get(slide.id);if(!lock||lock.by!==editor||Date.now()-lock.ts>LOCK_TTL)throw new RequestError(409,'Lock all current slides before importing');}
      const conflict=protectionConflictForScope({slides:model.slides.map(s=>s.id),wholeSlides:model.slides.map(s=>s.id),objects:[]});
      if(conflict)throw new RequestError(423,'Protected content must be unlocked by the human before replacing the deck');
    };
    if (pluginJobActive) return json(res,429,{error:'An import or export is already running; retry when it finishes'});
    pluginJobActive = true;
    let stage;
    try{
      if(importing)checkImport();
      if(!importing&&!['pptx','pdf','png'].includes(b.format))throw new RequestError(400,'format must be pptx, pdf or png');
      const target=confined(ROOT,b.path,{write:!importing});
      if(importing&&!/\.pptx$/i.test(target))throw new RequestError(400,'Import requires .pptx');
      if(!importing&&b.format!=='png'&&!target.toLowerCase().endsWith('.'+b.format))throw new RequestError(400,'Destination extension must match format');
      checkPython();
      stage=fs.mkdtempSync(path.join(DATA,'.io-'));
      if(importing){
        const source=path.join(stage,'source.pptx');fs.copyFileSync(target,source);
        const base=path.join(DATA,'import-'+crypto.randomBytes(12).toString('hex')+'.pptx');
        const candidate=await require('./lib/python-jobs').run(() => new Promise((resolve,reject)=>execFile(PY,[path.join(HERE,'src','python','import-model.py'),source,base],{cwd:HERE,encoding:'utf8',timeout:60000,maxBuffer:2*1024*1024,windowsHide:true},(err,out,stderr)=>{if(err){console.error('Import helper failed:',err);const known = ['Unsupported active content: embedded workbooks and objects are not supported. Replace workbook-backed charts with PNG, JPEG or GIF images before import','External links must be removed before import','Unsupported active content: macros, OLE or ActiveX','Unsupported active content: package content type','Unsupported active content: package relationship','Unsupported active content: embedded object or control','Unsupported image: only PNG, JPEG and GIF raster content is accepted','XML byte budget exceeded','XML element/attribute/depth budget exceeded'];const reason = known.find(message => String(stderr).split('\n').includes('ValueError: '+message));return reject(new RequestError(400,reason || 'Import refused: invalid or unsupported PPTX content'));}try{resolve(JSON.parse(out));}catch(e){reject(e);}})));
        candidate.title=path.basename(target,'.pptx');
        for(const slide of candidate.slides)(slide.decor||[]).forEach((d,i)=>{if(!d.id)d.id=`${slide.id}_d${i}`;});
        const invalid=validateModelDocument(candidate,true);if(invalid)throw new RequestError(400,invalid);
        checkImport();
        const before=JSON.parse(JSON.stringify(model));candidate.rev=capturedRev+1;
        fs.copyFileSync(source,base,fs.constants.COPYFILE_EXCL);
        fs.copyFileSync(source+'.slides-validation.json',base+'.slides-validation.json',fs.constants.COPYFILE_EXCL);
        const history=historyCandidateForTransition(before,candidate,editor,'Imported '+path.basename(target));
        const committed=persistModelAndElementHistory(candidate,history.history);
        if(!committed.ok){fs.unlinkSync(base);fs.unlinkSync(base+'.slides-validation.json');throw new Error(committed.error);}
        model=candidate;elementHistory=history.history;
        pushUndo(before,{editor,opType:'import',detail:'Imported '+path.basename(target),rev:model.rev,ts:Date.now()});redoStack=[];
        addLog({kind:'import',editor,detail:'Imported '+path.basename(target),rev:model.rev});
        locks.clear();dirtyAll=true;scheduleRender();
        broadcast({type:'edit',editor,opType:'import',rev:model.rev,model,undoCount:undoStack.length,redoCount:0,ts:Date.now()});
        return json(res,200,{ok:true,rev:model.rev,slides:model.slides.length,path:b.path});
      }
      const snapshot=JSON.stringify(model);
      const pptx=path.join(stage,'deck.pptx');
      const rendered=await runCapturedProcess(PY,[RENDER_PY,'-',pptx],{cwd:HERE,env:{...process.env,PYTHONUTF8:'1'},windowsHide:true},snapshot,60000);
      if(!rendered.ok){const error=new Error('PPTX render failed: '+rendered.error);if(rendered.error==='Render helper timed out')error.code='RENDERER_TIMEOUT';throw error;}
      let output=pptx;let renderer='python-pptx';
      if(b.format!=='pptx'){
        output=path.join(stage,b.format==='pdf'?'deck.pdf':'pages');
        const result=await convert(pptx,output,b.format,{cacheDirectory:path.join(DATA,'static-images')});renderer=result.renderer;
      }
      if(state.paused)throw new RequestError(423,'paused before export publication');
      confined(ROOT,b.path,{write:true});
      const files=b.format==='png'?fs.readdirSync(output).map(n=>b.path+'/'+n):[b.path];
      const receiptPath=path.join(DATA,'exports.json');
      const receipts=require('./lib/export-receipts').nextReceipts(receiptPath,{ts:Date.now(),editor,format:b.format,rev:capturedRev,renderer,files});
      if(b.format==='png'){
        // Reserve a fresh directory; never replace any existing file.
        fs.mkdirSync(target,{mode:0o700});
        try{for(const file of fs.readdirSync(output))fs.copyFileSync(path.join(output,file),path.join(target,file),fs.constants.COPYFILE_EXCL);}
        catch(e){fs.rmSync(target,{recursive:true,force:true});throw e;}
      }else fs.copyFileSync(output,target,fs.constants.COPYFILE_EXCL);
      const receiptRecorded=saveJSONAtomic(receiptPath,receipts);
      return json(res,200,{ok:true,rev:capturedRev,renderer,files,receiptRecorded,...(!receiptRecorded?{warning:'Export succeeded, but its history receipt could not be saved.'}:{})});
    }catch(e){console.error(importing?'Import failed:':'Export failed:',e);const timeout=!importing&&e.code==='RENDERER_TIMEOUT';const safe=timeout?'Export failed: renderer timed out':(e instanceof RequestError ? e.message : (e.message === 'Import refused: invalid or unsupported PPTX content' ? e.message : (importing ? 'Import failed; check the file format, path and package limits' : 'Export failed; check the destination and renderer with npm run doctor')));return json(res,timeout?504:(e instanceof RequestError?e.status:400),{error:safe});}
    finally{pluginJobActive = false;if(stage)fs.rmSync(stage,{recursive:true,force:true});}
  }

  // ---- static
  // The root is now the studio. 302 (not 301) on purpose: a permanent redirect
  // is cached by the browser and would survive a rollback, leaving no way back
  // to the dashboard without clearing site data.
  if (req.method === 'GET' && p === '/') {
    res.writeHead(302, { Location: '/studio', 'Cache-Control': 'no-store' });
    return res.end();
  }
  if (req.method === 'GET' && STATIC[p]) { const [f, t] = STATIC[p]; return serveStatic(res, f, t); }
  if (req.method === 'GET' && p === '/favicon.ico') { res.writeHead(204); return res.end(); }

  // ---- true slide thumbnails (slide-1.png … slide-N.png)
  if (req.method === 'GET' && /^\/thumbs\/slide-\d+\.png$/.test(p)) {
    fs.readFile(path.join(THUMBS_DIR, path.basename(p)), (err, buf) => {
      if (err) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
      res.end(buf);
    });
    return;
  }

  // ---- SSE stream
  if (req.method === 'GET' && p === '/api/events') {
    // Same reasoning as json()'s comment: no cross-origin header, so a page
    // on any other origin can't read this stream (full deck/board state)
    // just because the user happened to have it open locally.
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    res.write('retry: 2000\n\n');
    res.write(`data: ${JSON.stringify(Object.assign({ type: 'snapshot' }, snapshot()))}\n\n`);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  // ---- health + state
  if (req.method === 'GET' && p === '/api/health') {
    return json(res, 200, { ok: true, service: 'toolsenabled-slides', instanceId: INSTANCE_ID, workspace: ROOT, pid: process.pid, presentation: presentationFreshness() });
  }
  if (req.method === 'GET' && p === '/api/state') {
    return json(res, 200, Object.assign(snapshot(url.searchParams.get('board') === 'omit' ? {board:[]} : {}), { log: state.log.slice(-80) }));
  }

  // ---- quality lint (read-only; not gated by pause, like the board)
  if (req.method === 'GET' && p === '/api/lint') {
    if(url.searchParams.get('cached')==='1'){
      let artifact;try{const stat=fs.statSync(PPTX_PATH);artifact=`${stat.mtimeMs}:${stat.size}`;}catch{artifact='missing';}
      const cached=fullLint.cache?.key===`${model.rev}:${artifact}`?fullLint.cache.value:null;
      return json(res,200,cached?{...cached,cached:true}:{rev:model.rev,cached:false});
    }
    return json(res, 200, await fullLint(model));
  }

  // ---- speaking-time estimate (read-only; not gated by pause, like the board)
  if (req.method === 'GET' && p === '/api/timing') {
    return json(res, 200, estimateTiming(model));
  }

  // ---- download the rendered pptx
  if (req.method === 'GET' && p === '/api/pptx') {
    const expectedRev = model.rev;
    const freshness = presentationFreshness();
    if (!freshness.current) {
      return json(res, 409, { ok: false, error: `presentation is not current: ${freshness.error}` });
    }
    try {
      const buf = fs.readFileSync(PPTX_PATH);
      if (model.rev !== expectedRev) {
        return json(res, 409, { ok: false, error: 'the deck changed while the download was being prepared; retry' });
      }
      res.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': 'attachment; filename="presentation.pptx"'
      });
      res.end(buf);
    } catch (error) {
      return json(res, 404, { ok: false, error: 'not rendered yet' });
    }
    return;
  }

  // ---- on-demand PDF export + download (not gated by pause; read-only against
  // whatever presentation.pptx currently holds, same spirit as /api/pptx)
  if (req.method === 'POST' && p === '/api/pdf/export') {
    const result = await runPdfExport();
    return json(res, result.ok ? 200 : 500, Object.assign({ ver: pdfVer }, result));
  }
  if (req.method === 'GET' && p === '/api/pdf') {
    fs.readFile(PDF_PATH, (err, buf) => {
      if (err) return json(res, 404, { error: 'not exported yet: POST /api/pdf/export first' });
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="presentation.pdf"'
      });
      res.end(buf);
    });
    return;
  }

  if (req.method === 'POST' && p === '/api/heartbeat') {
    const b = await readBody(req);
    const now = Date.now();
    if (b.id) {
      const wasNew = !editors.has(b.id);
      const ed = editors.get(b.id) || { id: b.id, name: b.name || 'editor', joinedAt: now, status: null, task: '' };
      ed.lastSeen = now; if (b.name) ed.name = b.name;
      // A plain heartbeat leaves status untouched, so `ppt watch` keeps a
      // session visible without clobbering a free/busy state set elsewhere.
      let statusChanged = false;
      if (b.status === 'free' || b.status === 'busy') {
        statusChanged = ed.status !== b.status;
        ed.status = b.status;
        ed.task = b.status === 'free' ? '' : (b.task != null ? String(b.task).slice(0, 200) : ed.task || '');
      }
      editors.set(b.id, ed);
      if (wasNew || statusChanged) broadcast({ type: 'editors', editors: editorList(), ts: now });

      if (statusChanged && b.status === 'free' && releaseLocksFor(b.id)) {
        broadcast({ type: 'locks', locks: lockView(), ts: now });
      }
    }
    return json(res, 200, { paused: state.paused, pausedBy: state.pausedBy, rev: model.rev });
  }
  if (req.method === 'POST' && p === '/api/leave') {
    const b = await readBody(req);
    if (b.id) {
      const hadLocks = releaseLocksFor(b.id);
      if (editors.delete(b.id) || hadLocks) broadcast({ type: 'editors', editors: editorList(), ts: Date.now() });
      if (hadLocks) broadcast({ type: 'locks', locks: lockView(), ts: Date.now() });
    }
    return json(res, 200, { ok: true });
  }
  // ---- set a session's free/busy status (id = the SUITE_EDITOR name)
  if (req.method === 'POST' && p === '/api/status') {
    const b = await readBody(req);
    const now = Date.now();
    const id = typeof b.id === 'string' ? b.id.trim().slice(0, 60) : '';
    if (!id) return json(res, 400, { ok: false, error: 'missing id' });
    if (!['free', 'busy'].includes(b.status)) {
      return json(res, 400, { ok: false, error: 'status must be free or busy' });
    }
    const name = typeof b.name === 'string' && b.name.trim() ? b.name.trim().slice(0, 60) : id;
    const ed = editors.get(id) || { id, name, joinedAt: now, status: null, task: '' };
    ed.lastSeen = now; ed.name = name;
    const wasBusy = ed.status === 'busy';
    ed.status = b.status;
    ed.task = ed.status === 'free' ? '' : (b.task != null ? String(b.task).slice(0, 200) : ed.task || '');
    editors.set(id, ed);
    broadcast({ type: 'editors', editors: editorList(), ts: now });
    if (wasBusy && ed.status === 'free' && releaseLocksFor(id)) {
      broadcast({ type: 'locks', locks: lockView(), ts: now });
    }
    return json(res, 200, { ok: true, status: ed.status, task: ed.task });
  }

  // ---- message board (NOT gated by pause — communication always works)
  if (req.method === 'GET' && p === '/api/board') {
    const offset = Math.max(0,parseInt(url.searchParams.get('offset'),10)||0);
    const limit = Math.max(1,Math.min(100,parseInt(url.searchParams.get('limit'),10)||100));
    return json(res, 200, boardPage(board,offset,limit));
  }
  if (req.method === 'POST' && p === '/api/board') {
    const b = await readBody(req);
    if (b.pinned === true && !dashboardSession.requireSession(req, res)) return;
    const text = String(b.text == null ? '' : b.text).trim();
    if (!text) return json(res, 400, { ok: false, error: 'empty note' });
    if (b.pinned !== undefined && typeof b.pinned !== 'boolean') {
      return json(res, 400, { ok: false, error: 'pinned must be a boolean' });
    }
    const tx = addNote({ text, author: b.author, pinned: b.pinned, humanOrigin: dashboardSession.authenticated(req) });
    if (!tx.ok) return json(res, 500, { ok: false, error: tx.error });
    const note = tx.note;
    broadcast({ type: 'board', action: 'add', note, notes: boardView(), ts: Date.now() });
    return json(res, 200, { ok: true, note });
  }
  if (req.method === 'POST' && p === '/api/board/pin') {
    const b = await readBody(req);
    if (typeof b.pinned !== 'boolean') {
      return json(res, 400, { ok: false, error: 'pinned must be a boolean' });
    }
    const n = board.notes.find((x) => x.id === b.id);
    if (!n) return json(res, 404, { ok: false, error: 'no such note' });
    const tx = transactBoard((target) => {
      const note = target.notes.find((x) => x.id === b.id);
      note.pinned = b.pinned;
      note.humanOrigin = true;
      return { note };
    });
    if (!tx.ok) return json(res, 500, { ok: false, error: tx.error });
    broadcast({ type: 'board', action: 'pin', note: tx.note, notes: boardView(), ts: Date.now() });
    return json(res, 200, { ok: true, note: tx.note });
  }
  if (req.method === 'POST' && p === '/api/board/delete') {
    const b = await readBody(req);
    const i = board.notes.findIndex((x) => x.id === b.id);
    if (i < 0) return json(res, 404, { ok: false, error: 'no such note' });
    const tx = transactBoard((target) => ({ removed: target.notes.splice(target.notes.findIndex((x) => x.id === b.id), 1)[0] }));
    if (!tx.ok) return json(res, 500, { ok: false, error: tx.error });
    broadcast({ type: 'board', action: 'delete', note: tx.removed, notes: boardView(), ts: Date.now() });
    return json(res, 200, { ok: true });
  }

  // ---- shared task list (also ungated by pause, like the board)
  if (req.method === 'GET' && p === '/api/tasks') {
    return json(res, 200, { tasks: tasksView() });
  }
  if (req.method === 'POST' && p === '/api/tasks') {
    const b = await readBody(req);
    if (!isRecord(b) || Object.keys(b).some(k => !['text','by','assignee'].includes(k)))
      return json(res, 400, {ok:false, error:'Unsupported task field'});
    const text = typeof b.text === 'string' ? b.text.trim() : '';
    if (!text || text.length > 2000) return json(res, 400, {ok:false, error:'Task text must contain 1 to 2000 characters'});
    const invalid = taskAssigneeError(b.assignee);
    if (invalid) return json(res, 400, {ok:false, error:invalid});
    const tx = addTask({text, by:b.by, assignee:b.assignee});
    if (!tx.ok) return json(res, 500, {ok:false, error:tx.error});
    broadcast({type:'tasks', action:'add', task:tx.task, tasks:tasksView(), ts:Date.now()});
    return json(res, 200, {ok:true, task:tx.task});
  }
  if (req.method === 'POST' && p === '/api/tasks/protection-grant') {
    const b = await readBody(req);
    if (!isRecord(b)) return json(res, 400, { ok: false, error: 'protection grant must be an object' });
    const allowed = new Set(['id', 'slideIds', 'minutes', 'revoke', 'by']);
    const unknown = Object.keys(b).find((key) => !allowed.has(key));
    if (unknown) return json(res, 400, { ok: false, error: `unsupported protection grant field "${unknown}"` });

    const id = typeof b.id === 'string' ? b.id.trim() : '';
    const who = typeof b.by === 'string' ? b.by.trim() : '';
    if (!id) return json(res, 400, { ok: false, error: 'missing task id' });
    if (!who) return json(res, 400, { ok: false, error: 'missing by' });
    if (id.length > 120) return json(res, 400, { ok: false, error: 'task id is too long' });
    if (who.length > 60) return json(res, 400, { ok: false, error: 'by is too long' });
    if (isSuiteAgentActor(who)) {
      return json(res, 403, { ok: false, error: 'only a human may grant delegated protection control' });
    }
    if (b.revoke !== undefined && typeof b.revoke !== 'boolean') {
      return json(res, 400, { ok: false, error: 'revoke must be a boolean' });
    }

    const current = findTask(id);
    if (!current) return json(res, 404, { ok: false, error: 'no such task' });
    if (!['open', 'claimed'].includes(current.status)) {
      return json(res, 409, { ok: false, error: `only active tasks may receive a protection grant (task is ${current.status})` });
    }
    const taskActor = String(current.assignee || current.claimedBy || '');
    if (!isExternalEditor(taskActor)) {
      return json(res, 409, { ok: false, error: 'task must be assigned to an external editor' });
    }
    if (current.claimedBy && current.claimedBy !== taskActor) {
      return json(res, 409, { ok: false, error: 'task is claimed by a different editor' });
    }

    const revoke = b.revoke === true;
    let slideIds = [];
    let minutes = 60;
    if (!revoke) {
      if (!Array.isArray(b.slideIds) || !b.slideIds.length) {
        return json(res, 400, { ok: false, error: 'slideIds must be a non-empty array' });
      }
      slideIds = Array.from(new Set(b.slideIds.map((value) =>
        typeof value === 'string' ? value.trim() : '')));
      if (slideIds.some((value) => !value)) {
        return json(res, 400, { ok: false, error: 'slideIds must contain non-empty strings' });
      }
      const unknownSlide = slideIds.find((slideId) => !findSlide(slideId));
      if (unknownSlide) return json(res, 400, { ok: false, error: `no such slide: ${unknownSlide}` });
      if (slideIds.length > 64) return json(res, 400, { ok: false, error: 'too many delegated slides' });
      if (b.minutes !== undefined) {
        if (!Number.isSafeInteger(b.minutes) || b.minutes < 1 || b.minutes > 240) {
          return json(res, 400, { ok: false, error: 'minutes must be an integer from 1 to 240' });
        }
        minutes = b.minutes;
      }
    } else if (b.slideIds !== undefined || b.minutes !== undefined) {
      return json(res, 400, { ok: false, error: 'revoke cannot include slideIds or minutes' });
    }

    const changedAt = Date.now();
    if (!revoke && isRecord(current.protectionGrant)) {
      return json(res, 409, {
        ok: false,
        error: 'task already has a protection grant; revoke it and use a new task for a new grant'
      });
    }
    const tx = transactBoard((target) => {
      const task = findTask(id, target);
      if (revoke) {
        if (!isRecord(task.protectionGrant) || task.protectionGrant.revokedAt) {
          return { task, changed: false };
        }
        task.protectionGrant = Object.assign({}, task.protectionGrant, {
          revokedAt: changedAt,
          revokedBy: who
        });
      } else {
        task.protectionGrant = {
          version: 1,
          slideIds,
          editOps: ['add-image'],
          // Delegation never transfers whole-slide protection control. The
          // protected add-image bypass leaves the human's existing slide lock
          // untouched; the agent may only add a direct lock to the exact
          // generated picture it just inserted.
          protectionModes: ['direct-generated-decor'],
          grantedTo: taskActor,
          grantedBy: who,
          grantedAt: changedAt,
          expiresAt: changedAt + minutes * 60 * 1000
        };
      }
      task.updatedAt = changedAt;
      task.updatedBy = who;
      return { task, changed: true };
    });
    if (!tx.ok) return json(res, 500, { ok: false, error: tx.error });
    broadcast({
      type: 'tasks',
      action: revoke ? 'protection-revoke' : 'protection-grant',
      task: tx.task,
      tasks: tasksView(),
      ts: changedAt
    });
    return json(res, 200, { ok: true, changed: tx.changed, task: tx.task });
  }
  if (req.method === 'POST' && p === '/api/tasks/update') {
    const b = await readBody(req);
    if (!isRecord(b) || Object.keys(b).some(k => !['id','text','assignee','by'].includes(k)))
      return json(res, 400, {ok:false, error:'Unsupported task update field'});
    const who = typeof b.by === 'string' ? b.by.trim() : '';
    if (!b.id || !who || who.length > 60) return json(res, 400, {ok:false, error:'Task id and editor are required'});
    const hasText = Object.hasOwn(b, 'text'), hasAssignee = Object.hasOwn(b, 'assignee');
    if (!hasText && !hasAssignee) return json(res, 400, {ok:false, error:'Task update needs text or assignee'});
    if (hasText && (typeof b.text !== 'string' || !b.text.trim() || b.text.length > 2000))
      return json(res, 400, {ok:false, error:'Task text must contain 1 to 2000 characters'});
    const invalid = hasAssignee && taskAssigneeError(b.assignee);
    if (invalid) return json(res, 400, {ok:false, error:invalid});
    if (isExternalEditor(who)) return json(res, 403, {ok:false, error:'Use the dashboard to update task instructions or assignments'});
    const current = findTask(b.id);
    if (!current) return json(res, 404, {ok:false, error:'No such task'});
    if (current.status !== 'open') return json(res, 409, {ok:false, error:'Only open tasks may be updated'});
    const ts = Date.now();
    const tx = transactBoard(target => {
      const task = findTask(b.id, target), revision = {ts, by:who};
      if (hasText && b.text.trim() !== task.text) { revision.text = task.text; task.text = b.text.trim(); }
      if (hasAssignee && b.assignee !== task.assignee) { revision.assignee = task.assignee; task.assignee = b.assignee; }
      if (Object.keys(revision).length > 2) task.revisions = (task.revisions || []).slice(-(TASK_REVISION_LIMIT - 1)).concat(revision);
      task.updatedAt = ts; task.updatedBy = who;
      return {task};
    });
    if (!tx.ok) return json(res, 500, {ok:false, error:tx.error});
    broadcast({type:'tasks', action:'update', task:tx.task, tasks:tasksView(), ts});
    return json(res, 200, {ok:true, task:tx.task});
  }
  if (req.method === 'POST' && p === '/api/tasks/claim') {
    const b = await readBody(req);
    const t = findTask(b.id);
    if (!t) return json(res, 404, { ok: false, error: 'no such task' });
    if (t.status === 'done') return json(res, 400, { ok: false, error: 'task already done' });
    const who = typeof b.by === 'string' ? b.by.trim().slice(0, 60) : '';
    if (!who) return json(res, 400, { ok: false, error: 'missing by' });
    if (t.assignee && t.assignee !== who) {
      return json(res, 409, { ok: false, error: `task is assigned to ${t.assignee}` });
    }
    if (t.status === 'claimed') {
      if (t.claimedBy === who) return json(res, 200, { ok: true, task: t, alreadyClaimed: true });
      return json(res, 409, { ok: false, error: `task is already claimed by ${t.claimedBy || 'another editor'}` });
    }
    const tx = transactBoard((target) => {
      const task = findTask(b.id, target);
      task.status = 'claimed'; task.claimedBy = who;
      return { task };
    });
    if (!tx.ok) return json(res, 500, { ok: false, error: tx.error });
    broadcast({ type: 'tasks', action: 'claim', task: tx.task, tasks: tasksView(), ts: Date.now() });
    return json(res, 200, { ok: true, task: tx.task });
  }
  if (req.method === 'POST' && p === '/api/tasks/done') {
    const b = await readBody(req);
    const t = findTask(b.id);
    if (!t) return json(res, 404, { ok: false, error: 'no such task' });
    const who = typeof b.by === 'string' ? b.by.trim().slice(0, 60) : '';
    if (!who) return json(res, 400, { ok: false, error: 'missing by' });
    // Workers must own the task; other labels need an authenticated dashboard
    // to close another editor's work as oversight. Labels alone grant no bypass.
    if (isExternalEditor(who) || !dashboardSession.authenticated(req)) {
      if (t.assignee && t.assignee !== who) {
        return json(res, 409, { ok: false, error: `task is assigned to ${t.assignee}` });
      }
      if (t.claimedBy && t.claimedBy !== who) {
        return json(res, 409, { ok: false, error: `task is claimed by ${t.claimedBy}` });
      }
    }

    if (t.status === 'done') {
      return json(res, 200, { ok: true, task: t, alreadyDone: true });
    }
    const tx = transactBoard((target) => {
      const task = findTask(b.id, target);
      task.status = 'done'; task.doneTs = Date.now();
      if (!task.claimedBy) task.claimedBy = who;
      return { task };
    });
    if (!tx.ok) return json(res, 500, { ok: false, error: tx.error });
    broadcast({ type: 'tasks', action: 'done', task: tx.task, tasks: tasksView(), ts: Date.now() });
    return json(res, 200, { ok: true, task: tx.task });
  }
  if (req.method === 'POST' && p === '/api/tasks/delete') {
    const b = await readBody(req);
    const i = board.tasks.findIndex((x) => x.id === b.id);
    if (i < 0) return json(res, 404, { ok: false, error: 'no such task' });
    const tx = transactBoard((target) => ({ removed: target.tasks.splice(target.tasks.findIndex((x) => x.id === b.id), 1)[0] }));
    if (!tx.ok) return json(res, 500, { ok: false, error: tx.error });
    broadcast({ type: 'tasks', action: 'delete', task: tx.removed, tasks: tasksView(), ts: Date.now() });
    return json(res, 200, { ok: true });
  }
  // Return (and optionally claim) the next task for a session: one aimed at
  // that session first, else an unassigned one. This is the primitive a
  // self-polling `/loop` worker calls each tick; the human/relay path ignores it.
  if (req.method === 'POST' && p === '/api/tasks/next') {
    const b = await readBody(req);
    const who = typeof b.by === 'string' ? b.by.trim().slice(0, 60) : '';
    if (b.claim === true && !who) return json(res, 400, { ok: false, error: 'missing by' });
    const open = board.tasks.filter((t) => t.status === 'open').sort((a, b) => a.ts - b.ts);
    const mine = who ? open.find((t) => t.assignee === who) : null;
    const any = (b.includeUnassigned === false) ? null : open.find((t) => !t.assignee);
    const t = mine || any || null;
    if (t && b.claim) {
      const tx = transactBoard((target) => {
        const task = findTask(t.id, target);
        task.status = 'claimed'; task.claimedBy = who;
        return { task };
      });
      if (!tx.ok) return json(res, 500, { ok: false, error: tx.error });
      broadcast({ type: 'tasks', action: 'claim', task: tx.task, tasks: tasksView(), ts: Date.now() });
      return json(res, 200, { ok: true, task: tx.task });
    }
    return json(res, 200, { ok: true, task: t });
  }

  // ---- standing loops (recurring check prompts; also ungated by pause)
  if (req.method === 'GET' && p === '/api/loops') {
    return json(res, 200, { loops: loopView() });
  }
  if (req.method === 'POST' && p === '/api/loops') {
    const b = await readBody(req);
    const text = String(b.text == null ? '' : b.text).trim();
    if (!text) return json(res, 400, { ok: false, error: 'empty loop' });
    const tx = addLoop({ text, author: b.author, cadence: b.cadence });
    if (!tx.ok) return json(res, 500, { ok: false, error: tx.error });
    const loop = tx.loop;
    broadcast({ type: 'loops', action: 'add', loop, loops: loopView(), ts: Date.now() });
    return json(res, 200, { ok: true, loop });
  }
  if (req.method === 'POST' && p === '/api/loops/toggle') {
    const b = await readBody(req);
    if (typeof b.enabled !== 'boolean') {
      return json(res, 400, { ok: false, error: 'enabled must be a boolean' });
    }
    const l = findLoop(b.id);
    if (!l) return json(res, 404, { ok: false, error: 'no such loop' });
    const tx = transactBoard((target) => {
      const loop = findLoop(b.id, target);
      loop.enabled = b.enabled;
      return { loop };
    });
    if (!tx.ok) return json(res, 500, { ok: false, error: tx.error });
    broadcast({ type: 'loops', action: 'toggle', loop: tx.loop, loops: loopView(), ts: Date.now() });
    return json(res, 200, { ok: true, loop: tx.loop });
  }
  if (req.method === 'POST' && p === '/api/loops/delete') {
    const b = await readBody(req);
    const i = board.loops.findIndex((x) => x.id === b.id);
    if (i < 0) return json(res, 404, { ok: false, error: 'no such loop' });
    const tx = transactBoard((target) => ({ removed: target.loops.splice(target.loops.findIndex((x) => x.id === b.id), 1)[0] }));
    if (!tx.ok) return json(res, 500, { ok: false, error: tx.error });
    broadcast({ type: 'loops', action: 'delete', loop: tx.removed, loops: loopView(), ts: Date.now() });
    return json(res, 200, { ok: true });
  }
  // Record that a session just ran this loop, so the dashboard shows a heartbeat
  // ("last checked 2m ago by …"). Called by the /loop runner after each pass.
  if (req.method === 'POST' && p === '/api/loops/ran') {
    const b = await readBody(req);
    const l = findLoop(b.id);
    if (!l) return json(res, 404, { ok: false, error: 'no such loop' });
    const tx = transactBoard((target) => {
      const loop = findLoop(b.id, target);
      loop.lastRun = Date.now();
      loop.lastBy = String(b.by == null ? '' : b.by).slice(0, 60);
      loop.lastResult = b.result == null ? null : String(b.result).slice(0, 400);
      return { loop };
    });
    if (!tx.ok) return json(res, 500, { ok: false, error: tx.error });
    broadcast({ type: 'loops', action: 'ran', loop: tx.loop, loops: loopView(), ts: Date.now() });
    return json(res, 200, { ok: true, loop: tx.loop });
  }
  if (req.method === 'GET' && p === '/api/protections') {
    return json(res, 200, {
      protections: protectionView(),
      protectionExceptions: protectionExceptionView(),
      protectionHistory: protectionHistoryView()
    });
  }
  if (req.method === 'POST' && p === '/api/protections/toggle') {
    const b = await readBody(req);
    const parsed = protectionFromToggleBody(b);
    if (!parsed.ok) return json(res, 400, parsed);
    let delegation = null;
    if (isSuiteAgentActor(parsed.by)) {
      if (state.paused) {
        return json(res, 423, {
          ok: false, error: 'paused', pausedBy: state.pausedBy, pausedAt: state.pausedAt
        });
      }
      if (b.delegatedMode !== 'direct-generated-decor') {
        return json(res, 403, {
          ok: false,
          error: 'agents may only protect a generated picture through an explicit delegated mode'
        });
      }
      const delegated = delegatedProtectionMode(
        parsed.by, b.taskId, parsed.protection, parsed.protected, b.delegatedMode, Date.now()
      );
      if (!delegated.ok) return json(res, 403, { ok: false, error: delegated.error });
      delegation = delegated;
      if (b.delegatedMode === 'direct-generated-decor') {
        const slide = model.slides.find((item) => item.id === parsed.protection.slideId);
        const decor = protectionObject(slide, 'decor', parsed.protection.objectId);
        if (!decor || decor.generated !== true || decor.kind !== 'pic') {
          return json(res, 403, {
            ok: false,
            error: 'delegated direct decor protection is limited to generated pictures'
          });
        }
      }
    } else if (b.taskId !== undefined || b.delegatedMode !== undefined) {
      return json(res, 400, {
        ok: false,
        error: 'taskId and delegatedMode are only valid for a delegated agent protection update'
      });
    }

    const key = protectionKey(parsed.protection);
    const existing = state.protections.find((protection) => protectionKey(protection) === key) || null;
    const existingException = parsed.protection.kind === 'object'
      ? state.protectionExceptions.find((exception) => protectionKey(exception) === key) || null
      : null;
    const parentSlideLock = parsed.protection.kind === 'object'
      ? state.protections.find((protection) =>
          protection.kind === 'slide' && protection.slideId === parsed.protection.slideId) || null
      : null;
    const slideScopedObjectLocks = parsed.protection.kind === 'slide'
      ? state.protections.filter((protection) =>
          protection.kind === 'object' && protection.slideId === parsed.protection.slideId)
      : [];
    const slideScopedExceptions = parsed.protection.kind === 'slide'
      ? state.protectionExceptions.filter((exception) =>
          exception.slideId === parsed.protection.slideId)
      : [];

    const changed = delegation
      ? !existing
      : (parsed.protection.kind === 'slide'
          ? (parsed.protected
              ? (!existing || slideScopedObjectLocks.length > 0 || slideScopedExceptions.length > 0)
              : (!!existing || slideScopedObjectLocks.length > 0 || slideScopedExceptions.length > 0))
          : (parentSlideLock
              ? (parsed.protected
                  ? !!existingException || !!existing
                  : !existingException || !!existing)
              : (parsed.protected ? !existing : !!existing)));
    if (!changed) {
      return json(res, 200, {
        ok: true,
        changed: false,
        protected: parsed.protected,
        protection: existingException || existing || parsed.protection,
        protections: protectionView(),
        protectionExceptions: protectionExceptionView(),
        protectionHistory: protectionHistoryView(),
        delegation: delegation ? {
          taskId: delegation.task.id,
          authorizedBy: delegation.grant.grantedBy
        } : undefined
      });
    }

    const next = copyState();
    const changedAt = Date.now();
    let changedProtection;
    if (delegation) {
      changedProtection = Object.assign({}, parsed.protection, {
        by: parsed.by,
        createdAt: changedAt
      });
      next.protections.push(changedProtection);
    } else if (parsed.protection.kind === 'slide') {
      changedProtection = existing || Object.assign({}, parsed.protection, {
        by: parsed.by,
        createdAt: changedAt
      });
      next.protections = next.protections.filter(
        (protection) => protection.slideId !== parsed.protection.slideId
      );
      next.protectionExceptions = next.protectionExceptions.filter(
        (exception) => exception.slideId !== parsed.protection.slideId
      );
      if (parsed.protected) next.protections.push(changedProtection);
    } else if (parentSlideLock) {
      // Direct child rows beneath a slide lock are a supported legacy shape but
      // redundant. Whichever inverse object action the human chooses, collapse
      // that stale row while applying the exception branch.
      next.protections = next.protections.filter(
        (protection) => protectionKey(protection) !== key
      );
      if (parsed.protected) {
        changedProtection = existingException || existing || Object.assign({}, parsed.protection, {
          by: parsed.by,
          createdAt: changedAt
        });
        next.protectionExceptions = next.protectionExceptions.filter(
          (exception) => protectionKey(exception) !== key
        );
      } else {
        changedProtection = existingException || Object.assign({}, parsed.protection, {
          by: parsed.by,
          createdAt: changedAt
        });
        if (!existingException) next.protectionExceptions.push(changedProtection);
      }
    } else if (parsed.protected) {
        changedProtection = Object.assign({}, parsed.protection, {
          by: parsed.by,
          createdAt: changedAt
        });
        next.protections.push(changedProtection);
    } else {
      changedProtection = existing;
      next.protections = next.protections.filter((protection) => protectionKey(protection) !== key);
    }
    const historyEntry = appendProtectionHistory(next, Object.assign({
      action: parsed.protected ? 'lock' : 'unlock',
      kind: parsed.protection.kind,
      slideId: parsed.protection.slideId,
      by: parsed.by,
      ts: changedAt,
      taskId: delegation ? delegation.task.id : undefined,
      authorizedBy: delegation ? delegation.grant.grantedBy : undefined,
      authorizedAt: delegation ? delegation.grant.grantedAt : undefined
    }, parsed.protection.kind === 'object'
      ? {
          objectId: parsed.protection.objectId,
          objectKind: parsed.protection.objectKind
        }
      : {}));
    appendStateLog(next, {
      ts: changedAt,
      kind: parsed.protected ? 'protect' : 'unprotect',
      by: parsed.by,
      protection: Object.assign({}, changedProtection),
      authorizationTaskId: delegation ? delegation.task.id : undefined,
      authorizedBy: delegation ? delegation.grant.grantedBy : undefined
    });
    if (!persistState(next)) {
      return json(res, 500, {
        ok: false,
        error: `could not ${parsed.protected ? 'save' : 'remove'} content protection`
      });
    }
    state = next;
    const protections = protectionView();
    const protectionExceptions = protectionExceptionView();
    const protectionHistory = protectionHistoryView();
    broadcast({
      type: 'protections',
      protections,
      protectionExceptions,
      protectionHistory,
      change: Object.assign({}, historyEntry),
      delegation: delegation ? {
        taskId: delegation.task.id,
        authorizedBy: delegation.grant.grantedBy
      } : undefined,
      ts: changedAt
    });
    return json(res, 200, {
      ok: true,
      changed: true,
      protected: parsed.protected,
      protection: Object.assign({}, changedProtection),
      protections,
      protectionExceptions,
      protectionHistory,
      change: Object.assign({}, historyEntry),
      delegation: delegation ? {
        taskId: delegation.task.id,
        authorizedBy: delegation.grant.grantedBy
      } : undefined
    });
  }

  // ---- advisory slide locks (also ungated by pause; see the `locks` block above)
  if (req.method === 'GET' && p === '/api/locks') {
    return json(res, 200, { locks: lockView() });
  }
  if (req.method === 'POST' && p === '/api/locks') {
    const b = await readBody(req);
    const by = String(b.by == null ? '' : b.by).trim().slice(0, 60);
    if (!by) return json(res, 400, { ok: false, error: 'missing by' });
    const ids = Array.isArray(b.slideIds) ? b.slideIds : (b.slideId ? [b.slideId] : []);
    if (!ids.length) return json(res, 400, { ok: false, error: 'missing slideIds' });
    const note = b.note == null ? '' : String(b.note).replace(/[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]/g, ' ').slice(0, 200);
    const force = b.force === true;
    if (force && !dashboardSession.requireSession(req, res)) return;
    if (process.env.SLIDES_WORKSPACE && force && isExternalEditor(by)) return json(res,403,{error:'Agents may not steal locks'});
    const now = Date.now();
    const locked = [], conflicts = [], unknown = [];
    for (const id of ids) {
      if (!findSlide(id)) { unknown.push(id); continue; }
      const existing = locks.get(id);
      const live = !!existing && (now - existing.ts <= LOCK_TTL); // an expired lock is free to reclaim
      if (live && existing.by !== by && !force) {

        conflicts.push({ slideId: id, heldBy: existing.by, heldForMs: now - existing.ts, refused: true });
        continue;
      }
      locks.set(id, { slideId: id, by, ts: now, note });
      locked.push(id);
    }
    if (locked.length) broadcast({ type: 'locks', locks: lockView(), ts: now });
    return json(res, 200, { ok: true, locked, conflicts, unknown });
  }
  if (req.method === 'POST' && p === '/api/locks/release') {
    const b = await readBody(req);
    const by = String(b.by == null ? '' : b.by).trim().slice(0, 60);
    if (!by) return json(res, 400, { ok: false, error: 'missing by' });
    const all = b.slideIds === 'all';
    if (!all && (!Array.isArray(b.slideIds) || b.slideIds.length === 0 ||
        !b.slideIds.every((id) => typeof id === 'string' && id.trim()))) {
      return json(res, 400, { ok: false, error: 'slideIds must be "all" or a non-empty array of slide ids' });
    }
    const ids = all ? null : [...new Set(b.slideIds)];
    const notMine = [];
    if (!all) {
      for (const id of ids) {
        const existing = locks.get(id);
        if (existing && existing.by !== by) notMine.push(id);
      }
    }
    const changed = releaseLocksFor(by, ids);
    if (changed) broadcast({ type: 'locks', locks: lockView(), ts: Date.now() });
    return json(res, 200, { ok: true, released: changed, notMine });
  }

  // ---- pause / resume
  if (req.method === 'POST' && p === '/api/pause') {
    const b = await readBody(req);
    if (isExternalEditor(b.by)) return json(res,403,{error:'Agents may not pause: use the human studio control'});
    const response = await queuePauseTransition(async () => {
      const outcome = await doPause(b.by);
      const body = snapshot();
      return outcome.ok
        ? { status: 200, body }
        : { status: 500, body: Object.assign({ ok: false, error: outcome.error }, body) };
    });
    return json(res, response.status, response.body);
  }
  if (req.method === 'POST' && p === '/api/resume') {
    const b = await readBody(req);

    if (isExternalEditor(b.by)) {
      return json(res, 403, { ok: false, error: 'agents may not resume: pause is the human\'s hard stop' });
    }
    const response = await queuePauseTransition(async () => {
      const outcome = await doResume(b.by);
      const body = snapshot();
      return outcome.ok
        ? { status: 200, body }
        : { status: 500, body: Object.assign({ ok: false, error: outcome.error }, body) };
    });
    return json(res, response.status, response.body);
  }

  if (req.method === 'POST' && p === '/api/render') {
    await readBody(req);
    if (state.paused) {
      return json(res, 423, { ok: false, error: 'paused', pausedBy: state.pausedBy, pausedAt: state.pausedAt });
    }

    dirtyAll = true;
    scheduleRender();
    return json(res, 200, { ok: true, rev: model.rev });
  }

  if (req.method === 'GET' && p === '/api/object-history') {
    const target = parseObjectHistoryTarget({
      slideId: url.searchParams.get('slideId'),
      objectKind: url.searchParams.get('objectKind'),
      objectId: url.searchParams.get('objectId')
    });
    if (!target.ok) return json(res, 404, { ok: false, error: target.error });
    return json(res, 200, objectHistoryResponse(target.ref));
  }

  if (req.method === 'POST' && p === '/api/object-history/restore') {
    const b = await readBody(req);
    if (state.paused) {
      return json(res, 423, { ok: false, error: 'paused', pausedBy: state.pausedBy, pausedAt: state.pausedAt });
    }
    const by = typeof b.by === 'string' ? b.by.trim() : '';
    if (!by || by.length > 60) return json(res, 400, { ok: false, error: 'by is required and must be at most 60 characters' });
    if (isObjectHistoryAgentActor(by)) return json(res, 403, { ok: false, error: 'agents may not restore object history' });
    const target = parseObjectHistoryTarget(b);
    if (!target.ok) return json(res, 404, { ok: false, error: target.error });
    const entry = target.entry;
    const currentHead = entry.timeline[entry.timeline.length - 1];
    if (typeof b.expectedHeadId !== 'string' || b.expectedHeadId !== currentHead) {
      return json(res, 409, { ok: false, error: 'object history changed; refresh and try again', headId: currentHead });
    }
    const versionIndex = entry.timeline.indexOf(b.versionId);
    if (versionIndex < 0) return json(res, 400, { ok: false, error: 'versionId is not in the active history list' });
    if (versionIndex === entry.timeline.length - 1) {
      return json(res, 400, { ok: false, error: 'that version is already current' });
    }
    const targetProtectionConflict = protectionConflictForScope({
      slides: [target.ref.slideId], wholeSlides: [], objects: [target.ref]
    });
    if (targetProtectionConflict) {
      return json(res, 423, protectionDenial(targetProtectionConflict, 'restore'));
    }

    const beforeModel = cloneJSON(model);
    const candidate = cloneJSON(model);
    const selected = entry.versions[b.versionId];
    const applied = applyElementHistoryState(candidate, target.ref, selected.state);
    if (!applied.ok) return json(res, 409, { ok: false, error: applied.error });
    const invalidModel = validateModelDocument(candidate, true);
    if (invalidModel) return json(res, 409, { ok: false, error: `historical version is invalid: ${invalidModel}` });
    const protectionScope = protectionScopeBetween(beforeModel, candidate, { type: 'object-history-restore' });
    const protectionConflict = protectionConflictForScope(protectionScope);
    if (protectionConflict) return json(res, 423, protectionDenial(protectionConflict, 'restore'));

    candidate.rev = (model.rev || 0) + 1;
    const beforeHistory = elementHistory;
    const candidateHistory = cloneJSON(elementHistory);
    const key = elementHistoryKey(target.ref);
    const nextEntry = candidateHistory.entries[key];
    nextEntry.restoreUndos.push({
      token: `r_${crypto.randomBytes(12).toString('hex')}`,
      createdAt: Date.now(),
      timeline: [...nextEntry.timeline]
    });
    if (nextEntry.restoreUndos.length > ELEMENT_HISTORY_RESTORE_UNDO_LIMIT) nextEntry.restoreUndos.shift();
    nextEntry.timeline = nextEntry.timeline.slice(0, versionIndex + 1);
    pruneElementHistoryVersions(nextEntry);
    candidateHistory.modelRev = candidate.rev;
    const patch = historyPatchForEntries(beforeHistory, candidateHistory, new Set([key]));
    const committed = persistModelAndElementHistory(candidate, candidateHistory);
    if (!committed.ok) return json(res, 500, { ok: false, error: committed.error });

    model = candidate;
    elementHistory = candidateHistory;
    const detail = `restored ${target.ref.objectKind} ${target.ref.objectId} to ${selected.summary}`;
    pushUndo(beforeModel, {
      editor: by, opType: 'object-history-restore', detail, rev: model.rev, ts: Date.now(),
      protectionScope, elementHistoryPatch: patch
    });
    redoStack = [];
    const affected = {
      slideId: target.ref.slideId,
      objectKind: target.ref.objectKind,
      objectId: target.ref.objectId,
      ...(target.ref.objectKind === 'element'
        ? { elementId: target.ref.objectId }
        : { decorId: target.ref.objectId })
    };
    markDirty('object-history-restore', affected);
    addLog({ kind: 'object-history-restore', editor: by, detail, rev: model.rev, affected });
    broadcast({
      type: 'edit', editor: by, opType: 'object-history-restore', detail, affected,
      rev: model.rev, model, undoCount: undoStack.length, redoCount: redoStack.length, ts: Date.now()
    });
    broadcast({ type: 'object-history', target: target.ref, rev: model.rev, ts: Date.now() });
    scheduleRender();
    return json(res, 200, Object.assign(objectHistoryResponse(target.ref), {
      rev: model.rev,
      historyPromotionPending: !!committed.promotionPending
    }));
  }

  if (req.method === 'POST' && p === '/api/object-history/undo-restore') {
    const b = await readBody(req);
    if (state.paused) {
      return json(res, 423, { ok: false, error: 'paused', pausedBy: state.pausedBy, pausedAt: state.pausedAt });
    }
    const by = typeof b.by === 'string' ? b.by.trim() : '';
    if (!by || by.length > 60) return json(res, 400, { ok: false, error: 'by is required and must be at most 60 characters' });
    if (isObjectHistoryAgentActor(by)) return json(res, 403, { ok: false, error: 'agents may not undo an object-history restore' });
    const target = parseObjectHistoryTarget(b);
    if (!target.ok) return json(res, 404, { ok: false, error: target.error });
    const entry = target.entry;
    const currentHead = entry.timeline[entry.timeline.length - 1];
    if (typeof b.expectedHeadId !== 'string' || b.expectedHeadId !== currentHead) {
      return json(res, 409, { ok: false, error: 'object history changed; refresh and try again', headId: currentHead });
    }
    const checkpoint = entry.restoreUndos[entry.restoreUndos.length - 1];
    if (!checkpoint) return json(res, 400, { ok: false, error: 'no restore to undo' });
    if (typeof b.checkpointToken !== 'string' || b.checkpointToken !== checkpoint.token) {
      return json(res, 409, { ok: false, error: 'restore undo changed; refresh and try again', topCheckpointToken: checkpoint.token });
    }
    const restoreHeadId = checkpoint.timeline[checkpoint.timeline.length - 1];
    const restoreVersion = entry.versions[restoreHeadId];
    if (!restoreVersion) return json(res, 409, { ok: false, error: 'restore checkpoint version is unavailable' });
    const targetProtectionConflict = protectionConflictForScope({
      slides: [target.ref.slideId], wholeSlides: [], objects: [target.ref]
    });
    if (targetProtectionConflict) {
      return json(res, 423, protectionDenial(targetProtectionConflict, 'undo restore'));
    }

    const beforeModel = cloneJSON(model);
    const candidate = cloneJSON(model);
    const applied = applyElementHistoryState(candidate, target.ref, restoreVersion.state);
    if (!applied.ok) return json(res, 409, { ok: false, error: applied.error });
    const invalidModel = validateModelDocument(candidate, true);
    if (invalidModel) return json(res, 409, { ok: false, error: `restore checkpoint is invalid: ${invalidModel}` });
    const protectionScope = protectionScopeBetween(beforeModel, candidate, { type: 'object-history-undo-restore' });
    const protectionConflict = protectionConflictForScope(protectionScope);
    if (protectionConflict) return json(res, 423, protectionDenial(protectionConflict, 'undo restore'));

    candidate.rev = (model.rev || 0) + 1;
    const beforeHistory = elementHistory;
    const candidateHistory = cloneJSON(elementHistory);
    const key = elementHistoryKey(target.ref);
    const nextEntry = candidateHistory.entries[key];
    nextEntry.restoreUndos.pop();
    nextEntry.timeline = [...checkpoint.timeline];
    pruneElementHistoryVersions(nextEntry);
    candidateHistory.modelRev = candidate.rev;
    const patch = historyPatchForEntries(beforeHistory, candidateHistory, new Set([key]));
    const committed = persistModelAndElementHistory(candidate, candidateHistory);
    if (!committed.ok) return json(res, 500, { ok: false, error: committed.error });

    model = candidate;
    elementHistory = candidateHistory;
    const detail = `undid history restore for ${target.ref.objectKind} ${target.ref.objectId}`;
    pushUndo(beforeModel, {
      editor: by, opType: 'object-history-undo-restore', detail, rev: model.rev, ts: Date.now(),
      protectionScope, elementHistoryPatch: patch
    });
    redoStack = [];
    const affected = {
      slideId: target.ref.slideId,
      objectKind: target.ref.objectKind,
      objectId: target.ref.objectId,
      ...(target.ref.objectKind === 'element'
        ? { elementId: target.ref.objectId }
        : { decorId: target.ref.objectId })
    };
    markDirty('object-history-undo-restore', affected);
    addLog({ kind: 'object-history-undo-restore', editor: by, detail, rev: model.rev, affected });
    broadcast({
      type: 'edit', editor: by, opType: 'object-history-undo-restore', detail, affected,
      rev: model.rev, model, undoCount: undoStack.length, redoCount: redoStack.length, ts: Date.now()
    });
    broadcast({ type: 'object-history', target: target.ref, rev: model.rev, ts: Date.now() });
    scheduleRender();
    return json(res, 200, Object.assign(objectHistoryResponse(target.ref), {
      rev: model.rev,
      historyPromotionPending: !!committed.promotionPending
    }));
  }

  // ---- the GATED edit endpoint
  if (req.method === 'POST' && p === '/api/edit') {
    const b = await readBody(req);
    if (state.paused) {
      return json(res, 423, { ok: false, error: 'paused', pausedBy: state.pausedBy, pausedAt: state.pausedAt });
    }
    const editor = (b.editor && String(b.editor).slice(0, 60)) || 'anonymous';
    const op = b.op || b;
    // A display name is not proof of a human session. Every client outside
    // the authenticated dashboard must hold its own current slide locks.
    if (process.env.SLIDES_WORKSPACE && !dashboardSession.authenticated(req)) {
      const deckWide = ['add-slide', 'set-theme', 'set-presentation-title'].includes(op.type);
      const ids = !deckWide && op.slideId ? [op.slideId] : model.slides.map(s => s.id);
      if (ids.some(id => { const held = locks.get(id); return !held || held.by !== editor || Date.now()-held.ts > LOCK_TTL; })) return json(res,409,{error:'Lock the affected slides with ppt_lock before editing'});
    }
    //                 // allow either {op:{...}} or the op inline
    let editDelegation = null;
    if (b.taskId !== undefined) {
      const delegated = delegatedProtectedEdit(editor, b.taskId, op, Date.now());
      if (!delegated.ok) return json(res, 403, { ok: false, error: delegated.error });
      editDelegation = delegated;
    }
    const beforeSnapshot = JSON.parse(JSON.stringify(model));   // cheap at this deck's scale; enables undo for every op type with no reverse-logic per op
    // Captured before applyOp so a delete-slide that also releases its own
    // lock (see applyOp's 'delete-slide' branch) doesn't erase the evidence
    // this warning needs.
    const heldBeforeOp = op.slideId ? locks.get(op.slideId) : null;
    // Apply to an isolated candidate. Besides making a failed disk write
    // harmless, this also prevents a validation failure halfway through an
    // op (for example set-style's later fields) from leaking partial state.
    const candidate = JSON.parse(JSON.stringify(model));
    const liveModel = model;
    let result;
    try {
      model = candidate;
      result = applyOp(op);
    } finally {
      model = liveModel;
    }
    if (!result.ok) return json(res, 400, result);
    if (process.env.SLIDES_WORKSPACE) {
      const invalid = validateModelDocument(candidate, true);
      if (invalid) return json(res, 400, {ok:false, error:invalid});
    }
    const protectionScope = protectionScopeBetween(beforeSnapshot, candidate, op);
    const protectionConflict = protectionConflictForScope(protectionScope);
    if (protectionConflict && !editDelegation) {

      return json(res, 423, protectionDenial(protectionConflict, op.type));
    }

    candidate.rev = (candidate.rev || 0) + 1;
    const detail = describeOp(op, result);
    let historyTx;
    try {
      historyTx = historyCandidateForTransition(beforeSnapshot, candidate, editor, detail);
    } catch (error) {
      return json(res, 500, { ok: false, error: `could not capture object history: ${error.message || error}` });
    }
    const committed = persistModelAndElementHistory(candidate, historyTx.history);
    if (!committed.ok) return json(res, 500, { ok: false, error: committed.error });
    model = candidate;
    elementHistory = historyTx.history;
    markDirty(op.type, result.affected);
    if (result.lockReleased) locks.delete(op.slideId);
    pushUndo(beforeSnapshot, {
      editor, opType: op.type, detail, rev: model.rev, ts: Date.now(),
      protectionScope, elementHistoryPatch: historyTx.patch,
      authorizationTaskId: editDelegation ? editDelegation.task.id : undefined,
      authorizedBy: editDelegation ? editDelegation.grant.grantedBy : undefined
    });
    redoStack = [];
    addLog({
      kind: 'edit', editor, opType: op.type, detail, rev: model.rev, affected: result.affected,
      authorizationTaskId: editDelegation ? editDelegation.task.id : undefined,
      authorizedBy: editDelegation ? editDelegation.grant.grantedBy : undefined
    });
    broadcast({
      type: 'edit', editor, opType: op.type, detail, affected: result.affected,
      authorizationTaskId: editDelegation ? editDelegation.task.id : undefined,
      authorizedBy: editDelegation ? editDelegation.grant.grantedBy : undefined,
      rev: model.rev, model, undoCount: undoStack.length, redoCount: redoStack.length, ts: Date.now()
    });
    if (result.lockReleased) broadcast({ type: 'locks', locks: lockView(), ts: Date.now() });
    scheduleRender();
    // Advisory-only heads-up: this slide is claimed by a different session.
    // Never blocks the edit — only `paused` does that — just surfaces the
    // collision risk right where the editor will actually see it.
    let warning;
    if (heldBeforeOp && heldBeforeOp.by !== editor) {
      warning = `slide ${op.slideId} is locked by ${heldBeforeOp.by} (claimed ${Math.round((Date.now() - heldBeforeOp.ts) / 60000)}m ago), edit applied anyway: coordinate on the board if this collides`;
    }
    const lintMsgs = lintAffected(result.affected);
    if (lintMsgs.length) {
      const lintWarning = `quality: ${lintMsgs.join('; ')}`;
      warning = warning ? `${warning} | ${lintWarning}` : lintWarning;
    }
    return json(res, 200, {
      ok: true, rev: model.rev, affected: result.affected, warning,
      historyPromotionPending: !!committed.promotionPending,
      delegation: editDelegation ? {
        taskId: editDelegation.task.id,
        authorizedBy: editDelegation.grant.grantedBy
      } : undefined
    });
  }
  if (req.method === 'POST' && p === '/api/undo') {

    const b = await readBody(req);
    const editor = (b.editor && String(b.editor).slice(0, 60)) || 'anonymous';
    // Agents may never undo/redo: undoStack.pop() takes the newest entry
    // regardless of author, so an agent undo is a blind global rewind. Barred
    // in code, not just in the worker prompt.
    if (isExternalEditor(editor)) return json(res, 403, { ok: false, error: 'agents may not undo' });
    if (state.paused) return json(res, 423, { ok: false, error: 'paused', pausedBy: state.pausedBy, pausedAt: state.pausedAt });
    if (!undoStack.length) return json(res, 400, { ok: false, error: 'nothing to undo' });
    const entry = undoStack[undoStack.length - 1];
    const candidate = JSON.parse(JSON.stringify(entry.model));
    const protectionScope = historyProtectionScope(entry, model, candidate);
    const protectionConflict = protectionConflictForScope(protectionScope);
    if (protectionConflict) {
      return json(res, 423, protectionDenial(protectionConflict, 'undo'));
    }
    candidate.rev = (model.rev || 0) + 1;
    let undoHistory;
    try {
      undoHistory = entry.elementHistoryPatch
        ? {
            history: applyElementHistoryPatch(elementHistory, entry.elementHistoryPatch, 'before', candidate.rev),
            patch: entry.elementHistoryPatch
          }
        : historyCandidateForTransition(model, candidate, editor, `Undo ${entry.detail}`);
    } catch (error) {
      return json(res, 500, { ok: false, error: `could not capture object history: ${error.message || error}` });
    }
    const committed = persistModelAndElementHistory(candidate, undoHistory.history);
    if (!committed.ok) return json(res, 500, { ok: false, error: committed.error });
    undoStack.pop();
    redoStack.push({
      model: JSON.parse(JSON.stringify(model)),
      editor: entry.editor,
      opType: entry.opType,
      detail: entry.detail,
      rev: model.rev,
      ts: Date.now(),
      protectionScope,
      elementHistoryPatch: undoHistory.patch
    });
    if (redoStack.length > UNDO_LIMIT) redoStack.shift();
    model = candidate;
    elementHistory = undoHistory.history;
    dirtyAll = true;
    const detail = `undid ${entry.editor}: ${entry.detail}`;
    addLog({ kind: 'undo', editor, detail, rev: model.rev });
    broadcast({ type: 'edit', editor, opType: 'undo', detail, affected: {}, rev: model.rev, model, undoCount: undoStack.length, redoCount: redoStack.length, ts: Date.now() });
    scheduleRender();
    return json(res, 200, {
      ok: true, rev: model.rev, undone: historySummary(entry),
      historyPromotionPending: !!committed.promotionPending
    });
  }
  if (req.method === 'POST' && p === '/api/redo') {
    const b = await readBody(req);
    const editor = (b.editor && String(b.editor).slice(0, 60)) || 'anonymous';
    if (isExternalEditor(editor)) return json(res, 403, { ok: false, error: 'agents may not redo' });
    if (state.paused) return json(res, 423, { ok: false, error: 'paused', pausedBy: state.pausedBy, pausedAt: state.pausedAt });
    if (!redoStack.length) return json(res, 400, { ok: false, error: 'nothing to redo' });
    const entry = redoStack[redoStack.length - 1];
    const candidate = JSON.parse(JSON.stringify(entry.model));
    const protectionScope = historyProtectionScope(entry, model, candidate);
    const protectionConflict = protectionConflictForScope(protectionScope);
    if (protectionConflict) {
      return json(res, 423, protectionDenial(protectionConflict, 'redo'));
    }
    candidate.rev = (model.rev || 0) + 1;
    let redoHistory;
    try {
      redoHistory = entry.elementHistoryPatch
        ? {
            history: applyElementHistoryPatch(elementHistory, entry.elementHistoryPatch, 'after', candidate.rev),
            patch: entry.elementHistoryPatch
          }
        : historyCandidateForTransition(model, candidate, editor, `Redo ${entry.detail}`);
    } catch (error) {
      return json(res, 500, { ok: false, error: `could not capture object history: ${error.message || error}` });
    }
    const committed = persistModelAndElementHistory(candidate, redoHistory.history);
    if (!committed.ok) return json(res, 500, { ok: false, error: committed.error });
    redoStack.pop();
    pushUndo(JSON.parse(JSON.stringify(model)), {
      editor: entry.editor,
      opType: entry.opType,
      detail: entry.detail,
      rev: model.rev,
      ts: Date.now(),
      protectionScope,
      elementHistoryPatch: redoHistory.patch
    });
    model = candidate;
    elementHistory = redoHistory.history;
    dirtyAll = true;
    const detail = `redid ${entry.editor}: ${entry.detail}`;
    addLog({ kind: 'redo', editor, detail, rev: model.rev });
    broadcast({ type: 'edit', editor, opType: 'redo', detail, affected: {}, rev: model.rev, model, undoCount: undoStack.length, redoCount: redoStack.length, ts: Date.now() });
    scheduleRender();
    return json(res, 200, {
      ok: true, rev: model.rev, redone: historySummary(entry),
      historyPromotionPending: !!committed.promotionPending
    });
  }
  // Read-only preview of what's undoable/redoable, most-recent first. Not
  // gated by pause (like /api/lint) — looking never mutates anything.
  if (req.method === 'GET' && p === '/api/history') {
    return json(res, 200, {
      undo: undoStack.slice().reverse().map(historySummary),
      redo: redoStack.slice().reverse().map(historySummary)
    });
  }

  json(res, 404, { error: 'not found', path: p });
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    const status = error instanceof RequestError ? error.status : 500;
    const message = error instanceof RequestError ? error.message : 'internal server error';
    if (!(error instanceof RequestError)) {
      console.error('request handler failed:', error && (error.stack || error));
    }
    if (!res.headersSent) {
      json(res, status, { ok: false, error: message });
    } else if (!res.writableEnded) {
      res.end();
    }
  });
});
// Bound slow headers and incomplete request bodies without putting a response
// timeout on SSE, whose connection is intentionally long-lived.
server.requestTimeout = REQUEST_BODY_TIMEOUT_MS;
server.headersTimeout = Math.max(
  25,
  Number.parseInt(process.env.SUITE_HEADERS_TIMEOUT_MS || '10000', 10) || 10000
);

function describeOp(op, result) {
  switch (op.type) {
    case 'set-presentation-title': return `title → "${trunc(op.text)}"`;
    case 'add-slide': return `add ${op.layout || 'content'} slide`;
    case 'delete-slide': return `delete slide`;
    case 'move-slide': return `move slide → ${op.index}`;
    case 'set-layout': return `layout → ${op.layout}`;
    case 'set-transition': return op.effect === 'fade'
      ? `transition → fade ${(op.duration === undefined ? 0.35 : op.duration)}s`
      : `transition → none`;
    case 'set-notes': return `edit notes`;
    case 'add-element': return `add ${op.elementType || 'body'}`;
    case 'add-shape': return `add ${op.shapeType || 'rect'} shape`;
    case 'add-image': return `add image ${path.basename(String(op.source || ''))}`;
    case 'add-video': return `add video ${path.basename(String(op.source || ''))}`;
    case 'set-media': {
      const changes = [];
      if (op.source !== undefined) changes.push(`source=${path.basename(String(op.source || ''))}`);
      if (op.autoplay !== undefined) changes.push(`autoplay=${op.autoplay ? 'on' : 'off'}`);
      if (op.loop !== undefined) changes.push(`loop=${op.loop ? 'on' : 'off'}`);
      return `update media ${op.decorId}: ${changes.join(', ')}`;
    }
    case 'set-image': return `update image ${op.decorId}: source=${path.basename(String(op.source || ''))}`;
    case 'set-animation': return op.effect === 'none'
      ? `remove animation from ${op.targetId}`
      : `animate ${op.targetId} with ${op.effect} (${op.trigger || 'click'})`;
    case 'delete-element': return `delete element`;
    case 'delete-decor': return `delete generated decor`;
    case 'set-text': return `text → "${trunc(op.text)}"`;
    case 'set-bullets': return `bullets (${(op.items || []).length})`;
    case 'set-style': return `style → ${JSON.stringify({ color: op.color, bold: op.bold, size: op.size, align: op.align, font: op.font })}`;
    case 'set-fill': return `fill → ${op.color}`;
    case 'set-corners': return `corners → ${op.corners} on ${op.targetId}`;
    case 'set-box': return `box → ${JSON.stringify({ x: op.x, y: op.y, w: op.w, h: op.h })}`;
    case 'set-theme': return `theme → ${JSON.stringify({ accent: op.accent })}`;
    case 'set-outline': return `outline color ${op.color}`;
    default: return op.type;
  }
}
function trunc(s) { s = String(s || ''); return s.length > 42 ? s.slice(0, 42) + '…' : s; }

async function boot() {
  const initialDeck = !fs.existsSync(MODEL_PATH);
  if (initialDeck && !persistModel()) throw new Error('Cannot create initial deck');
  await migrateModel();
  initializeElementHistory();
  server.listen(PORT, HOST, () => {
    sweepStaleTmpFiles();
    // On boot, reconcile the OS read-only bits with the persisted pause state.
    setReadOnly(PPTX_PATH, state.paused);
    setReadOnly(MODEL_PATH, state.paused);
    // Warm the COM host now (its ~2.6-3.6s cold PowerPoint acquire) rather
    // than paying that latency on the first real edit after boot.
    if (IS_WIN && !process.env.SLIDES_WORKSPACE) startComHost().catch((e) => console.error('COM host warm-start failed (will retry lazily on first thumbs job):', e.message));

    const freshness = presentationFreshness();
    if (!freshness.current) {
      if (!initialDeck) console.error('presentation needs a boot render:', freshness.error);
      if (!state.paused) scheduleRender();
    } else {
      void refreshThumbsFromDeck(model.rev, 'boot thumbs pass skipped:');
    }
    console.log(`\n  ToolsEnabled Slides`);
    console.log(`  ├─ dashboard : http://${HOST === '::1' ? '[::1]' : HOST}:${PORT}${dashboardSession.launchPath}`);
    console.log(`  ├─ model     : ${MODEL_PATH}`);
    console.log(`  ├─ pptx      : ${PPTX_PATH}`);
    console.log(`  └─ paused    : ${state.paused}\n`);
  });
}
boot().catch((error) => {
  console.error('ToolsEnabled Slides startup failed:', error && (error.stack || error));
  process.exitCode = 1;
  // Startup never reached listen(); fail deterministically instead of leaving
  // scheduler timers alive in a headless, unusable process.
  setImmediate(() => process.exit(1));
});

// Best-effort graceful shutdown: only reliably reached via Ctrl+C on the
// process actually running `node server.js` (our own restart routine hard-
// kills by pid, which skips this — that path's safety net is the boot-time
// sweepStaleComHost() above, not this handler).
// Only an MCP-owned server uses this private pipe. Persistent studio has no owner.
if (process.env.SLIDES_OWNER_STDIN === '1') {
  process.stdin.once('end', () => process.emit('SIGINT'));
  process.stdin.once('error', () => process.emit('SIGINT'));
  process.stdin.resume();
}
process.on('SIGTERM', () => process.emit('SIGINT'));
process.on('SIGINT', async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  clearTimeout(renderTimer); renderAgain=false; thumbsAgain=false;
  for(const child of capturedChildren)child.kill('SIGKILL');
  if(process.env.SLIDES_WORKSPACE)await require('./lib/renderer').stop();
  const deadline=Date.now()+5000;
  while(capturedChildren.size && Date.now()<deadline)await new Promise(r=>setTimeout(r,25));
  await stopComHost(); process.exit(0);
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use — the suite server may already be running.`);
    process.exit(1);
  }
  throw e;
});

// Defense-in-depth: the coordinator is the single gatekeeper for every editor,
// so it must not die on a stray error. Log and keep serving.
process.on('uncaughtException', (e) => console.error('uncaughtException:', e && e.stack || e));
process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e && e.stack || e));
