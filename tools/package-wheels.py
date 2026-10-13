#!/usr/bin/env python3
"""Package supplied, hash-verified wheels as separate platform-specific offline inputs."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]

def build(inputs, output, pip_wheel):
    output.mkdir(parents=True, exist_ok=True)
    metadata = json.loads((ROOT / 'tools/wheels.json').read_text())
    installer = json.loads((ROOT / 'tools/pip-bootstrap.json').read_text())
    installer_data = pip_wheel.read_bytes()
    if pip_wheel.is_symlink() or len(installer_data) != installer['size'] or hashlib.sha256(installer_data).hexdigest() != installer['sha256']:
        raise ValueError('Offline installer wheel hash/size mismatch')
    results = []
    for profile, wheels in metadata['profiles'].items():
        payloads = {}
        for wheel in wheels:
            file = inputs / wheel['filename']
            if file.is_symlink(): raise ValueError('Wheel symlinks are not supported')
            data = file.read_bytes()
            if len(data) != wheel['size'] or hashlib.sha256(data).hexdigest() != wheel['sha256']:
                raise ValueError('Wheel hash/size mismatch: ' + file.name)
            payloads[file.name] = data
        payloads[installer['filename']] = installer_data
        payloads['WHEELS.json'] = (json.dumps({'profile': profile, 'wheels': wheels, 'installer': installer}, indent=2) + '\n').encode()
        payloads['SHA256SUMS'] = ''.join(hashlib.sha256(data).hexdigest() + '  ' + name + '\n' for name, data in sorted(payloads.items())).encode()
        archive = output / f'toolsenabled-slides-0.1.4-{profile}-wheels.zip'
        with zipfile.ZipFile(archive, 'w') as bundle:
            for name, data in sorted(payloads.items()):
                info = zipfile.ZipInfo(profile + '/' + name, date_time=(2026, 1, 1, 0, 0, 0)); info.create_system = 3
                info.external_attr = 0o100644 << 16; info.compress_type = zipfile.ZIP_STORED
                bundle.writestr(info, data)
        results.append({'profile': profile, 'file': archive.name, 'bytes': archive.stat().st_size,
                        'sha256': hashlib.sha256(archive.read_bytes()).hexdigest()})
    return results

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--pip-wheel', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(build(args.input, args.output, args.pip_wheel), indent=2))
