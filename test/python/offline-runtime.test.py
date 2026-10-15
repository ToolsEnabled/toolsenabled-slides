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

    def test_runtime_creation_precedes_any_venv_or_package_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory); plugin = base / 'plugin'; (plugin / 'tools').mkdir(parents=True)
            wheels = base / 'wheels'; wheels.mkdir(); runtime = base / 'runtime'
            (plugin / 'tools/wheels.json').write_text(json.dumps({'profiles': {'fixture': []}}))
            events = []
            def create(path):
                events.append(('create', path)); path.mkdir(mode=0o700)
            class Builder:
                def __init__(self, **kwargs): pass
                def create(self, path):
                    events.append(('venv', path)); raise RuntimeError('stop before package installation')
            with mock.patch.dict(setup.__globals__, ROOT=plugin, profile=lambda: 'fixture', create_runtime_directory=create), mock.patch('venv.EnvBuilder', Builder):
                with self.assertRaisesRegex(RuntimeError, 'stop before package'): setup(runtime, wheels)
            self.assertEqual(events, [('create', runtime), ('venv', runtime)])

if __name__ == '__main__': unittest.main()
