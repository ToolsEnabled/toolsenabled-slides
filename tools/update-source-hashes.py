"""Hash the clean committed payload after staging and committing source-file inventory."""
import hashlib, json, subprocess
from pathlib import Path
from package_inventory import files
ROOT = Path(__file__).resolve().parents[1]
entries = []
for name, path in files(ROOT):
    if name == 'tools/source-hashes.json':
        continue
    data = path.read_bytes()
    entries.append({'path': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
record = {'plugin': 'toolsenabled-slides', 'version': json.loads((ROOT / 'package.json').read_text())['version'],
          'sourceCommit': subprocess.check_output(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], text=True).strip(),
          'files': entries}
(ROOT / 'tools/source-hashes.json').write_text(json.dumps(record, indent=2) + '\n')
print('Hashed', len(entries), 'payload files; checksum list excludes itself')
