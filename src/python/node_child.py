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


class _OwnerPipeHandle:
    """Observe an owned duplicate without touching Python's buffered stdin reader."""
    def __init__(self):
        import ctypes
        import msvcrt
        from ctypes import wintypes as w
        self.ctypes = ctypes
        self.kernel = kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.GetCurrentProcess.restype = w.HANDLE
        kernel.DuplicateHandle.argtypes = [w.HANDLE, w.HANDLE, w.HANDLE, ctypes.POINTER(w.HANDLE),
                                          w.DWORD, w.BOOL, w.DWORD]
        kernel.DuplicateHandle.restype = w.BOOL
        kernel.GetFileType.argtypes = [w.HANDLE]
        kernel.GetFileType.restype = w.DWORD
        kernel.GetHandleInformation.argtypes = [w.HANDLE, ctypes.POINTER(w.DWORD)]
        kernel.GetHandleInformation.restype = w.BOOL
        kernel.PeekNamedPipe.argtypes = [w.HANDLE, ctypes.c_void_p, w.DWORD, ctypes.c_void_p,
                                        ctypes.POINTER(w.DWORD), ctypes.c_void_p]
        kernel.PeekNamedPipe.restype = w.BOOL
        kernel.ReadFile.argtypes = [w.HANDLE, ctypes.c_void_p, w.DWORD,
                                   ctypes.POINTER(w.DWORD), ctypes.c_void_p]
        kernel.ReadFile.restype = w.BOOL
        kernel.CloseHandle.argtypes = [w.HANDLE]
        kernel.CloseHandle.restype = w.BOOL
        self.handle = w.HANDLE()
        process = kernel.GetCurrentProcess()
        if not kernel.DuplicateHandle(process, msvcrt.get_osfhandle(sys.stdin.fileno()), process,
                                      ctypes.byref(self.handle), 0, False, 2):
            raise OSError(ctypes.get_last_error(), 'Cannot retain the Slides owner pipe')
        try:
            flags = w.DWORD()
            if (kernel.GetFileType(self.handle) != 3 or
                    not kernel.GetHandleInformation(self.handle, ctypes.byref(flags)) or flags.value & 1):
                raise OSError('Slides owner input must be a non-inheritable retained pipe')
        except BaseException:
            self.close()
            raise

    def alive(self):
        from ctypes import wintypes as w
        available = w.DWORD()
        if not self.kernel.PeekNamedPipe(self.handle, None, 0, None,
                                         self.ctypes.byref(available), None):
            error = self.ctypes.get_last_error()
            if error in (109, 232):  # Broken pipe / no data: the writer has gone.
                return False
            raise OSError(error, 'Cannot observe the Slides owner pipe')
        if available.value:
            # This helper is the only reader; the child receives DEVNULL. Read at most
            # the bytes already observed, so neither buffered IO nor a blocking read is used.
            buffer = self.ctypes.create_string_buffer(min(available.value, 4096))
            read = w.DWORD()
            if not self.kernel.ReadFile(self.handle, buffer, len(buffer), self.ctypes.byref(read), None):
                error = self.ctypes.get_last_error()
                if error in (109, 232):
                    return False
                raise OSError(error, 'Cannot read the Slides owner pipe')
            if not read.value:
                return False
        return True

    def close(self):
        if self.handle:
            handle, self.handle = self.handle, None
            if not self.kernel.CloseHandle(handle):
                raise OSError(self.ctypes.get_last_error(), 'Cannot release the Slides owner pipe')


def _observe_owner(pipe, stop, lost):
    """Keep observing until explicit normal retirement, or fail closed on owner loss."""
    while not stop.is_set():
        try:
            alive = pipe.alive()
        except OSError:
            lost(1)
            return
        if not alive:
            lost(1)
            return
        stop.wait(0.02)


class OwnerPipe:
    def __init__(self):
        self.pipe = _OwnerPipeHandle()
        self.stop = threading.Event()
        self.thread = threading.Thread(target=_observe_owner,
                                       args=(self.pipe, self.stop, os._exit), daemon=False)

    def start(self):
        # Refuse an already lost owner before creating the child.
        if not self.pipe.alive():
            raise OSError('The Slides owner pipe is already closed')
        self.thread.start()

    def close(self):
        self.stop.set()
        if self.thread.ident is not None:
            self.thread.join(2)
            if self.thread.is_alive():
                os._exit(1)  # Unproved retirement must not become a successful exit.
        self.pipe.close()  # Only our duplicate; never close another shared stdhandle.


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
    owner = OwnerPipe() if args.owner_pipe else None
    try:
        if owner:
            owner.start()
        child = subprocess.Popen(command, cwd=ROOT, env=env,
                                 stdin=subprocess.DEVNULL if args.owner_pipe else None)
        result = child.wait()
        if result == 0:
            wait_descendants()  # The watcher stays live until actual Job accounting settles.
        return result
    finally:
        if owner:
            owner.close()


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
