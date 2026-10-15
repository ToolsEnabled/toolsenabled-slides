"""Start a local Node child with an explicit environment and Windows lifetime custody."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import threading

ROOT = Path(__file__).resolve().parents[2]
ALLOWED = {'PATH', 'HOME', 'LANG', 'SystemRoot', 'SLIDES_PLUGIN_MODE', 'SLIDES_WORKSPACE',
           'SUITE_PYTHON', 'SUITE_PORT', 'SLIDES_RENDERER', 'SLIDES_SOFFICE'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    choice = parser.add_mutually_exclusive_group(required=True)
    choice.add_argument('--environment')
    choice.add_argument('--inherit-environment', action='store_true')
    parser.add_argument('--owner-pipe', action='store_true')
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if args.owner_pipe and os.name != 'nt':
        raise ValueError('Owner-pipe lifetime custody requires native Windows')
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    if not command or not Path(command[0]).is_absolute() or any('\0' in item for item in command):
        raise ValueError('Use an absolute executable and literal arguments')
    if args.environment is not None:
        if len(args.environment) > 32768:
            raise ValueError('Child environment exceeds its limit')
        env = json.loads(args.environment)
        if not isinstance(env, dict) or any(name not in ALLOWED or not isinstance(value, str) or '\0' in value
                                            for name, value in env.items()):
            raise ValueError('Child environment is not the pane allowlist')
    else:
        env = dict(os.environ)
    # -I -S keeps inherited Python startup variables out of this trusted helper.
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from windows_lifetime import retain_job, wait_descendants
    retain_job()  # Must succeed before any descendant is started.
    child = subprocess.Popen(command, cwd=ROOT, env=env,
                             stdin=subprocess.DEVNULL if args.owner_pipe else None)
    if args.owner_pipe:
        def owner():
            try:
                while sys.stdin.buffer.read(256):
                    pass
            finally:
                os._exit(1)  # Closing the retained job ends only our descendants.
        threading.Thread(target=owner, daemon=True).start()
    result = child.wait()
    if result == 0:
        wait_descendants()
    return result


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
