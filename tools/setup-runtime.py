#!/usr/bin/env python3
"""Explicitly create an external Python runtime from a verified offline wheel bundle."""
import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tempfile
import venv
import zipfile

ROOT = Path(__file__).resolve().parents[1]

def profile():
    if sys.implementation.name != 'cpython' or sys.version_info[:2] != (3, 12):
        raise ValueError('Offline bundles require CPython 3.12; use that interpreter for setup')
    key = (sys.platform, platform.machine().lower())
    profiles = {('linux', 'x86_64'): 'cp312-linux-x86_64', ('darwin', 'arm64'): 'cp312-macos-arm64',
                ('win32', 'amd64'): 'cp312-windows-amd64'}
    if key not in profiles: raise ValueError('No reviewed offline wheel profile for this platform')
    return profiles[key]

def setup(runtime, wheels, pip_wheel=None):
    selected = profile()
    if not runtime.is_absolute() or not wheels.is_absolute(): raise ValueError('Use absolute runtime and wheel paths')
    runtime = runtime.resolve(); wheels = wheels.resolve(strict=True)
    if runtime == ROOT or ROOT in runtime.parents: raise ValueError('Runtime must be outside the plugin directory')
    if runtime.exists(): raise ValueError('Runtime already exists; select a new external directory')
    if not runtime.parent.is_dir(): raise ValueError('Runtime parent must already exist')
    inputs = json.loads((ROOT / 'tools/wheels.json').read_text())['profiles'][selected]
    for item in inputs:
        file = wheels / item['filename']
        if file.is_symlink() or not file.is_file() or file.stat().st_size != item['size']:
            raise ValueError('Missing or invalid wheel: ' + item['filename'])
        if hashlib.sha256(file.read_bytes()).hexdigest() != item['sha256']:
            raise ValueError('Wheel hash mismatch: ' + item['filename'])
    installer = None
    if pip_wheel is not None:
        installer = json.loads((ROOT / 'tools/pip-bootstrap.json').read_text())
        if not pip_wheel.is_absolute() or pip_wheel.is_symlink() or pip_wheel.stat().st_size != installer['size']:
            raise ValueError('Invalid offline pip wheel')
        if hashlib.sha256(pip_wheel.read_bytes()).hexdigest() != installer['sha256']:
            raise ValueError('Offline pip wheel hash mismatch')
    runtime.mkdir(mode=0o700)
    try:
        venv.EnvBuilder(with_pip=pip_wheel is None, symlinks=False).create(runtime)
        python = runtime / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
        with tempfile.TemporaryDirectory(prefix='slides-offline-installer-') as temporary:
            if pip_wheel is not None:
                with zipfile.ZipFile(pip_wheel) as wheel: wheel.extractall(temporary)
                pip = [sys.executable, '-I', str(Path(temporary) / 'pip'), '--isolated',
                       '--disable-pip-version-check', '--python', str(python)]
            else:
                pip = [str(python), '-I', '-m', 'pip', '--isolated', '--disable-pip-version-check']
            subprocess.run(pip + ['install', '--no-index', '--require-hashes', '--only-binary=:all:',
                '--no-cache-dir', '--find-links', str(wheels), '-r', str(ROOT / 'requirements.txt')], check=True)
            subprocess.run(pip + ['check'], check=True)
        expected = {item['package']: item['version'] for item in inputs}
        code = 'import importlib.metadata,json,sys; expected=json.loads(sys.argv[1]); assert all(importlib.metadata.version(k)==v for k,v in expected.items()); import pptx,pypdfium2,PIL,lxml,xlsxwriter,typing_extensions'
        subprocess.run([str(python), '-I', '-c', code, json.dumps(expected)], check=True)
        receipt = {'version': 1, 'profile': selected, 'python': str(python), 'packages': expected,
            'requirementsSha256': hashlib.sha256((ROOT / 'requirements.txt').read_bytes()).hexdigest(),
            'wheels': {item['filename']: item['sha256'] for item in inputs}}
        if installer: receipt['installer'] = installer
        (runtime / 'slides-runtime.json').write_text(json.dumps(receipt, indent=2) + '\n')
        print(json.dumps({'python_executable': str(python), 'profile': selected}))
        return receipt
    except BaseException:
        shutil.rmtree(runtime, ignore_errors=True)
        raise

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', type=Path, required=True)
    parser.add_argument('--wheels', type=Path, required=True)
    parser.add_argument('--pip-wheel', type=Path, help='Explicit verified offline pip wheel for Python installations without ensurepip')
    args = parser.parse_args()
    try: setup(args.runtime, args.wheels, args.pip_wheel)
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        parser.exit(1, str(error) + '\n')
