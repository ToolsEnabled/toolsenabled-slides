#!/usr/bin/env python3
"""Build a reproducible source-only mcpb using the supplied unmodified 2.1.2 CLI."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from package_inventory import files

ROOT = Path(__file__).resolve().parents[1]

def build(cli, output):
    cli = cli.resolve(strict=True)
    version = subprocess.check_output(['node', str(cli), '--version'], text=True).strip()
    if version != '2.1.2': raise ValueError('Expected mcpb CLI 2.1.2, got ' + version)
    output = output.resolve(); output.parent.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, 'SOURCE_DATE_EPOCH': '1767225600', 'TZ': 'UTC'}; env.pop('DISPLAY', None)
    with tempfile.TemporaryDirectory(prefix='slides-mcpb-') as directory:
        stage = Path(directory)
        for name, source in files(ROOT):
            target = stage / name; target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target); target.chmod(0o644)
        subprocess.run(['node', '--require', str(ROOT / 'tools/mcpb-clock.cjs'), str(cli),
                        'pack', str(stage), str(output)], env=env, check=True)
    return {'archive': output.name, 'sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
            'bytes': output.stat().st_size, 'mcpb': version, 'signed': False}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mcpb-cli', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(build(args.mcpb_cli, args.output), sort_keys=True))
