"""Download half of tools/generate-release.py: read a published release file over HTTPS.

It only reads bytes; generate-release.py compares them with the signed file the maintainer supplied and never runs them.
"""
import urllib.request


def read_release(url, limit):
    """Return at most `limit` bytes of the file at `url` (30-second timeout)."""
    with urllib.request.urlopen(url, timeout=30) as response:
        return response.read(limit)
