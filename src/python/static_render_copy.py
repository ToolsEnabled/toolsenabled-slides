"""Create a hash-bound Office input; only this private copy loses GIF animation."""
from process_limits import apply_memory_limit
if __name__ == '__main__':
    apply_memory_limit()

import hashlib
import io
import json
import posixpath
import shutil
import sys
import zipfile
from pathlib import Path
from urllib.parse import unquote
from lxml import etree
from PIL import Image
from package_safety import part_key, package_digest, gif_first_frame, charge_decode, static_png, PNG_SIGNATURE
import projection_cache

def stream_digest(stream):
    stream.seek(0)
    digest = hashlib.sha256()
    while chunk := stream.read(1024 * 1024): digest.update(chunk)
    stream.seek(0)
    return digest.hexdigest()

def xml(data):
    return etree.fromstring(data, etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False, huge_tree=False))

def prepare_render_copy(source, destination, expected_hash, cache_directory=None):
    """Project by content signature; every pixel decode has its own import-sized budget."""
    source, destination = Path(source), Path(destination)
    if source.resolve() == destination.resolve():
        raise ValueError('Static rendering requires a separate private destination')
    created = False
    try:
        with source.open('rb') as original:
            if stream_digest(original) != expected_hash:
                raise ValueError('Render source hash changed before preparation')
            with zipfile.ZipFile(original) as package:
                replacement, images = {}, {}
                gif_parts = 0
                decode_budget = [0]
                occupied = {part_key(i.filename) for i in package.infolist()}
                for item in package.infolist():
                    with package.open(item) as member: signature = member.read(8)
                    is_gif = signature[:6] in (b'GIF87a', b'GIF89a')
                    if not is_gif and signature != PNG_SIGNATURE: continue
                    data = package.read(item)
                    if is_gif:
                        first_frame, frames = gif_first_frame(data, import_limits=True)
                        if frames <= 1: continue
                        gif_parts += 1
                        projected = None
                    else:
                        projected = static_png(data, import_limits=False, strip_embedded=True)
                        if projected == data: continue
                    digest = hashlib.sha256(data).hexdigest()
                    name = f'ppt/media/slides-first-frame-{digest}.png'
                    if name not in images:
                        if part_key(name) in occupied:
                            raise ValueError('Static image part collides with an existing package part')
                        if projected is None:
                            projected = projection_cache.read(cache_directory, digest)
                            if projected is None:
                                with Image.open(io.BytesIO(first_frame)) as image:
                                    charge_decode(image.width, image.height, True, decode_budget)
                                    # Never ask for n_frames/is_animated or seek: those can decode later frames.
                                    frame = image.convert('RGBA')
                                    png = io.BytesIO(); frame.save(png, format='PNG')
                                    projected = png.getvalue()
                                projection_cache.write(cache_directory, digest, projected)
                        images[name] = projected
                    replacement[part_key(item.filename)] = name
                with destination.open('xb') as output:
                    created = True
                    if not replacement:
                        original.seek(0); shutil.copyfileobj(original, output)
                    else:
                        with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as result:
                            for item in package.infolist():
                                if part_key(item.filename) in replacement: continue
                                data = package.read(item)
                                if item.filename == '[Content_Types].xml':
                                    root = xml(data)
                                    for entry in list(root):
                                        if isinstance(entry.tag, str) and part_key(entry.get('PartName', '')) in replacement:
                                            root.remove(entry)
                                    for name in images:
                                        etree.SubElement(root, '{http://schemas.openxmlformats.org/package/2006/content-types}Override', PartName='/'+name, ContentType='image/png')
                                    data = etree.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
                                elif item.filename.lower().endswith('.rels'):
                                    root = xml(data); changed = False
                                    parent = posixpath.dirname(posixpath.dirname(item.filename))
                                    for relation in root:
                                        if not isinstance(relation.tag, str): continue
                                        target = unquote(relation.get('Target', ''))
                                        key = part_key(target if target.startswith('/') else posixpath.join(parent, target))
                                        if key in replacement:
                                            relation.set('Target', '/'+replacement[key] if target.startswith('/') else posixpath.relpath(replacement[key], parent or '.'))
                                            changed = True
                                    if changed: data = etree.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
                                result.writestr(item, data)
                            for name, data in images.items(): result.writestr(name, data, compress_type=zipfile.ZIP_STORED)
            if stream_digest(original) != expected_hash:
                raise ValueError('Render source hash changed during preparation')
        return {'sourceSha256': expected_hash, 'outputSha256': package_digest(destination),
                'gifPartsReplaced': gif_parts, 'rasterPartsReplaced': len(replacement)}
    except Exception:
        if created: destination.unlink(missing_ok=True)
        raise

if __name__ == '__main__':
    print(json.dumps(prepare_render_copy(*sys.argv[1:5])))
