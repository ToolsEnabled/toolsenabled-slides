"""The read-only network halves of the release tools, against a server on 127.0.0.1 that this test starts.

tools/release_fetch.py (used by tools/generate-release.py) and tools/local_health.py (used by
tools/prove-codex-plugin.py) only read; the tools that run programs open no URL themselves.
"""
import http.server
import json
from pathlib import Path
import runpy
import threading
import unittest

TOOLS = Path(__file__).resolve().parents[2] / 'tools'
read_release = runpy.run_path(str(TOOLS / 'release_fetch.py'))['read_release']
read_health = runpy.run_path(str(TOOLS / 'local_health.py'))['read_health']


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps({'service': 'toolsenabled-slides', 'pid': 2}).encode() if self.path == '/api/health' else b'0123456789'
        self.send_response(200)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


class ReleaseHelpers(unittest.TestCase):
    def setUp(self):
        self.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.port = self.server.server_address[1]

    def test_read_release_returns_at_most_the_limit(self):
        url = 'http://127.0.0.1:' + str(self.port) + '/asset'
        self.assertEqual(read_release(url, 4), b'0123')
        self.assertEqual(read_release(url, 64), b'0123456789')

    def test_read_health_parses_the_local_answer(self):
        self.assertEqual(read_health(self.port), {'service': 'toolsenabled-slides', 'pid': 2})

    def test_the_tools_that_run_programs_open_no_url_themselves(self):
        for name in ('generate-release.py', 'prove-codex-plugin.py'):
            text = (TOOLS / name).read_text()
            self.assertNotIn('urllib', text, name)
            self.assertNotIn('urlopen', text, name)


if __name__ == '__main__':
    unittest.main()
