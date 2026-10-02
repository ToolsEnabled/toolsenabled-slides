'use strict';
const COLORS = [
  { key: 'blue',    chip: '#2A78D6', ink: '#14417F' },
  { key: 'gold',    chip: '#F1B82D', ink: '#B8860B' },
  { key: 'emerald', chip: '#10B981', ink: '#047857' },
  { key: 'violet',  chip: '#8B5CF6', ink: '#6D28D9' },
];
const PINNED = new Map([['lead', 0], ['worker-1', 1], ['worker-2', 2], ['worker-3', 3]]);
const NON_AGENT = new Set(['human', 'human', 'studio', 'dashboard', '']);

function editorColor(name) {
  if (name == null) return null;
  const k = String(name).toLowerCase();
  if (NON_AGENT.has(k)) return null;                 // humans/pseudo-editors get no chip
  let idx = PINNED.get(k);
  if (idx === undefined) {
    let h = 0;
    for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0;
    idx = h % COLORS.length;
  }
  const c = COLORS[idx];
  return { color: c.chip, ink: c.ink, key: c.key };
}

// Display identities coordinate ordinary clients; dashboard cookies authorize human controls.
function isExternalEditor(name) {
  return /^(?:mcp-|cc-|worker-|media-)/i.test(String(name || '')) || ['lead','root','claude-root','codex-root'].includes(String(name));
}
module.exports = {editorColor, isExternalEditor};
