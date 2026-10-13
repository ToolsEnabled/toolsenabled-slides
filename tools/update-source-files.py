"""Refresh the tracked-path snapshot after staging intended release files."""
import json
import runpy
import subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
listing_image = runpy.run_path(str(ROOT / 'tools/package_inventory.py'))['listing_image']
names = subprocess.check_output(['git', '-C', str(ROOT), 'ls-files', '-z']).decode().rstrip('\0').split('\0')
names = sorted(set([name for name in names if not listing_image(name)] + ['tools/source-files.json']))
(ROOT / 'tools/source-files.json').write_text(json.dumps(names, indent=2) + '\n')
