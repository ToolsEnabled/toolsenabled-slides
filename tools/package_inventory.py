"""Shared allowlist for source ZIPs and the source-only Desktop bundle."""
import json
import subprocess
from pathlib import Path, PurePosixPath

ALLOWED = {'.js', '.cjs', '.mjs', '.ts', '.tsx', '.py', '.ps1', '.md', '.json', '.html', '.css', '.txt', '.base64'}
EXCLUDED = {'.git', '.venv', 'node_modules', 'data', '.slides-state', '.slides-workspace', 'dist', '__pycache__'}
ROOTS = {'README.md', 'LICENSE', 'SECURITY.md', 'CHANGELOG.md', 'package.json', 'requirements.txt',
         'slides-mcp.js', '.mcp.json', '.gitignore', 'manifest.json'}
DIRECTORIES = {'src', 'public', 'scripts', 'test', 'docs', 'tools', '.codex-plugin', '.claude-plugin', '.agents', 'skills', 'hooks', 'commands'}

def files(root):
    root = Path(root).resolve()
    try:
        probe = subprocess.run(['git', '-C', str(root), 'rev-parse', '--show-toplevel'], capture_output=True, text=True)
        checkout = probe.returncode == 0 and Path(probe.stdout.strip()).resolve() == root
    except FileNotFoundError:
        if (root / '.git').exists(): raise ValueError('Git is required to verify a release checkout')
        checkout = False
    snapshot = json.loads((root / 'tools/source-files.json').read_text())
    if checkout:
        names = subprocess.check_output(['git', '-C', str(root), 'ls-files', '-z']).decode().rstrip('\0').split('\0')
        if sorted(names) != snapshot: raise ValueError('Tracked source snapshot does not match the checkout inventory')
        clean = subprocess.run(['git', '-C', str(root), 'diff-index', '--quiet', 'HEAD', '--'])
        if clean.returncode: raise ValueError('Release inputs must be clean; commit all tracked source changes first')
    else:
        # Exact source archives carry the tracked-path snapshot; never discover local extras.
        names = snapshot
    if not isinstance(names, list) or any(not isinstance(name, str) for name in names) or len(set(names)) != len(names):
        raise ValueError('Invalid source file inventory')
    result = []
    for name in names:
        rel = PurePosixPath(name)
        if not name or rel.is_absolute() or '..' in rel.parts or '\\' in name: raise ValueError('Unsafe source file path')
        if rel.parts[0] not in DIRECTORIES and name not in ROOTS: continue
        if any(part in EXCLUDED for part in rel.parts) or rel.name == 'server.json': continue
        file = root / name
        if file.is_symlink() or any(parent.is_symlink() for parent in file.parents if parent != root and root in parent.parents):
            raise ValueError('Symlinks are not supported in release inputs: ' + name)
        # Stock mcpb omits .gitignore. It is absent only in that extracted source form.
        if not checkout and name == '.gitignore' and not file.exists(): continue
        if not file.is_file(): raise ValueError('Missing tracked source file: ' + name)
        if file.suffix in ALLOWED or file.name in {'.gitignore', 'LICENSE'}:
            if file.name.startswith('warm') or file.name == 'agent-settings.json': continue
            result.append((name, file))
    return sorted(result)
