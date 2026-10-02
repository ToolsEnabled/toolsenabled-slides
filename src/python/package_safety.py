"""Validate OPC content before a deck reaches python-pptx or an Office renderer."""
import io
import codecs
import hashlib
import json
import os
import tempfile
from pathlib import Path
import posixpath
from urllib.parse import unquote, urlsplit
import zipfile
import struct
import zlib
import uuid
from PIL import Image
from lxml import etree

PML = 'http://schemas.openxmlformats.org/presentationml/2006/main'
ACTIVE_RELATIONS = {'oleobject', 'package', 'vbaproject', 'vbaprojectsignature',
                    'control', 'activexcontrol', 'activexcontrolbinary'}
EMBEDDED_MESSAGE = 'Unsupported active content: embedded workbooks and objects are not supported. Replace workbook-backed charts with PNG, JPEG or GIF images before import'
CFB = bytes.fromhex('d0cf11e0a1b11ae1')
MAX_XML_BYTES = 2 * 1024 * 1024
# Scale fixtures cover 200 designed slides and a slide with 180 dense freeforms.
MAX_TOTAL_XML_BYTES = 64 * 1024 * 1024
MAX_PART_ELEMENTS = 50000
MAX_PART_ATTRIBUTES = 50000
MAX_TOTAL_ELEMENTS = 2000000
MAX_TOTAL_ATTRIBUTES = 2000000
XML_RELATION_TYPES = {'officedocument', 'slide', 'slidemaster', 'slidelayout', 'theme', 'themeoverride',
                      'notesslide', 'notesmaster', 'handoutmaster', 'presprops', 'viewprops', 'tablestyles',
                      'comments', 'commentauthors', 'customxml', 'chart', 'chartstyle', 'chartcolorstyle'}

def part_key(name):
    return posixpath.normpath('/' + unquote(name).lstrip('/')).casefold()

def looks_like_xml(stream):
    """Inspect the first non-whitespace code point without a truncated byte sample."""
    if isinstance(stream, bytes): stream = io.BytesIO(stream)
    stream.seek(0)
    # XML 1.0 Appendix F signatures supported by some Office XML consumers.
    # Our parser may refuse the encoding; it must still receive the bounded part.
    if stream.read(4) in (b'\x4c\x6f\xa7\x94', b'\x00\x00\x3c\x00', b'\x00\x3c\x00\x00',
                          b'\x00\x00\xff\xfe', b'\xfe\xff\x00\x00'):
        return True
    for encoding in ('utf-8-sig', 'utf-16-be', 'utf-16-le', 'utf-32-be', 'utf-32-le'):
        stream.seek(0)
        decoder = codecs.getincrementaldecoder(encoding)(errors='replace')
        while chunk := stream.read(16384):
            prefix = decoder.decode(chunk).lstrip('\ufeff \t\r\n')
            if prefix:
                if prefix.startswith('<'): return True
                break
    return False

class XMLBudget:
    def __init__(self, totals, import_limits=True):
        self.elements = self.attributes = self.depth = 0
        self.totals = totals
        self.import_limits = import_limits
    def start(self, tag, attributes):
        self.elements += 1; self.attributes += len(attributes); self.depth += 1
        self.totals[0] += 1; self.totals[1] += len(attributes)
        if self.depth > 128 or (self.import_limits and (self.elements > MAX_PART_ELEMENTS or self.attributes > MAX_PART_ATTRIBUTES
                or self.totals[0] > MAX_TOTAL_ELEMENTS or self.totals[1] > MAX_TOTAL_ATTRIBUTES)):
            raise ValueError('XML element/attribute/depth budget exceeded')
    def end(self, tag): self.depth -= 1
    def data(self, value): pass
    def close(self): pass
    def doctype(self, name, public_id, system_id):
        raise ValueError('XML document types are not supported')

def preflight_xml(data, totals, import_limits=True):
    parser = etree.XMLParser(target=XMLBudget(totals, import_limits), resolve_entities=False, no_network=True, load_dtd=False, huge_tree=False)
    try:
        stream = io.BytesIO(data) if isinstance(data, bytes) else data
        while chunk := stream.read(16384): parser.feed(chunk)
        parser.close()
    except etree.XMLSyntaxError as error:
        raise ValueError('XML parse budget or syntax refused') from error

MAX_DECODE_PIXELS = 100000000
MAX_GIF_FRAMES = 10000
VALIDATION_VERSION = 5
PNG_SIGNATURE = b'\x89PNG\r\n\x1a\n'

def static_png(data, import_limits=True, strip_embedded=False):
    """Inspect animation metadata and retain only the default PNG image, without decoding."""
    offset = 8
    kept = [PNG_SIGNATURE]
    changed = False
    frames = declared_frames = 0
    width = height = 0
    while offset + 12 <= len(data):
        size = int.from_bytes(data[offset:offset+4], 'big')
        end = offset + size + 12
        if end > len(data): raise ValueError('Incomplete PNG chunk')
        kind = data[offset+4:offset+8]
        payload = memoryview(data)[offset+8:end-4]
        if zlib.crc32(memoryview(data)[offset+4:end-4]) != int.from_bytes(data[end-4:end], 'big'):
            raise ValueError('Invalid PNG chunk checksum')
        if kind == b'IHDR':
            if size != 13 or width: raise ValueError('Invalid PNG header')
            width, height = struct.unpack('>II', payload[:8])
            if import_limits and width * height > 25000000: raise ValueError('PNG pixel budget exceeded')
        elif kind == b'acTL':
            if size != 8 or declared_frames: raise ValueError('Invalid PNG animation control')
            declared_frames = int.from_bytes(payload[:4], 'big')
            if not declared_frames or (import_limits and declared_frames > MAX_GIF_FRAMES):
                raise ValueError('PNG frame budget exceeded')
        elif kind == b'fcTL':
            if size != 26: raise ValueError('Invalid PNG frame control')
            frames += 1
            w, h, left, top = struct.unpack('>IIII', payload[4:20])
            if not w or not h or left + w > width or top + h > height:
                raise ValueError('PNG frame exceeds canvas')
            if import_limits and (frames > MAX_GIF_FRAMES or w * h > 25000000):
                raise ValueError('PNG animation budget exceeded')
        elif kind == b'msOG' and not strip_embedded:
            raise ValueError('Embedded PNG animation is not supported')
        if kind in (b'acTL', b'fcTL', b'fdAT', b'msOG'):
            changed = True
        else:
            kept.append(data[offset:end])
        offset = end
        if kind == b'IEND':
            if declared_frames != frames: raise ValueError('PNG animation frame count mismatch')
            return b''.join(kept) if changed else data
    raise ValueError('Incomplete PNG image')

MAX_GIF_EXTENSION_BYTES = 1024 * 1024

def gif_first_frame(data, import_limits=True):
    """Scan metadata linearly; retain only the header, frame-zero control and image block."""
    if len(data) < 13 or data[:6] not in (b'GIF87a', b'GIF89a'):
        raise ValueError('incomplete GIF header')
    offset = 13 + (3 * (2 ** ((data[10] & 7) + 1)) if data[10] & 128 else 0)
    header = data[:offset]
    control = first = b''
    frames = extension_bytes = 0
    width = int.from_bytes(data[6:8], 'little')
    height = int.from_bytes(data[8:10], 'little')
    if import_limits and width * height > 25000000:
        raise ValueError('GIF pixel budget exceeded')
    while offset < len(data):
        start = offset
        block = data[offset]; offset += 1
        label = None
        if block == 0x2c:
            if offset + 9 > len(data): break
            frames += 1
            left, top, w, h = [int.from_bytes(data[offset+i:offset+i+2], 'little') for i in (0, 2, 4, 6)]
            width = max(width, left + w); height = max(height, top + h)
            if import_limits and (frames > MAX_GIF_FRAMES or width * height > 25000000):
                raise ValueError('GIF metadata budget exceeded')
            flags = data[offset+8]; offset += 9
            if flags & 128: offset += 3 * (2 ** ((flags & 7) + 1))
            offset += 1  # LZW minimum code size
        elif block == 0x21:
            if offset >= len(data): break
            label = data[offset]; offset += 1
        else:
            break
        while offset < len(data):
            size = data[offset]; offset += 1
            if not size: break
            if label is not None:
                extension_bytes += size
                if extension_bytes > MAX_GIF_EXTENSION_BYTES:
                    raise ValueError('GIF extension budget exceeded')
            offset += size
        if offset > len(data): break  # a later incomplete frame does not invalidate frame zero
        if label == 0xf9 and not frames:
            control = data[start:offset]
        if block == 0x2c and frames == 1:
            first = control + data[start:offset]
    if not first: raise ValueError('Incomplete GIF first frame')
    return header + first + b';', frames

def gif_metadata(data, import_limits):
    return gif_first_frame(data, import_limits)[1]

def charge_decode(width, height, import_limits=True, decode_budget=None):
    pixels = width * height
    if import_limits and pixels > 25000000:
        raise ValueError('raster pixel budget exceeded')
    if decode_budget is not None:
        decode_budget[0] += pixels
        if decode_budget[0] > MAX_DECODE_PIXELS:
            raise ValueError('total raster decode budget exceeded')

def raster_bytes(data, import_limits=True, decode_budget=None):
    if not (data.startswith(b'\x89PNG\r\n\x1a\n') or data.startswith(b'\xff\xd8\xff')
            or data.startswith((b'GIF87a', b'GIF89a'))):
        raise ValueError('Unsupported image: only PNG, JPEG and GIF raster content is accepted')
    try:
        decoded = static_png(data, import_limits) if data.startswith(PNG_SIGNATURE) else data
        if data.startswith((b'GIF87a', b'GIF89a')):
            decoded = gif_first_frame(data, import_limits)[0]
        with Image.open(io.BytesIO(decoded)) as image:
            if image.format not in ('PNG', 'JPEG', 'GIF'):
                raise ValueError('unsupported raster format')
            charge_decode(image.width, image.height, import_limits, decode_budget)
            # Decode only the static projection; the package retains the original bytes.
            image.load()
            return data
    except Exception as error:
        raise ValueError('Unsupported image: raster decoding failed') from error

def binary_kind(data, name, import_limits=True, totals=None):
    """Recognize actual font headers or bounded Windows DEVMODE records, never MIME labels."""
    def font(value):
        if len(value) >= 12 and value[:4] in (b'OTTO', b'\x00\x01\x00\x00', b'true'):
            count = int.from_bytes(value[4:6], 'big')
            if not 0 < count <= 4096 or 12 + count * 16 > len(value): return False
            return all(int.from_bytes(value[i+8:i+12], 'big') + int.from_bytes(value[i+12:i+16], 'big') <= len(value)
                       for i in range(12, 12 + count * 16, 16))
        if value[:4] in (b'wOFF', b'wOF2') and len(value) >= (44 if value[:4] == b'wOFF' else 48):
            return int.from_bytes(value[8:12], 'big') == len(value) and value[14:16] == b'\0\0' and int.from_bytes(value[12:14], 'big') > 0
        # Embedded OpenType: EOTSize, FontDataSize, Version and MagicNumber.
        if len(value) >= 82 and value[34:36] == b'LP':
            return (int.from_bytes(value[:4], 'little') == len(value)
                    and 0 < int.from_bytes(value[4:8], 'little') <= len(value) - 82
                    and int.from_bytes(value[8:12], 'little') in (0x10000, 0x20001, 0x20002))
        return False
    if font(data): return 'font'
    try:
        key = uuid.UUID(Path(name).stem).bytes[::-1]
        decoded = bytes(value ^ key[i % 16] for i, value in enumerate(data[:32])) + data[32:]
        if font(decoded): return 'font'
    except ValueError: pass
    # Mac printer settings: count followed by typed, length-delimited XML plists.
    # The standard Apple external declaration is inert; internal/custom DTDs remain refused.
    if data[:4] == b'\x02\0\0\0':
        if import_limits and len(data) > MAX_XML_BYTES: raise ValueError('XML byte budget exceeded')
        offset = 4
        apple = b'<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
        for record in (1, 2):
            if offset + 8 > len(data): break
            kind, size = struct.unpack_from('<II', data, offset); offset += 8
            if kind != record or offset + size > len(data): break
            payload = data[offset:offset+size]; offset += size
            if not payload.startswith(b'<?xml '): break
            preflight_xml(payload.replace(apple, b'', 1), totals if totals is not None else [0, 0], import_limits)
            root = etree.fromstring(payload.replace(apple, b'', 1), etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False))
            if root.tag != 'plist': break
        else:
            if offset == len(data): return 'printersettings'
    for offset, minimum in ((32, 156), (64, 220)):  # DEVMODEA / DEVMODEW
        if len(data) < minimum: continue
        spec, driver, size, extra = struct.unpack_from('<HHHH', data, offset)
        if spec in (0x300, 0x301, 0x400, 0x401) and minimum <= size <= len(data) and size + extra == len(data):
            return 'printersettings'
    return None

def classify_part(data, name, declared_xml=False, binary_relation=None, import_limits=True, totals=None):
    """One byte-content gate for every part before it can reach an Office consumer."""
    if declared_xml: return 'xml'
    if data.startswith((PNG_SIGNATURE, b'GIF87a', b'GIF89a', b'\xff\xd8\xff')): return 'image'
    kind = binary_kind(data, name, import_limits, totals)
    if kind is not None and kind in (binary_relation or ()):
        return 'binary'
    if looks_like_xml(data):
        if binary_relation: raise ValueError('XML cannot be used as a font or printer part')
        return 'xml'
    raise ValueError('Unsupported image or binary part: only validated PNG/JPEG/GIF, fonts and printer settings are accepted')

def package_digest(source):
    digest = hashlib.sha256()
    with open(source, 'rb') as stream:
        while chunk := stream.read(1024 * 1024): digest.update(chunk)
    return digest.hexdigest()

def record_validation(source, images):
    receipt = Path(str(source) + '.slides-validation.json')
    data = {'version': VALIDATION_VERSION, 'sha256': package_digest(source), 'images': sorted(images)}
    fd, temporary = tempfile.mkstemp(prefix='.validation-', dir=receipt.parent)
    try:
        with os.fdopen(fd, 'w') as stream: json.dump(data, stream)
        os.replace(temporary, receipt)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)

def validate_render_input(source):
    # Only private, content-identical copies reuse import/render validation.
    # These receipts are local state, never accepted from a model or MCP caller.
    try:
        receipt = json.loads(Path(str(source) + '.slides-validation.json').read_text())
        images = receipt['images']
        if (receipt['version'] == VALIDATION_VERSION and receipt['sha256'] == package_digest(source)
                and isinstance(images, list) and all(isinstance(h, str) and len(h) == 64 for h in images)):
            return set(images)
    except (OSError, ValueError, KeyError, TypeError):
        pass
    images = validate_package(source)
    record_validation(source, images)
    return images

def validate_package(source, sanitize_images=False, allow_video=False, import_limits=True, validated_images=()):
    images = set()
    decode_budget = [0] if import_limits else None
    with zipfile.ZipFile(source) as package:
        members = package.infolist()
        if len({part_key(i.filename) for i in members}) != len(members):
            raise ValueError('Duplicate package members are not supported')
        if import_limits and (len(members) > 5000 or sum(i.file_size for i in members) > 128 * 1024 * 1024):
            raise ValueError('PPTX expands beyond the import limit')
        total_xml_bytes = 0
        totals = [0, 0]
        for item in members:
            if item.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                raise ValueError('Unsupported package compression')
            if import_limits and item.file_size > 1024 * 1024 and item.file_size > max(1, item.compress_size) * 200:
                raise ValueError('Package compression ratio exceeds limit')
            if item.filename.lower().endswith(('.xml', '.rels')):
                total_xml_bytes += item.file_size
                if import_limits and (item.file_size > MAX_XML_BYTES or total_xml_bytes > MAX_TOTAL_XML_BYTES):
                    raise ValueError('XML byte budget exceeded')
                with package.open(item) as stream:
                    preflight_xml(stream, totals, import_limits)
        content_root = etree.fromstring(package.read('[Content_Types].xml'), etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False, huge_tree=False))
        defaults = {e.get('Extension', '').lower(): e.get('ContentType', '').lower() for e in content_root if isinstance(e.tag, str) and e.tag.endswith('}Default')}
        overrides = {part_key(e.get('PartName', '')): e.get('ContentType', '').lower() for e in content_root if isinstance(e.tag, str) and e.tag.endswith('}Override')}
        image_targets = set()
        xml_targets = set()
        binary_targets = {}
        relationships = {}
        validated_targets = set()
        blip_targets = set()
        for item in members:
            if not item.filename.lower().endswith('.rels'):
                continue
            rels = etree.fromstring(package.read(item), etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False, huge_tree=False))
            for relation in rels:
                if not isinstance(relation.tag, str):
                    continue
                target = unquote(relation.get('Target', ''))
                if urlsplit(target).scheme or target.startswith('//') or '\\' in target:
                    raise ValueError('External links must be removed before import')
                relation_type = relation.get('Type', '').rsplit('/', 1)[-1].lower()
                parent = posixpath.dirname(posixpath.dirname(item.filename))
                key = part_key(posixpath.join(parent, target))
                if relation_type == 'image': image_targets.add(key)
                if relation_type in XML_RELATION_TYPES: xml_targets.add(key)
                if relation_type in ('font', 'printersettings'): binary_targets.setdefault(key, set()).add(relation_type)
                owner = posixpath.join(parent, posixpath.basename(item.filename)[:-5])
                relationships[(part_key(owner), relation.get('Id'))] = key
        for item in members:
            name = item.filename.lower()
            with package.open(item) as stream: signature = stream.read(8)
            if '/embeddings/' in name:
                raise ValueError(EMBEDDED_MESSAGE)
            if (any(s in name for s in ('vbaproject', '/activex/'))
                    or signature.startswith(CFB)):
                raise ValueError('Unsupported active content: macros, OLE or ActiveX')
            key = part_key(item.filename)
            content_type = overrides.get(key, defaults.get(name.rsplit('.', 1)[-1], ''))
            data = package.read(item)
            declared_xml = (name.endswith(('.xml', '.rels')) or content_type.endswith(('+xml', '/xml')) or key in xml_targets)
            video = allow_video and content_type in ('video/mp4', 'video/unknown') and data[4:8] == b'ftyp'
            kind = 'video' if video else classify_part(data, item.filename, declared_xml, binary_targets.get(key), import_limits, totals)
            if key in binary_targets and kind == 'xml':
                raise ValueError('XML cannot be used as a font or printer part')
            if key in image_targets or content_type.startswith('image/') or '/media/' in name:
                if kind not in ('image', 'video'): raise ValueError('Unsupported image: relationship target is not a validated raster')
            if kind == 'image':
                digest = hashlib.sha256(data).hexdigest()
                if digest not in validated_images: raster_bytes(data, import_limits, decode_budget)
                images.add(digest)
                validated_targets.add(key)
                if content_type.startswith('image/') and content_type not in ('image/png', 'image/jpeg', 'image/gif'):
                    raise ValueError('Unsupported image content type')
            if kind == 'binary' and 'printersettings' in binary_targets.get(key, ()):
                total_xml_bytes += item.file_size
                if import_limits and (item.file_size > MAX_XML_BYTES or total_xml_bytes > MAX_TOTAL_XML_BYTES):
                    raise ValueError('XML byte budget exceeded')
            if kind != 'xml': continue
            if not name.endswith(('.xml', '.rels')):
                total_xml_bytes += item.file_size
                if import_limits and (item.file_size > MAX_XML_BYTES or total_xml_bytes > MAX_TOTAL_XML_BYTES):
                    raise ValueError('XML byte budget exceeded')
                preflight_xml(data, totals, import_limits)
            # A DOM is allocated only after the whole part passed streaming caps.
            data = package.read(item)
            parser = etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False, huge_tree=False)
            root = etree.fromstring(data, parser)
            if root.tag == '{http://www.w3.org/2000/svg}svg' or root.tag == 'svg':
                raise ValueError('Unsupported image: SVG is not an accepted raster format')
            if root.getroottree().docinfo.doctype:
                raise ValueError('XML document types are not supported')
            for node in root.iter():
                if not isinstance(node.tag, str):
                    continue
                if node.tag == '{http://schemas.openxmlformats.org/drawingml/2006/main}blip':
                    for attr in ('embed', 'link'):
                        rid = node.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}' + attr)
                        if rid is not None: blip_targets.add(relationships.get((key, rid)))
                if node.tag in (f'{{{PML}}}oleObj', f'{{{PML}}}control'):
                    raise ValueError('Unsupported active content: embedded object or control')
                content_type = node.get('ContentType', '').lower()
                if (any(t in content_type for t in ('macroenabled', 'vbaproject', 'oleobject', 'activex'))
                        or any(t in content_type for t in ('template.main', 'slideshow.main'))):
                    raise ValueError('Unsupported active content: package content type')
                if str(node.tag).endswith('}Relationship'):
                    if node.get('Type', '').rsplit('/', 1)[-1].lower() == 'package':
                        raise ValueError(EMBEDDED_MESSAGE)
                    if node.get('Type', '').rsplit('/', 1)[-1].lower() in ACTIVE_RELATIONS:
                        raise ValueError('Unsupported active content: package relationship')
                    if node.get('TargetMode', '').lower() == 'external':
                        raise ValueError('External links must be removed before import')

        if not (image_targets | blip_targets) <= validated_targets:
            raise ValueError('Image reference must resolve to a validated raster part')
    return images
