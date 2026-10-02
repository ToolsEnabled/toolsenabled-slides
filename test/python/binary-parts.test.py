import io, sys, tempfile, unittest, zipfile
from pathlib import Path
from pptx import Presentation
ROOT = Path(__file__).resolve().parents[2]; sys.path.insert(0, str(ROOT / 'src/python'))
from package_safety import validate_package

def deck(path, content_type, value, relation='font'):
    original = io.BytesIO(); Presentation().save(original)
    with zipfile.ZipFile(original) as source, zipfile.ZipFile(path, 'w') as result:
        for item in source.infolist():
            data = source.read(item)
            if item.filename == '[Content_Types].xml':
                data = data.replace(b'</Types>', f'<Override PartName="/ppt/binary.dat" ContentType="{content_type}"/></Types>'.encode())
            if item.filename == 'ppt/_rels/presentation.xml.rels':
                data = data.replace(b'</Relationships>', f'<Relationship Id="rIdExtra" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/{relation}" Target="binary.dat"/></Relationships>'.encode())
            result.writestr(item, data)
        result.writestr('ppt/binary.dat', value)

class BinaryParts(unittest.TestCase):
    def test_only_real_binary_font_and_printer_headers_are_accepted(self):
        import struct
        font = b'OTTO' + struct.pack('>HHHH', 1, 16, 0, 0) + b'head' + struct.pack('>III', 0, 28, 4) + b'font'
        printer = bytearray(220); printer[:4] = b'<\x00A\x00'; struct.pack_into('<HHHH', printer, 64, 0x401, 1, 220, 0)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'deck.pptx'
            for relation, value in [('font', font), ('printerSettings', printer)]:
                deck(path, 'application/octet-stream', value, relation); validate_package(path)
            for prefix in (b'<', b' <', b'\x00<'):
                deck(path, 'application/x-fontdata', prefix + b'\xff\x80binary data')
                with self.assertRaises(ValueError): validate_package(path)

    def test_theme_relationship_cannot_use_font_content_type_to_bypass_xml_checks(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'deck.pptx'
            deck(path, 'application/x-fontdata', b'<root>' + b'<n/>' * 50001 + b'</root>', 'theme')
            with self.assertRaises(ValueError): validate_package(path)

if __name__ == '__main__': unittest.main()
