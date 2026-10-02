import json, hashlib, sys, tempfile, unittest
from pathlib import Path
from unittest import mock
ROOT = Path(__file__).resolve().parents[2]; sys.path.insert(0, str(ROOT / 'src/python'))
import runtime_contract as contract
class Paths(unittest.TestCase):
    def test_relative_interpreter_invocation_is_refused_before_receipt_reads(self):
        for value in ('python3', './bin/python', '~/runtime/python'):
            with self.subTest(value=value), mock.patch.object(sys, 'orig_argv', [value]), mock.patch.object(Path, 'read_text', side_effect=AssertionError('Receipt reached')):
                with self.assertRaisesRegex(ValueError, 'Python executable.*absolute'):
                    contract.validate_runtime(Path('/usr/local/bin/node'), Path('/tmp/example-deck'))

    def test_workspace_runtime_and_plugin_cache_never_overlap(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder); plugin = base / 'plugins/cache/market/toolsenabled-slides/0.1.0'
            runtime = base / 'runtime'; plugin.mkdir(parents=True); runtime.mkdir()
            with mock.patch.object(contract, 'ROOT', plugin):
                for workspace in (plugin, plugin.parent, base / 'plugins/cache/sibling', runtime, runtime / 'deck', base):
                    with self.subTest(workspace=workspace), self.assertRaisesRegex(ValueError, 'outside|overlap'):
                        contract.check_locations(workspace, runtime, Path('/usr/local/bin/node'))
                contract.check_locations(base / 'decks/project', runtime, Path('/usr/local/bin/node'))

    def test_runtime_receipt_and_installed_versions_fail_closed(self):
        with tempfile.TemporaryDirectory() as folder:
            runtime = Path(folder); receipt = runtime / 'slides-runtime.json'
            profiles = json.loads((ROOT / 'tools/wheels.json').read_text())['profiles']
            profile = next(iter(profiles)); packages = {row['package']: row['version'] for row in profiles[profile]}
            valid = {'version': 1, 'profile': profile, 'requirementsSha256': hashlib.sha256((ROOT / 'requirements.txt').read_bytes()).hexdigest(), 'packages': packages}
            with mock.patch.object(sys, 'prefix', str(runtime)):
                for value in ([], {}, {**valid, 'requirementsSha256': '0' * 64}):
                    receipt.write_text(json.dumps(value))
                    with self.subTest(receipt=value), self.assertRaises(ValueError):
                        contract.validate_runtime(Path('/usr/local/bin/node'), runtime.parent / 'deck')
                receipt.write_text(json.dumps(valid))
                with mock.patch('importlib.metadata.version', return_value='0.0.0'):
                    with self.assertRaisesRegex(ValueError, 'package versions'):
                        contract.validate_runtime(Path('/usr/local/bin/node'), runtime.parent / 'deck')

if __name__ == '__main__': unittest.main()
