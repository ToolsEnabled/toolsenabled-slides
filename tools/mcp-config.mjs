import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const usage = 'Usage: node tools/mcp-config.mjs --client <claude|codex|deepseek|cursor|claude-desktop>';
const quote = value => process.platform === 'win32' ? "'" + value.replace(/['\u2018-\u201b]/g, c => c + c) + "'" : "'" + value.replaceAll("'", "'\\''") + "'";
export function clientConfig(client, { root = appRoot, node = process.execPath, dataDir = process.env.SLIDES_WORKSPACE || resolve(process.cwd(), 'slides-workspace'), python = process.env.SUITE_PYTHON || require('../src/lib/prerequisites').python(), port = process.env.SUITE_PORT } = {}) {
  const entry = resolve(root, 'slides-mcp.js');
  const row = { command: node, args: [entry], env: { SLIDES_WORKSPACE: resolve(dataDir) } };
  if (!require('../src/lib/helper-paths').absolutePath(python)) throw new Error('SUITE_PYTHON must be an absolute interpreter path');
  row.env.SUITE_PYTHON = python;
  if (port) row.env.SUITE_PORT = String(port);
  const envArgs = Object.entries(row.env).map(([key,value])=>'--env '+quote(key+'='+value)).join(' ');
  if (client === 'claude' || client === 'claude-code') return `claude mcp add ${envArgs} --transport stdio slides -- ${quote(node)} ${quote(entry)}\n`;
  if (client === 'codex') return `codex mcp add slides ${envArgs} -- ${quote(node)} ${quote(entry)}\n`;
  if (client === 'cursor' || client === 'claude-desktop') return JSON.stringify({ mcpServers: { slides: row } }, null, 2) + '\n';
  if (client === 'deepseek' || client === 'deepseek-harness') return `- id: mcp-slides\n  name: '@deepseek-ai/dsh-mcp-client'\n  config:\n    serverName: slides\n    transport: stdio\n    command: ${JSON.stringify(node)}\n    args: [${JSON.stringify(entry)}]\n    env:\n${Object.entries(row.env).map(([key,value])=>'      '+key+': '+JSON.stringify(value)).join('\n')}\n    toolCallTimeoutMs: 1800000\n`;
  throw new Error(usage);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { if (process.argv.length !== 4 || process.argv[2] !== '--client') throw new Error(usage); process.stdout.write(clientConfig(process.argv[3])); }
  catch { process.stderr.write(usage + '\n'); process.exitCode = 1; }
}
