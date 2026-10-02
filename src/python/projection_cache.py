"""Bounded, content-addressed static-image cache in the private workspace state."""
import hashlib
import errno
import time
import json
import shutil
import tempfile
from pathlib import Path
from package_safety import static_png, PNG_SIGNATURE

VERSION = 1
MAX_BYTES = 64 * 1024 * 1024
MAX_ENTRIES = 128

def entry(directory, digest):
    return Path(directory) / f'v{VERSION}-{digest}'

def read(directory, digest):
    if directory is None: return None
    if Path(directory).is_symlink(): return None
    folder = entry(directory, digest)
    try:
        image, receipt = folder / 'image.png', folder / 'receipt.json'
        if folder.is_symlink() or image.is_symlink() or receipt.is_symlink(): return None
        if image.stat().st_size > MAX_BYTES or receipt.stat().st_size > 1024: return None
        meta = json.loads(receipt.read_text()); data = image.read_bytes()
        if (meta == {'version': VERSION, 'sourceSha256': digest, 'outputSha256': hashlib.sha256(data).hexdigest()}
                and data.startswith(PNG_SIGNATURE) and static_png(data, import_limits=False) == data):
            return data
    except (OSError, ValueError): pass
    return None

def sweep_pending(root):
    # Completed writes are atomic and short. Abandoned staging is counted too,
    # so repeated killed writers cannot grow the cache without bound.
    pending = []
    for folder in root.glob('.pending-*'):
        try:
            if folder.is_symlink() or not folder.is_dir(): continue
            age = time.time() - folder.stat().st_mtime
            if age > 300:
                shutil.rmtree(folder, ignore_errors=True)
            else:
                size = sum(p.stat().st_size for p in folder.iterdir() if not p.is_symlink() and p.is_file())
                pending.append((folder.stat().st_mtime, size, folder))
        except OSError: continue
    total = sum(item[1] for item in pending)
    for _, size, folder in sorted(pending):
        if total <= MAX_BYTES: break
        shutil.rmtree(folder, ignore_errors=True); total -= size

def write(directory, digest, data):
    # The cache is only an optimization; an I/O failure must not fail a projection.
    try: _write(directory, digest, data)
    except OSError: pass

def _write(directory, digest, data):
    if directory is None or len(data) > MAX_BYTES: return
    root = Path(directory)
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    if root.is_symlink(): raise ValueError('Projection cache must be a private directory')
    sweep_pending(root)
    temporary = Path(tempfile.mkdtemp(prefix='.pending-', dir=root))
    try:
        (temporary / 'image.png').write_bytes(data)
        (temporary / 'receipt.json').write_text(json.dumps({'version': VERSION, 'sourceSha256': digest,
            'outputSha256': hashlib.sha256(data).hexdigest()}))
        target = entry(root, digest)
        if target.exists():
            if read(root, digest) is not None: return
            if target.is_symlink(): raise ValueError('Invalid projection cache entry')
            shutil.rmtree(target)
        try: temporary.rename(target)
        except OSError as error:
            if error.errno not in (errno.EEXIST, errno.ENOTEMPTY): raise
            # Another preparation published the identical input.
    finally:
        shutil.rmtree(temporary, ignore_errors=True)
    total = count = 0
    for item in sorted(root.glob('v*-*'), key=lambda p: p.name == target.name, reverse=True):
        if item.is_symlink() or not item.is_dir(): continue
        try: size = (item / 'image.png').stat().st_size
        except OSError: continue
        total += size; count += 1
        if total > MAX_BYTES or count > MAX_ENTRIES: shutil.rmtree(item, ignore_errors=True)
