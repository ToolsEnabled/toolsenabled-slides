import hashlib, json, runpy, sys, tempfile, unittest
from pathlib import Path
from unittest import mock
ROOT = Path(__file__).resolve().parents[2]
setup = runpy.run_path(str(ROOT / 'tools/setup-runtime.py'))['setup']

class OfflineRuntime(unittest.TestCase):
    def test_tampered_wheel_is_refused_before_venv_creation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); (root / 'tools').mkdir(); wheels = root / 'wheels'; wheels.mkdir()
            (wheels / 'fixture.whl').write_bytes(b'corrupt')
            (root / 'tools/wheels.json').write_text(json.dumps({'profiles':{'fixture':[{'filename':'fixture.whl','size':7,'sha256':hashlib.sha256(b'correct').hexdigest()}]}}))
            with mock.patch.dict(setup.__globals__, ROOT=root, profile=lambda:'fixture'), mock.patch('venv.EnvBuilder') as builder:
                with self.assertRaisesRegex(ValueError, 'outside'): setup(root / 'runtime', wheels)
                runtime = root.parent / (root.name + '-runtime')
                with self.assertRaisesRegex(ValueError, 'hash mismatch'): setup(runtime, wheels)
                builder.assert_not_called(); self.assertFalse(runtime.exists())

    def test_existing_runtime_is_never_replaced(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); runtime = root / 'runtime'; runtime.mkdir(); marker = runtime / 'keep'; marker.write_text('existing')
            with mock.patch.dict(setup.__globals__, profile=lambda:'fixture'):
                with self.assertRaisesRegex(ValueError, 'already exists'): setup(runtime, root)
            self.assertEqual(marker.read_text(), 'existing')

if __name__ == '__main__': unittest.main()
