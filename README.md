# ToolsEnabled Slides

Build and edit real PowerPoint presentations from an MCP host while you watch in a local browser. Slides keeps one editable deck model, a live studio, object history, slide locks, and human pause, resume, undo and redo controls.

The MCP host supplies the agent. Slides makes no model calls and has no account, API key, or online service requirement.

New decks use a clean white theme with Arial headings and body text, a blue accent, generous margins and explicit bullet glyphs. Per-element font, color and position settings override the defaults. Imported slides retain their original design.

## Install and start

Requirements: Node.js 22 or newer, Python 3.10 or newer, and the Python packages in `requirements.txt`. PDF and PNG also require LibreOffice Impress, or desktop PowerPoint on Windows. PNG conversion through LibreOffice uses the pinned pypdfium2 wheel.

Works with Claude Code; provides a Claude Desktop bundle that still needs native macOS and Windows qualification through the `toolsenabled-slides` plugin. See [Claude installation](docs/CLAUDE-INSTALL.md) for explicit offline setup into an external CPython 3.12 venv and the separate platform wheel bundles. Source and Desktop bundles contain no wheels or copied venv. ToolsEnabled is not affiliated with or endorsed by Anthropic. [Privacy](https://toolsenabled.ai/legal/privacy/) · [Support](mailto:support@toolsenabled.ai).

Extract the distribution into a directory you own. On Linux or macOS:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install --require-hashes -r requirements.txt
node src/cli/doctor.js
```

On Windows PowerShell:

```powershell
py -m venv .venv
.venv\Scripts\python -m pip install --require-hashes -r requirements.txt
node src/cli/doctor.js
```

Install LibreOffice with `sudo apt-get install libreoffice-impress` on Ubuntu, `brew install --cask libreoffice` on macOS, or `winget install --id TheDocumentFoundation.LibreOffice --exact` on Windows. Set `SLIDES_SOFFICE` to the executable if it is outside PATH. On macOS the app executable is normally `/Applications/LibreOffice.app/Contents/MacOS/soffice`. Doctor reports the selected renderer and missing prerequisites, with installation commands. Nothing installs itself at startup. Helper executables are resolved to absolute paths outside the workspace, with an explicit install-directory working directory; Windows system helpers use System32. Python prerequisite probes use isolated mode.

Start the stdio MCP server with one command:

```sh
node slides-mcp.js
```

The server creates a private workspace at `.slides-workspace` in the current directory, starts the local suite, and prints its studio address to stderr. MCP messages alone use stdout. Open the one-time dashboard URL printed at startup to watch and control editing. A bare `/studio` page can display the deck, but does not authorize human controls. In Claude Code, the human finds startup stderr at `~/.cache/claude-cli-nodejs/<cwd-slug>/mcp-logs-plugin-toolsenabled-slides-slides/<timestamp>.jsonl` (XDG settings may change the base), or in a private absolute `--debug-file` they select. Desktop diagnostics are in `~/Library/Logs/Claude/` on macOS or `%APPDATA%\Claude\logs\` on Windows; native qualification is still pending. Same-user agent file tools can read an unused link, even from mode-600 logs: open it before assigning agent work and never ask the agent to retrieve it.

For a persistent studio that outlives individual MCP sessions, set `SLIDES_WORKSPACE` and run `node src/cli/studio.js`. MCP clients with the same workspace and port attach to it. Clients that attach leave the server running on exit. A suite started by an MCP client exits with that owning client, including abrupt termination, through a private lifetime pipe; attached clients then need to reconnect. If a launch link expires or a dashboard tab loses its session, stop and restart the owning client or persistent studio to receive a fresh launch URL. Saved workspace edits remain.

## Connect your host

Generate the command or configuration for your client:

```sh
node tools/mcp-config.mjs --client claude
node tools/mcp-config.mjs --client codex
node tools/mcp-config.mjs --client cursor
node tools/mcp-config.mjs --client claude-desktop
node tools/mcp-config.mjs --client deepseek
```

The helper prints configuration and does not change host settings. `SLIDES_WORKSPACE` overrides its default `slides-workspace` directory. Claude Code and Codex output is a registration command; Cursor and Claude Desktop output is an `mcpServers` JSON entry; DeepSeek Harness output is an extension configuration. Restart the host after adding the configuration. The optional Codex plugin manifest is included; the registration helper also works independently of plugin support.

Try: “Use Slides to make a three-slide project update. Read the board and outline, lock the slides, then export update.pptx and update.pdf.”

## Work with your deck

Place an existing `.pptx` in the workspace, lock the current slides with `ppt_lock`, and call `ppt_import` with its relative path. Import preserves the source file and creates an editable overlay over a private copy. Human undo restores the previous model. External relationships, macro content types, VBA/OLE/ActiveX relationships and elements, and OLE compound-file signatures are refused before import and rendering. Rendered packages are checked again before publication. Embedded workbooks are unsupported, including ordinary Excel-backed charts. Replace those charts with PNG, JPEG or GIF images before import; existing chart image snapshots remain supported. Imported images must be PNG, JPEG or GIF by decoded content and retain their original bytes, quality, metadata and animation after first-frame decoding and GIF/APNG header/frame-metadata checks within the import budgets. Later animation frames stay encoded in the original media and PPTX exports. PNG msOG embedded animation is refused. For PDF and PNG, a private render copy replaces each animated GIF with a PNG of its first frame at the same dimensions and removes APNG animation chunks; the model and original media stay unchanged. SVG, WMF/EMF, PDF images and imported video are refused. Native video can be added from workspace assets. LibreOffice uses a fresh private profile for each conversion.

Use `ppt_show` for IDs and `ppt_board` for pinned house rules. Lock each affected slide before editing; deck-wide changes require every current slide. The studio can protect slides and individual objects. Pause, resume, undo, redo, explicit dashboard lock overrides and dashboard downloads are not available as MCP tools and require the dashboard session. MCP callers can release only their own locks. Raw HTTP clients running as the same user are outside that identity boundary; locks do not isolate processes that already have local filesystem access. Open the one-time launch URL printed at startup; its fragment secret expires after ten minutes. The page exchanges it by POST for an origin-scoped token in sessionStorage and an HttpOnly cookie. Every human control requires the session header as well as the cookie; a cookie alone is refused. Pause refuses editing and explicit plugin exports; board messages and reads remain available. Pinned prose rules are instructions for the agent; deterministic lint checks provide additional feedback.

`ppt_export` creates a new workspace-relative destination:

- `{"path":"update.pptx","format":"pptx"}` produces a PowerPoint file.
- `{"path":"update.pdf","format":"pdf"}` produces a PDF.
- `{"path":"update-pages","format":"png"}` produces one PNG per slide.

Replies include the captured model revision, renderer and output paths. Existing destinations are refused. Create parent directories first. Filesystem roots, traversal, symlinks and private state paths are not accepted. Images and videos added to the deck must already exist in the workspace's `assets/` directory. Files are processed locally.

## Configuration

| Variable | Purpose |
| --- | --- |
| `SLIDES_WORKSPACE` | Absolute workspace directory. Use one per deck. |
| `SUITE_PORT` | Loopback port, default 4599. Use a different port for each simultaneously open workspace. |
| `SUITE_PYTHON` | Absolute prepared external Python executable required in plugin mode; manual direct mode may use the installation's `.venv`. |
| `SLIDES_RENDERER` | `auto`, `libreoffice`, or `powerpoint`. Auto checks PowerPoint on Windows, then LibreOffice. |
| `SLIDES_SOFFICE` | Path to LibreOffice's `soffice` executable. |

State and imported originals live in `.slides-state` inside the workspace. Keep that directory with the workspace. Only one suite process may own a workspace; a second process refuses startup before reading its model. After a crash, verify the PID in `.slides-state/server.lock` is gone before removing that file. Slides never steals a lease automatically.

## Limits

- Desktop PowerPoint and its COM/pywin32 support are still required to author native object animations and embedded MP4 playback. The studio's motion preview approximates those builds. Static decks, transitions, imports and PPTX/PDF/PNG exports work through the portable path. Export fails clearly when a deck needs an unavailable Windows capability.
- PDF and PNG are static. Fonts, effects, media and complex imported formatting can differ between LibreOffice and PowerPoint. Inspect exported pages before sharing.
- Import accepts up to 32 MiB, 5,000 ZIP members and 128 MiB of expanded data. Both imported and newly edited decks are limited to 200 slides and a 2 MiB model. MCP requests are limited to 1 MiB, queued work to 64 requests / 4 MiB, and text replies to 60,000 characters.
- If pypdfium2 is missing, PNG thumbnails report why they are unavailable; PPTX and PDF remain usable. If LibreOffice and PowerPoint are both missing, only PPTX export works.
- Human undo/redo and slide claims are in memory. Object history, model, board, pause state and protections are durable. Imported originals are retained so history can refer to them; old originals may consume disk space.
- This is a local, single-user application, not a server for untrusted network clients. Host/Origin checks and path confinement protect its APIs; they do not sandbox a host or user that already has filesystem access. Do not expose the port through a tunnel or proxy.

See [all MCP tools](docs/MCP.md), [test instructions](docs/TESTING.md) and [Windows renderer review](docs/COM-REVIEW.md). Licensed under the [MIT License](LICENSE).
