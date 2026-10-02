"""Launch Slides through the configured external venv; never install packages at runtime."""
import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[2]

def launch(node, workspace, port):
    # Fixed plugin path, independent of caller cwd and PYTHONPATH.
    sys.path.insert(0, str(ROOT / 'src/python'))
    from runtime_contract import validate_runtime
    validate_runtime(node, workspace)
    node = node.resolve(strict=True); workspace = workspace.resolve()
    if not 1024 <= port <= 65535: raise ValueError('Port must be between 1024 and 65535')
    env = {**os.environ, 'SUITE_PYTHON': sys.executable, 'SLIDES_WORKSPACE': str(workspace), 'SUITE_PORT': str(port)}
    command = [str(node), str(ROOT / 'slides-mcp.js')]
    if os.name != 'nt': os.execve(str(node), command, env)
    child = subprocess.Popen(command, env=env)
    def stop(signum, frame):
        if child.poll() is None: child.terminate()
    signal.signal(signal.SIGINT, stop); signal.signal(signal.SIGTERM, stop)
    return child.wait()

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--node', type=Path, required=True)
    parser.add_argument('--workspace', type=Path, required=True)
    parser.add_argument('--port', type=int, default=4599)
    args = parser.parse_args()
    try: sys.exit(launch(args.node, args.workspace, args.port))
    except (ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError, importlib.metadata.PackageNotFoundError) as error:
        parser.exit(1, str(error) + '\n')
