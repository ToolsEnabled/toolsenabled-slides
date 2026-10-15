import copy
import errno
import importlib.util
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

s = importlib.util.spec_from_file_location('gate', Path(__file__).resolve().parents[2] / 'tools/prove-codex-plugin.py')
gate = importlib.util.module_from_spec(s)
s.loader.exec_module(gate)


class GateTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.scratch = Path(self.temporary.name)
        self.profile = self.scratch / 'isolated-profile'
        self.installed = self.profile / 'plugins/cache/market/slides/version'
        self.installed.mkdir(parents=True)
        self.hidden_error = {'toolsError': 'MCP startup failed: client initialization failed', 'tools': []}

    def listing(self, mode='inline'):
        forwarded = [] if mode == 'no-env' else ['SLIDES_WORKSPACE', 'SUITE_PORT']
        if mode not in ('no-env', 'no-python'):
            forwarded.append('SUITE_PYTHON')
        transport = {'type': 'stdio', 'command': 'node', 'args': ['./slides-mcp.js'],
                     'env': {'SLIDES_PLUGIN_MODE': '1'}, 'env_vars': forwarded, 'cwd': str(self.installed)}
        if mode == 'root-only':
            transport.update(command='${user_config.python_executable}', cwd=None)
        return [{'name': 'slides', 'enabled': True, 'transport': transport}]

    def refusal(self, mode):
        if mode == 'root-only':
            return {'exit': None, 'stderr': 'No such file',
                    'spawnError': {'errno': errno.ENOENT, 'filename': '${user_config.python_executable}'}}
        name = 'SLIDES_WORKSPACE' if mode == 'no-env' else 'SUITE_PYTHON'
        return {'exit': 1, 'spawnError': None, 'stderr': name + ' must be configured; use tools/setup-runtime.py'}

    def test_installed_four_mode_configuration(self):
        for mode in ('inline', 'root-only', 'no-env', 'no-python'):
            with self.subTest(mode=mode):
                listing = self.listing(mode)
                self.assertEqual(gate.installed_transport(mode, listing, self.profile), listing[0]['transport'])

    def test_installed_server_identity_and_shape(self):
        values = [None, [], self.listing() * 2]
        for key, value in [('name', 'unrelated'), ('enabled', False)]:
            listing = self.listing()
            listing[0][key] = value
            values.append(listing)
        listing = self.listing()
        listing[0]['transport']['type'] = 'http'
        values.append(listing)
        for value in values:
            with self.subTest(value=value), self.assertRaises(AssertionError):
                gate.installed_transport('inline', value, self.profile)

    def test_root_only_requires_unresolved_installed_command(self):
        for command in ('node', sys.executable, 'unrelated'):
            listing = self.listing('root-only')
            listing[0]['transport']['command'] = command
            with self.subTest(command=command), self.assertRaises(AssertionError):
                gate.installed_transport('root-only', listing, self.profile)

    def test_inline_command_arguments_and_plugin_mode(self):
        for key, value in [('command', sys.executable), ('args', ['unrelated.js']),
                           ('env', {}), ('env', {'SLIDES_PLUGIN_MODE': '0'})]:
            listing = self.listing()
            listing[0]['transport'][key] = value
            with self.subTest(key=key, value=value), self.assertRaises(AssertionError):
                gate.installed_transport('inline', listing, self.profile)

    def test_installed_cwd_stays_in_isolated_cache(self):
        alias = self.installed / 'outside-alias'
        alias.symlink_to(self.scratch, target_is_directory=True)
        for cwd in ('relative-cache', os.path.relpath(self.installed), str(self.scratch), str(self.profile / 'plugins/cache-other'), str(alias)):
            listing = self.listing()
            listing[0]['transport']['cwd'] = cwd
            with self.subTest(cwd=cwd), self.assertRaises(AssertionError):
                gate.installed_transport('inline', listing, self.profile)

    def test_each_mode_requires_its_actual_forwarding(self):
        for mode in ('inline', 'no-env', 'no-python'):
            for name in ('SLIDES_WORKSPACE', 'SUITE_PYTHON'):
                listing = self.listing(mode)
                forwarded = listing[0]['transport']['env_vars']
                if name in forwarded:
                    forwarded.remove(name)
                else:
                    forwarded.append(name)
                with self.subTest(mode=mode, name=name), self.assertRaises(AssertionError):
                    gate.installed_transport(mode, listing, self.profile)

    def test_transport_environment_obeys_listing_without_inheriting_runtime(self):
        host = {'PATH': 'test-search-path', 'TMPDIR': str(self.scratch), 'SUITE_PYTHON': 'prepared-python',
                'SLIDES_WORKSPACE': 'external-deck', 'SUITE_PORT': 'selected-port',
                'SLIDES_PLUGIN_MODE': '0', 'DISPLAY': 'unused-display', 'UNFORWARDED': 'unused-value'}
        for mode in ('inline', 'no-env', 'no-python'):
            transport = self.listing(mode)[0]['transport']
            env = gate.transport_environment(transport, host)
            expected = {'PATH': 'test-search-path', 'TMPDIR': str(self.scratch), 'SLIDES_PLUGIN_MODE': '1'}
            expected.update({name: host[name] for name in transport['env_vars']})
            self.assertEqual(env, expected)
        self.assertEqual(gate.transport_environment({'env_vars': ['NOT_IN_HOST'], 'env': {'PATH': 'explicit'}}, host)['PATH'], 'explicit')

    def test_host_environment_uses_only_synthetic_profile_and_selected_runtime(self):
        workspace = self.scratch / 'deck'
        python = self.scratch / 'prepared-runtime/bin/python'
        host = {'HOME': 'inherited-home', 'CODEX_HOME': 'inherited-profile', 'DISPLAY': 'inherited-display',
                'SUITE_PYTHON': 'inherited-python', 'SLIDES_WORKSPACE': 'inherited-workspace',
                'SUITE_PORT': 'inherited-port', 'UNFORWARDED': 'unused', 'PATH': 'test-path', 'TMPDIR': str(self.scratch)}
        result = gate.isolated_environment(host, self.profile, workspace, python, 12345)
        self.assertEqual(result, {'HOME': str(self.profile), 'CODEX_HOME': str(self.profile),
                                 'SUITE_PYTHON': str(python), 'SLIDES_WORKSPACE': str(workspace), 'SUITE_PORT': '12345',
                                 'PATH': 'test-path', 'TMPDIR': str(self.scratch)})

    def test_probe_executes_values_from_installed_transport(self):
        transport = {'command': sys.executable, 'args': ['-I', '-c',
                     'import os,sys; print(os.getcwd()); print(os.environ.get("SUITE_PYTHON", "absent")); sys.stderr.write("direct-runtime-refusal"); sys.exit(7)'],
                     'cwd': str(self.installed), 'env_vars': []}
        result = gate.probe_transport(transport, {'SUITE_PYTHON': 'must-not-inherit'}, self.scratch)
        self.assertEqual(result['exit'], 7)
        self.assertEqual(result['stdout'].splitlines(), [str(self.installed), 'absent'])
        self.assertEqual(result['stderr'], 'direct-runtime-refusal')
        self.assertIsNone(result['spawnError'])
        self.assertEqual(result['argv'], [transport['command'], *transport['args']])

    def test_probe_records_actual_missing_command(self):
        transport = {'command': '${user_config.python_executable}', 'cwd': None}
        result = gate.probe_transport(transport, {'PATH': str(self.scratch)}, self.scratch)
        self.assertIsNone(result['exit'])
        if sys.platform == 'win32':
            self.assertEqual(result['spawnError'], {'errno': errno.ENOENT, 'filename': None})
            with self.assertRaisesRegex(AssertionError, 'unresolved command'):
                gate.expected_refusal('root-only', self.hidden_error, result)
        else:
            self.assertEqual(result['spawnError'], {'errno': errno.ENOENT, 'filename': transport['command']})
            self.assertTrue(gate.expected_refusal('root-only', self.hidden_error, result))

    def test_probe_timeout_is_not_a_reasoned_refusal(self):
        with patch.object(gate.subprocess, 'run', side_effect=subprocess.TimeoutExpired('test-command', 30)):
            with self.assertRaises(subprocess.TimeoutExpired):
                gate.probe_transport({'command': 'test-command'}, {}, self.scratch)

    def test_hidden_host_message_uses_actual_direct_cause(self):
        for mode in ('root-only', 'no-env', 'no-python'):
            self.assertTrue(gate.expected_refusal(mode, self.hidden_error, self.refusal(mode)))

    def test_negative_rejects_unrelated_or_successful_direct_result(self):
        for mode in ('root-only', 'no-env', 'no-python'):
            wrong = []
            result = self.refusal(mode)
            if mode == 'root-only':
                for key, value in [('errno', errno.EACCES), ('filename', 'unrelated-command')]:
                    candidate = copy.deepcopy(result)
                    candidate['spawnError'][key] = value
                    wrong.append(candidate)
            else:
                for value in (0, -15, None):
                    candidate = dict(result, exit=value)
                    wrong.append(candidate)
                wrong.append(dict(result, spawnError={'errno': errno.ENOENT, 'filename': 'node'}))
                for text in ('connection timeout', 'unknown error', 'missing unrelated executable'):
                    wrong.append(dict(result, stderr=text))
            for result in wrong:
                with self.subTest(mode=mode, result=result), self.assertRaises(AssertionError):
                    gate.expected_refusal(mode, self.hidden_error, result)

    def test_negative_never_accepts_exposed_tools_or_missing_host_error(self):
        for server in ({'toolsError': 'host failure', 'tools': [{'name': 'ppt_show'}]},
                       {'toolsError': None, 'tools': []}):
            with self.assertRaises(AssertionError):
                gate.expected_refusal('no-env', server, self.refusal('no-env'))

    def test_python_refusal_requires_runtime_setup_guidance(self):
        direct = dict(self.refusal('no-python'), stderr='SUITE_PYTHON unavailable')
        with self.assertRaises(AssertionError):
            gate.expected_refusal('no-python', self.hidden_error, direct)

    def test_profile_is_new_and_reserved_without_reading_existing_contents(self):
        path = self.scratch / 'new'
        if sys.platform != 'linux':
            with patch.object(Path, 'exists', side_effect=AssertionError('Existing profile read reached')):
                with self.assertRaisesRegex(AssertionError, 'Linux-only'):
                    gate.reserve_profile(path)
            return
        self.assertEqual(gate.reserve_profile(path), path)
        self.assertTrue(path.is_dir())
        self.assertEqual(path.stat().st_mode & 0o777, 0o700)
        with self.assertRaises(AssertionError):
            gate.reserve_profile(path)
        with self.assertRaises(AssertionError):
            gate.reserve_profile(Path('relative-profile'))
        signed_in = self.scratch / '.openshell-logins'
        signed_in.mkdir()
        with self.assertRaises(AssertionError):
            gate.reserve_profile(signed_in / 'new')
        alias = self.scratch / 'profile-alias'
        alias.symlink_to(signed_in, target_is_directory=True)
        with self.assertRaises(AssertionError):
            gate.reserve_profile(alias / 'new')


if __name__ == '__main__':
    unittest.main()
