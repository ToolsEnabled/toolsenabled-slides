# Native Windows 0.1.10 candidate

This is an unpublished engineering candidate. No Windows version is qualified for this candidate: the Windows 10 test host went offline before Slides testing. Windows 11, normal-user installation, Job Object cleanup, LibreOffice rendering and the Claude Code panes still require the acceptance below. Keep using the published Linux release until those gates pass.

The candidate uses native Node.js, a private CPython 3.12 venv and native Windows Job Objects. It needs no WSL, Cygwin, shell translation, service, registry change or administrator installer. Source, wheels and Python are separate verified inputs. The source ZIP contains no venv or binary runtime.

## Inputs and verification

Use Node.js 22+ x64. Obtain the source ZIP `toolsenabled-slides-0.1.10.zip` and `toolsenabled-slides-0.1.10-cp312-windows-amd64-wheels.zip` with their SHA256 files from the release lead's candidate packet. These assets are not published yet. In PowerShell, compare `Get-FileHash -Algorithm SHA256` with each supplied SHA256 file before `Expand-Archive`. Source extracts as `slides/`; wheels extract as `cp312-windows-amd64/`. The installer verifies every source file and all seven wheel inputs again.

Supply an existing full CPython 3.12 installation, or download the exact [Astral python-build-standalone archive](https://github.com/astral-sh/python-build-standalone/releases/download/20261013/cpython-3.12.15%2B20261013-x86_64-pc-windows-msvc-install_only_stripped.tar.gz). Required file: `cpython-3.12.15+20261013-x86_64-pc-windows-msvc-install_only_stripped.tar.gz`,22,019,610 bytes, SHA256 `7a2aef48e5ee569e310b29b32681debbc5d888e92790d85331a47736c6b06aad`. The exact pin is also in `tools/windows-runtime.json`. This is a full portable Python, not python.org's embeddable archive. Its own venv is created with the supplied pinned offline pip wheel; setup does not access PyPI. Python 3.13 does not satisfy this plugin's locked runtime contract.

## Per-user install

Choose a new program path and runtime path below your own Windows profile, an existing private workspace and an extracted wheels directory. Each path must be on local NTFS, with no reparse/junction component. Every existing ancestor must have a trusted owner (you, SYSTEM or Administrators) and no effective outside rule that permits replacing/deleting or changing the ACL/owner of an existing path. Final private directories must be owned by you. The installer refuses existing program/runtime/base/temp directories and never changes an existing directory's ACL. Use another new path for a retry and keep failed attempts for diagnosis.

The default program path is `%LOCALAPPDATA%\ToolsEnabled\Slides\0.1.10`; the default external runtime is `%LOCALAPPDATA%\ToolsEnabled\Slides Runtime\0.1.10`. Portable Python and installer temp use the selected runtime path plus `-base` and `-install-temp`. No PATH, registry or MCP-host setting is edited.

From the extracted source folder in PowerShell:

```powershell
.\install.ps1 -Prefix "$env:LOCALAPPDATA\ToolsEnabled\Slides\0.1.10" -RuntimeDirectory "$env:LOCALAPPDATA\ToolsEnabled\Slides Runtime\0.1.10" -Workspace 'C:\Users\YOURNAME\Decks\Project Update' -WheelsDirectory 'C:\Users\YOURNAME\Downloads\cp312-windows-amd64' -NodeExecutable 'C:\Program Files\nodejs\node.exe' -PythonArchive 'C:\Users\YOURNAME\Downloads\cpython-3.12.15+20261013-x86_64-pc-windows-msvc-install_only_stripped.tar.gz' -Soffice 'C:\Program Files\LibreOffice\program\soffice.com'
```

If script execution is restricted for the current process, use `powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1` followed by those same arguments. `install.cmd` forwards its literal arguments to the same PowerShell installer. To use an existing full interpreter, replace `-PythonArchive ...` with `-BasePython 'C:\absolute\Python312\python.exe'`. The installer prints the complete stdio MCP entry. Copy it into the host you choose. Keep `SLIDES_PLUGIN_MODE=1`, the selected external `SUITE_PYTHON`, private `SLIDES_WORKSPACE` and an unused local port.

An installed native LibreOffice executable is required for PDF and PNG. This candidate neither installs LibreOffice nor opens desktop PowerPoint. Use the explicit `SLIDES_RENDERER=libreoffice` and `SLIDES_SOFFICE` path. PPTX generation itself needs no Office application. The Windows PowerPoint COM/media path is a separate GUI acceptance and remains unqualified. Its legacy COM-host cleanup still uses process-identity queries followed by taskkill, which does not eliminate PID reuse races; do not enable that path until native handle-based custody is implemented and qualified.

The Claude Code GitHub marketplace still tracks published `main`. For exact candidate bytes, use a fresh verified extract as the local marketplace; the Windows plugin-host route and panes require independent acceptance. See [plugin setup](CLAUDE-INSTALL.md). The installer prints an MCP entry without running Claude or modifying its settings.

## Runtime ownership and environment

Normal owning-MCP shutdown closes its private lifetime pipe so the suite can release `.slides-state/server.lock`. Attached clients leave a persistent studio running. The `src/cli/studio.js` entry point also owns a private suite pipe; direct `node src/server.js` bypasses that guardian and is not a qualified Windows entry point. Windows suite and renderer helpers establish unnamed Job Objects before starting descendants, refuse launch if containment fails and retain the only job handle until exit. Renderer timeout and owner EOF end the helper's descendants without enumerating or killing unrelated PIDs. A crash can still leave the conservative workspace lease; never remove a lock until its recorded owner has been independently verified gone.

Windows panes use the configured Python with `-I -S -B` to start the configured absolute Node executable with a fresh allowlisted environment. No shell string is interpreted. Only PATH, HOME, LANG, SystemRoot and the declared Slides settings reach the Node reader/probe. Inherited Node loader hooks and host credential variables are removed before Node starts. Linux continues to use `/usr/bin/env -i`.

## Required native acceptance before release

Use a normal Windows user and fresh folders, following only this document. Record OS/build, Node/Python versions, archive hashes and exact exit/output receipts. Run source verification, installer and runtime doctor; then `node test/run.js` with `SUITE_PYTHON` pointing to the installed `Scripts\python.exe`, private TMP/TEMP paths and `SLIDES_KEEP_TESTS=1`. Keep `SLIDES_TEST_POWERPOINT_COM` unset; full test runner omits the GUI test unless explicitly enabled. Some existing fixtures still assume POSIX executables and need native qualification rather than being silently skipped.

Prove stdio initialization/tool discovery; create/edit/export/import PPTX; PDF and PNG with explicit LibreOffice; same-workspace restart after ordinary EOF; attached-client ownership; abrupt owner exit; timeout ending a detached grandchild; occupied port and lease contention; spaces, apostrophes, Unicode and mixed-case paths; installer refusal of junctions, untrusted ancestor owners, dangerous DACLs and overlapping paths. The authored SDDL fixture in `test/windows/install-acl.test.ps1` must report10passes. Compare hashes of source/state before and after refused operations. A different agent must repeat the documented installation and representative MCP/renderer workflow from a clean folder.

PowerPoint COM testing needs an expressly authorized private desktop session and a separately owned PowerPoint instance. Run `test/windows/export_scripts.test.ps1` only in that setting; it is not part of unattended qualification. Windows 11 requires its own evidence. No candidate is ready to publish until these gates and independent review pass.
