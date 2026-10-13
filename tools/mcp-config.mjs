import { resolve, dirname, join, delimiter } from 'node:path';
import { realpathSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Name node by the PATH entry that runs this same executable (for example /usr/local/bin/node), not by
// process.execPath, which is the symlink-resolved target a version manager can move. The entry stays
// absolute because desktop clients do not start servers with the shell's PATH.
function pathNode(execPath = process.execPath) {
  let target; try { target = realpathSync(execPath); } catch { return execPath; }
  const names = process.platform === 'win32' ? ['node.exe'] : ['node'];
  for (const dir of String(process.env.PATH || '').split(delimiter)) {
    if (!dir || !dir.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(dir)) continue;
    for (const name of names) {
      const candidate = join(dir, name);
      try { if (statSync(candidate).isFile() && realpathSync(candidate) === target) return candidate; } catch {}
    }
  }
  return execPath;
}
const usage = 'Usage: node tools/mcp-config.mjs --client <claude|codex|deepseek|cursor|claude-desktop>';
const quote = value => process.platform === 'win32' ? "'" + value.replace(/['\u2018-\u201b]/g, c => c + c) + "'" : "'" + value.replaceAll("'", "'\\''") + "'";
export function clientConfig(client, { root = appRoot, node = pathNode(), dataDir = process.env.SLIDES_WORKSPACE || resolve(process.cwd(), 'slides-workspace'), python = process.env.SUITE_PYTHON, port = process.env.SUITE_PORT } = {}) {
  const entry = resolve(root, 'slides-mcp.js');
  const row = { command: node, args: [entry], env: { SLIDES_WORKSPACE: resolve(dataDir) } };
  if (!require('../src/lib/helper-paths').absolutePath(python)) throw new Error('SUITE_PYTHON must name the absolute external interpreter prepared by tools/setup-runtime.py');
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
  catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}
