"""Health half of tools/prove-codex-plugin.py: read the local Slides server's /api/health on 127.0.0.1.

It only reads the JSON answer; the gate checks it and starts no program from it.
"""
import json
import urllib.request


def read_health(port):
    """Return the parsed /api/health answer of the server on 127.0.0.1:`port` (1-second timeout)."""
    with urllib.request.urlopen('http://127.0.0.1:' + str(port) + '/api/health', timeout=1) as response:
        return json.load(response)
