import hashlib, io, sys, tempfile, unittest, zipfile
from pathlib import Path
from unittest import mock
from PIL import Image
from pptx import Presentation
ROOT = Path(__file__).resolve().parents[2]; sys.path.insert(0, str(ROOT / 'src/python'))
import package_safety as safety
from static_render_copy import prepare_render_copy

def gif():
    out = io.BytesIO()
    Image.new('RGB', (16, 12), 'red').save(out, format='GIF', save_all=True,
        append_images=[Image.new('RGB', (16, 12), 'blue')])
    return out.getvalue()

def with_comment(data, size):
    offset = 13 + (3 * 2 ** ((data[10] & 7) + 1) if data[10] & 128 else 0)
    payload = (b'\xff' + b'x' * 255) * (size // 255) + bytes([size % 255]) + b'x' * (size % 255)
    if size % 255: payload += b'\0'
    return data[:offset] + b'\x21\xfe' + payload + data[offset:]

def package(destination, data, count=1):
    p = io.BytesIO(); Presentation().save(p)
    with zipfile.ZipFile(p) as source, zipfile.ZipFile(destination, 'w') as output:
        for item in source.infolist(): output.writestr(item, source.read(item))
        for index in range(count): output.writestr(f'ppt/fonts/font{index}.fntdata', data + bytes([index]))

class Budgets(unittest.TestCase):
    def test_sniffed_non_media_rasters_are_validated_and_in_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'source.pptx'; package(source, gif())
            self.assertIn(hashlib.sha256(gif() + b'\0').hexdigest(), safety.validate_package(source))

    def test_hidden_large_gif_is_refused_before_pillow_at_import_and_projection(self):
        data = gif(); data = data[:6] + (10000).to_bytes(2, 'little') * 2 + data[10:]
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'source.pptx'; output = Path(directory) / 'render.pptx'; package(source, data)
            with mock.patch('PIL.Image.open', side_effect=AssertionError('pixel decoder must not run')):
                with self.assertRaises(ValueError): safety.validate_package(source)
                with self.assertRaises(ValueError): prepare_render_copy(source, output, safety.package_digest(source))
            self.assertFalse(output.exists())

    def test_large_comments_refused_without_opening_pillow(self):
        data = with_comment(gif(), 2 * 1024 * 1024)
        with mock.patch('PIL.Image.open', side_effect=AssertionError('Pillow must not concatenate comments')):
            with self.assertRaisesRegex(ValueError, 'extension'): safety.gif_metadata(data, True)
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'source.pptx'; package(source, data)
            with self.assertRaises(ValueError): safety.validate_package(source)
            with self.assertRaises(ValueError): prepare_render_copy(source, Path(directory) / 'render.pptx', safety.package_digest(source))

    def test_only_truncated_first_frame_reaches_pixel_decoder(self):
        data = with_comment(gif(), 1024)
        seen = []; original_open = Image.open
        def inspect(stream, *args, **kwargs):
            encoded = stream.getvalue(); seen.append(encoded)
            self.assertNotIn(b'x' * 255, encoded)
            self.assertEqual(safety.gif_metadata(encoded, True), 1)
            return original_open(stream, *args, **kwargs)
        with mock.patch('PIL.Image.open', inspect): self.assertEqual(safety.raster_bytes(data), data)
        self.assertEqual(len(seen), 1)

    def test_projection_aggregate_decode_budget(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'source.pptx'; package(source, gif(), count=2)
            with mock.patch.object(safety, 'MAX_DECODE_PIXELS', 200):
                with self.assertRaisesRegex(ValueError, 'total raster'): prepare_render_copy(source, Path(directory) / 'render.pptx', safety.package_digest(source))

if __name__ == '__main__': unittest.main()
