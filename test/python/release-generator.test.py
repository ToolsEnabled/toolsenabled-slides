"""Offline release-generator regressions; fixtures do not qualify a signed release."""
import contextlib
import io
import json
from pathlib import Path
import runpy
import tempfile
import unittest
from unittest import mock
import zipfile


SCRIPT = Path(__file__).resolve().parents[2] / 'tools/generate-release.py'
GENERATE = runpy.run_path(str(SCRIPT))['generate']
DESCRIPTION = 'Create and edit local PowerPoint decks with a live studio, slide locks and portable exports.'


class DescriptionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='release-description-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'source'
        self.source.mkdir()
        self.output = self.root / 'sidecars'
        self.repository = 'https://github.com/ToolsEnabled/toolsenabled-slides'
        self.tag = 'v0.1.0'
        self.commit = '1' * 40
        self.manifest = {'name': 'toolsenabled-slides', 'version': '0.1.0', 'description': 'x' * 101}
        payload = io.BytesIO()
        with zipfile.ZipFile(payload, 'w') as archive:
            archive.writestr('manifest.json', json.dumps(self.manifest))
        # Only the existing identity/byte checks are exercised; this is not a signature.
        self.payload = payload.getvalue() + b'MCPB_SIG_END'
        self.signed = self.root / 'fixture.mcpb'
        self.signed.write_bytes(self.payload)
        self.url = self.repository + '/releases/download/' + self.tag + '/fixture.mcpb'
        self.addCleanup(mock.patch.stopall)
        mock.patch('subprocess.check_output', side_effect=self.git).start()
        self.download = mock.patch('urllib.request.urlopen', side_effect=lambda *a, **k: io.BytesIO(self.payload)).start()

    def git(self, argv, **kwargs):
        if argv[1] == 'ls-remote':
            return self.commit + '\trefs/tags/' + self.tag + '\n'
        if argv[1] == 'show':
            return json.dumps(self.manifest).encode()
        if argv[1] == 'rev-parse':
            return ('2' * 40 + '\n').encode()
        raise AssertionError('Unexpected git fixture operation')

    def generate(self, **kwargs):
        return GENERATE(self.source, self.repository, self.tag, self.commit,
                        self.signed, self.url, self.output, **kwargs)

    def emitted_description(self):
        return json.loads((self.output / 'server.json').read_text())['description']

    def test_long_default_requires_explicit_description_before_download_or_output(self):
        with self.assertRaisesRegex(ValueError, '--description'):
            self.generate()
        self.download.assert_not_called()
        self.assertFalse(self.output.exists())

    def test_reviewed_description_cli_is_used_verbatim(self):
        argv = [str(SCRIPT), '--source', str(self.source), '--repository', self.repository,
                '--tag', self.tag, '--commit', self.commit, '--signed-mcpb', str(self.signed),
                '--release-url', self.url, '--output', str(self.output), '--description', DESCRIPTION]
        with mock.patch('sys.argv', argv), contextlib.redirect_stdout(io.StringIO()):
            runpy.run_path(str(SCRIPT), run_name='__main__')
        self.assertEqual(self.emitted_description(), DESCRIPTION)

    def test_short_default_and_explicit_boundary_preserve_text(self):
        for index, value in enumerate(['A', 'é' * 100, 'A  complete description.']):
            with self.subTest(value=value):
                self.output = self.root / ('default-' + str(index))
                self.manifest['description'] = value
                self.generate()
                self.assertEqual(self.emitted_description(), value)
                self.output = self.root / ('explicit-' + str(index))
                self.manifest['description'] = 'x' * 101
                self.generate(description=value)
                self.assertEqual(self.emitted_description(), value)

    def test_invalid_override_fails_instead_of_falling_back(self):
        self.manifest['description'] = DESCRIPTION
        for value in ['', '   ', 'x' * 101, 42, False, []]:
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    self.generate(description=value)
                self.assertFalse(self.output.exists())
        self.download.assert_not_called()


    def test_wrong_remote_tag_is_refused_before_output(self):
        with mock.patch('subprocess.check_output', return_value='9' * 40 + '\trefs/tags/v0.1.0\n'):
            with self.assertRaisesRegex(ValueError, 'Remote tag'): self.generate(description=DESCRIPTION)
        self.download.assert_not_called(); self.assertFalse(self.output.exists())

    def test_downloaded_bytes_must_equal_the_supplied_signed_artifact(self):
        self.download.side_effect = lambda *a, **k: io.BytesIO(self.payload + b'mutation')
        with self.assertRaisesRegex(ValueError, 'Downloaded release bytes'): self.generate(description=DESCRIPTION)
        self.assertFalse(self.output.exists())

if __name__ == '__main__':
    unittest.main()
