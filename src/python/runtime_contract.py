"""Shared launch-time validation for the reviewed, explicitly prepared Python runtime."""
import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import subprocess
import sys
ROOT = Path(__file__).resolve().parents[2]

def within(parent, child):
    parent = parent.resolve(); child = child.resolve()
    def folded(value):
        text = os.path.normcase(str(value))
        return text.casefold() if sys.platform in ('darwin', 'win32') else text
    if folded(parent) in [folded(value) for value in (child, *child.parents)]: return True
    if sys.platform in ('darwin', 'win32'):
        for value in (child, *child.parents):
            try:
                if parent.samefile(value): return True
            except OSError: pass
    return False

def plugin_boundary():
    for value in ROOT.parents:
        if value.name == 'cache' and value.parent.name == 'plugins': return value
    if ROOT.parent.name in ('slides', 'toolsenabled-slides') and ROOT.name[:1].isdigit():
        return ROOT.parents[2]  # cache / marketplace / plugin / version
    return ROOT

def check_locations(workspace, runtime, node):
    boundary = plugin_boundary()
    if within(boundary, workspace) or within(workspace, boundary):
        raise ValueError('Workspace must be outside the plugin cache, with no ancestor overlap')
    for left, right in ((runtime, workspace), (runtime, boundary)):
        if within(left, right) or within(right, left):
            raise ValueError('Python runtime must be outside the workspace and plugin cache, with no overlap')
    if within(workspace, node) or within(boundary, node):
        raise ValueError('Node executable must be outside the workspace and plugin cache')

def validate_runtime(node, workspace):
    invoked = sys.orig_argv[0] if getattr(sys, 'orig_argv', None) else ''
    if not Path(invoked).is_absolute() or invoked.startswith('~'): raise ValueError('Python executable must be absolute at invocation')
    if not node.is_absolute() or not workspace.is_absolute(): raise ValueError('Node and workspace paths must be absolute')
    soffice = os.environ.get('SLIDES_SOFFICE', '')
    if soffice and (soffice.startswith('~') or not Path(soffice).is_absolute()): raise ValueError('LibreOffice path must be absolute when configured')
    if os.environ.get('SLIDES_RENDERER', 'auto') not in ('', 'auto', 'libreoffice', 'powerpoint'): raise ValueError('Renderer must be auto, libreoffice or powerpoint')
    selected = Path(sys.executable).absolute()
    if selected == ROOT or ROOT in selected.parents: raise ValueError('Python runtime must be outside the plugin')
    if sys.prefix == sys.base_prefix: raise ValueError('Run explicit offline setup and select its venv Python executable')
    if sys.implementation.name != 'cpython' or sys.version_info[:2] != (3, 12):
        raise ValueError('This offline runtime requires CPython 3.12')
    receipt = json.loads((Path(sys.prefix) / 'slides-runtime.json').read_text())
    if not isinstance(receipt, dict) or receipt.get('version') != 1 or receipt.get('requirementsSha256') != hashlib.sha256((ROOT / 'requirements.txt').read_bytes()).hexdigest():
        raise ValueError('Runtime does not match this release; run explicit offline setup into a new directory')
    expected = {item['package']: item['version'] for item in json.loads((ROOT / 'tools/wheels.json').read_text())['profiles'][receipt['profile']]}
    if receipt.get('packages') != expected or any(importlib.metadata.version(name) != version for name, version in expected.items()):
        raise ValueError('Runtime package versions do not match the reviewed lock')
    node = node.resolve(strict=True); workspace = workspace.resolve()
    if not node.is_file() or not os.access(node, os.X_OK): raise ValueError('Select an executable Node.js file')
    check_locations(workspace, Path(sys.prefix), node)
    version = subprocess.check_output([str(node), '--version'], text=True, timeout=10).strip()
    if not version.startswith('v') or int(version[1:].split('.')[0]) < 22: raise ValueError('Node.js 22 or newer is required')
    return {'python': sys.executable, 'requirementsSha256': receipt['requirementsSha256'], 'profile': receipt['profile']}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--node', type=Path, required=True)
    parser.add_argument('--workspace', type=Path, required=True)
    args = parser.parse_args()
    try: print(json.dumps(validate_runtime(args.node, args.workspace)))
    except (ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError, importlib.metadata.PackageNotFoundError) as error:
        parser.exit(1, str(error) + '; use tools/setup-runtime.py for explicit offline setup\n')
