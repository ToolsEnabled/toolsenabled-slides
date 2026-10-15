"""Portable owner-observer orchestration; actual pipe/Job APIs have native tests."""
import importlib.util
from pathlib import Path
import sys
import threading
import types
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('slides_node_child', ROOT / 'src/python/node_child.py')
guardian = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guardian)


class Pipe:
    def __init__(self):
        self.closed = False
        self.checks = 0

    def alive(self):
        if self.closed:
            raise AssertionError('Observer used a retired pipe')
        self.checks += 1
        return True

    def close(self):
        self.closed = True


class OwnerPipeTests(unittest.TestCase):
    def test_main_keeps_observer_through_descendant_accounting_and_joins_before_return(self):
        pipe = Pipe()
        events = []
        threads = []
        release_old_reader = threading.Event()
        real_thread = threading.Thread

        def make_thread(*args, **kwargs):
            thread = real_thread(*args, **kwargs)
            threads.append(thread)
            return thread

        def assert_watching():
            self.assertTrue(threads[-1].is_alive())
            self.assertFalse(threads[-1].daemon, 'Owner observer must be joined, never abandoned as a daemon')
            self.assertFalse(pipe.closed)

        def popen(command, **kwargs):
            events.append('child')
            self.assertEqual(events[:2], ['job', 'child'])
            self.assertEqual(kwargs['stdin'], guardian.subprocess.DEVNULL)
            return types.SimpleNamespace(wait=lambda: (assert_watching(), 0)[1])

        def descendants():
            events.append('descendants')
            assert_watching()

        lifetime = types.SimpleNamespace(retain_job=lambda: events.append('job'),
                                         wait_descendants=descendants)
        argv = ['node_child.py', '--inherit-environment', '--owner-pipe', '--', sys.executable, '-V']
        with mock.patch.object(guardian, '_OwnerPipeHandle', return_value=pipe, create=True), \
                mock.patch.object(guardian.threading, 'Thread', side_effect=make_thread), \
                mock.patch.object(sys, 'stdin', types.SimpleNamespace(buffer=types.SimpleNamespace(read=lambda size: (release_old_reader.wait(2), b'')[1]))), \
                mock.patch.object(guardian, 'os', types.SimpleNamespace(name='nt', environ={}, _exit=mock.Mock())), \
                mock.patch.object(guardian.subprocess, 'Popen', side_effect=popen), \
                mock.patch.dict(sys.modules, {'windows_lifetime': lifetime}), mock.patch.object(sys, 'argv', argv):
            try:
                self.assertEqual(guardian.main(), 0)
                guardian.os._exit.assert_not_called()
            finally:
                release_old_reader.set()
                for thread in threads:
                    thread.join(2)
        self.assertEqual(events, ['job', 'child', 'descendants'])
        self.assertTrue(pipe.closed)
        self.assertFalse(threads[0].is_alive())

    def test_closed_owner_refuses_before_child_creation_and_releases_duplicate(self):
        pipe = Pipe()
        pipe.alive = lambda: False
        argv = ['node_child.py', '--inherit-environment', '--owner-pipe', '--', sys.executable]
        lifetime = types.SimpleNamespace(retain_job=mock.Mock(), wait_descendants=mock.Mock())
        with mock.patch.object(guardian, '_OwnerPipeHandle', return_value=pipe), \
                mock.patch.object(guardian, 'os', types.SimpleNamespace(name='nt', environ={}, _exit=mock.Mock())), \
                mock.patch.object(guardian.subprocess, 'Popen') as popen, \
                mock.patch.dict(sys.modules, {'windows_lifetime': lifetime}), mock.patch.object(sys, 'argv', argv):
            with self.assertRaisesRegex(OSError, 'already closed'):
                guardian.main()
            popen.assert_not_called()
        self.assertTrue(pipe.closed)

    def test_eof_and_native_observation_error_fail_closed(self):
        for error in (None, OSError(5, 'Access denied')):
            with self.subTest(error=error):
                pipe = mock.Mock()
                if error:
                    pipe.alive.side_effect = error
                else:
                    pipe.alive.return_value = False
                lost = mock.Mock()
                guardian._observe_owner(pipe, threading.Event(), lost)
                lost.assert_called_once_with(1)

    def test_explicit_retirement_does_not_read_or_signal_owner_loss(self):
        stop = threading.Event()
        stop.set()
        pipe, lost = mock.Mock(), mock.Mock()
        guardian._observe_owner(pipe, stop, lost)
        pipe.alive.assert_not_called()
        lost.assert_not_called()

    def test_join_failure_cannot_report_success_or_close_handle_while_in_use(self):
        pipe = Pipe()
        with mock.patch.object(guardian, '_OwnerPipeHandle', return_value=pipe):
            owner = guardian.OwnerPipe()
        owner.thread = mock.Mock(ident=1)
        owner.thread.is_alive.return_value = True
        with mock.patch.object(guardian.os, '_exit', side_effect=SystemExit(1)) as lost:
            with self.assertRaises(SystemExit):
                owner.close()
            lost.assert_called_once_with(1)
        owner.thread.join.assert_called_once_with(2)
        self.assertFalse(pipe.closed)


if __name__ == '__main__':
    unittest.main()
