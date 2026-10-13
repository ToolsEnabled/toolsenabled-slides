# ToolsEnabled Slides

Build and edit real PowerPoint presentations from an MCP host while you watch in a local browser. Slides keeps one editable deck model, a live studio, object history, slide locks, and human pause, resume, undo and redo controls.

The MCP host supplies the agent. Slides makes no model calls and has no account, API key, or online service requirement.

New decks use a clean white theme with Arial headings and body text, a blue accent, generous margins and explicit bullet glyphs. Per-element font, color and position settings override the defaults. Imported slides retain their original design.

## Install and start

**Linux tested; native Windows not yet supported.** This release is scoped to Linux. Native Windows qualification found that normal shutdown leaves the workspace lease behind, preventing a second session. Windows renderer/setup fixes and native macOS/Desktop qualification are pending.

Requirements: Node.js 22 or newer, Python 3.10 or newer, and the Python packages in `requirements.txt`. PDF and PNG on Linux also require LibreOffice Impress. PNG conversion through LibreOffice uses the pinned pypdfium2 wheel.

Works with Claude Code on Linux through the `toolsenabled-slides` plugin; the repository is its own plugin marketplace for Claude Code (`.claude-plugin/marketplace.json`) and Codex (`.agents/plugins/marketplace.json`). See [plugin installation](docs/CLAUDE-INSTALL.md) for the install commands and the explicit offline setup of an external CPython 3.12 venv from the Linux wheel bundle, which was published with 0.1.0 and is unchanged for 0.1.2: [toolsenabled-slides-0.1.0-cp312-linux-x86_64-wheels.zip](https://github.com/ToolsEnabled/toolsenabled-slides/releases/download/v0.1.0/toolsenabled-slides-0.1.0-cp312-linux-x86_64-wheels.zip), SHA-256 `a29454931420b8d9547eeb8d17c389a005cf0343a927d7a275f15eb3cab25fec`. No Claude Desktop bundle (`.mcpb`) is distributed with this release; `manifest.json` is an MCPB manifest kept for future Desktop qualification. The source ZIP contains no wheels or copied venv. ToolsEnabled is not affiliated with or endorsed by Anthropic. [Privacy](https://toolsenabled.ai/legal/privacy/) · [Support](mailto:support@toolsenabled.ai).

Download the source ZIP and its `.sha256` file from the [v0.1.2 release](https://github.com/ToolsEnabled/toolsenabled-slides/releases/tag/v0.1.2), verify the ZIP, and extract it (it unpacks to `slides/`) into a directory you own. On Linux:

```sh
curl -LO https://github.com/ToolsEnabled/toolsenabled-slides/releases/download/v0.1.2/toolsenabled-slides-0.1.2.zip
curl -LO https://github.com/ToolsEnabled/toolsenabled-slides/releases/download/v0.1.2/toolsenabled-slides-0.1.2.zip.sha256
sha256sum -c toolsenabled-slides-0.1.2.zip.sha256
unzip toolsenabled-slides-0.1.2.zip && cd slides
python3 -m venv .venv
.venv/bin/python -m pip install --require-hashes -r requirements.txt
node src/cli/doctor.js
```

Install LibreOffice with `sudo apt-get install libreoffice-impress` on Ubuntu. Set `SLIDES_SOFFICE` to the executable if it is outside PATH. Doctor reports the selected renderer and missing prerequisites. Nothing installs itself at startup. Helper executables are resolved to absolute paths outside the workspace, with an explicit install-directory working directory. Python prerequisite probes use isolated mode.

Plugin route, which needs the external runtime from [docs/CLAUDE-INSTALL.md](docs/CLAUDE-INSTALL.md): in Claude Code, `claude plugin marketplace add ToolsEnabled/toolsenabled-slides` then `claude plugin install toolsenabled-slides@toolsenabled-slides` (or in one step `/plugin install toolsenabled-slides --marketplace ToolsEnabled/toolsenabled-slides`); in Codex, `codex plugin marketplace add ToolsEnabled/toolsenabled-slides` then `codex plugin add toolsenabled-slides@toolsenabled-slides` or the `/plugins` directory.

Start the stdio MCP server with one command:

```sh
node slides-mcp.js
```

The server creates a private workspace at `.slides-workspace` in the current directory, starts the local suite, and prints its studio address to stderr. MCP messages alone use stdout. Open the one-time dashboard URL printed at startup to watch and control editing. A bare `/studio` page can display the deck, but does not authorize human controls. In Claude Code, the human finds startup stderr at `~/.cache/claude-cli-nodejs/<cwd-slug>/mcp-logs-plugin-toolsenabled-slides-slides/<timestamp>.jsonl` (XDG settings may change the base), or in a private absolute `--debug-file` they select. Same-user agent file tools can read an unused link, even from mode-600 logs: open it before assigning agent work and never ask the agent to retrieve it.

For a persistent studio that outlives individual MCP sessions, set `SLIDES_WORKSPACE` and run `node src/cli/studio.js`. MCP clients with the same workspace and port attach to it. Clients that attach leave the server running on exit. On Linux, a suite started by an MCP client exits with that owning client, including abrupt termination, through a private lifetime pipe; attached clients then need to reconnect. If a launch link expires or a dashboard tab loses its session, stop and restart the owning client or persistent studio to receive a fresh launch URL. Saved workspace edits remain.

## Connect your host

Set `SUITE_PYTHON` to the absolute Python executable in your prepared runtime, then generate the command or configuration for your client:

```sh
node tools/mcp-config.mjs --client claude
node tools/mcp-config.mjs --client codex
node tools/mcp-config.mjs --client cursor
node tools/mcp-config.mjs --client claude-desktop
node tools/mcp-config.mjs --client deepseek
```

The helper prints configuration and does not change host settings. `SLIDES_WORKSPACE` overrides its default `slides-workspace` directory. Claude Code and Codex output is a registration command; Cursor and Claude Desktop output is an `mcpServers` JSON entry; DeepSeek Harness output is an extension configuration. Restart the host after adding the configuration. Plugin installation for Claude Code and Codex is described in [docs/CLAUDE-INSTALL.md](docs/CLAUDE-INSTALL.md); the registration helper also works independently of plugin support.

Try: “Use Slides to make a three-slide project update. Read the board and outline, lock the slides, then export update.pptx and update.pdf.”

## Work with your deck

Place an existing `.pptx` in the workspace, lock the current slides with `ppt_lock`, and call `ppt_import` with its relative path. Import preserves the source file and creates an editable overlay over a private copy. Human undo restores the previous model. External relationships, macro content types, VBA/OLE/ActiveX relationships and elements, and OLE compound-file signatures are refused before import and rendering. Rendered packages are checked again before publication. Embedded workbooks are unsupported, including ordinary Excel-backed charts. Replace those charts with PNG, JPEG or GIF images before import; existing chart image snapshots remain supported. Imported images must be PNG, JPEG or GIF by decoded content and retain their original bytes, quality, metadata and animation after first-frame decoding and GIF/APNG header/frame-metadata checks within the import budgets. Later animation frames stay encoded in the original media and PPTX exports. PNG msOG embedded animation is refused. For PDF and PNG, a private render copy replaces each animated GIF with a PNG of its first frame at the same dimensions and removes APNG animation chunks; the model and original media stay unchanged. SVG, WMF/EMF, PDF images and imported video are refused. Native video can be added from workspace assets. LibreOffice uses a fresh private profile for each conversion.

Use `ppt_show` for IDs and `ppt_board` for pinned presentation guidance. Lock each affected slide before editing; deck-wide changes require every current slide. The studio can protect slides and individual objects. Pause, resume, undo, redo, explicit dashboard lock overrides and dashboard downloads are not available as MCP tools and require the dashboard session. MCP callers can release only their own locks. Raw HTTP clients running as the same user are outside that identity boundary; locks do not isolate processes that already have local filesystem access. Open the one-time launch URL printed at startup; its fragment secret expires after ten minutes. The page exchanges it by POST for an origin-scoped token in sessionStorage and an HttpOnly cookie. Every human control requires the session header as well as the cookie; a cookie alone is refused. Pause refuses editing and explicit plugin exports; board messages and reads remain available. Board prose is workspace guidance and does not override the user or host; deterministic lint checks provide additional feedback.

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
| `SLIDES_RENDERER` | Use `auto` or `libreoffice` on Linux. The experimental `powerpoint` path is not supported by this release. |
| `SLIDES_SOFFICE` | Path to LibreOffice's `soffice` executable. |

State and imported originals live in `.slides-state` inside the workspace. Keep that directory with the workspace. Only one suite process may own a workspace; a second process refuses startup before reading its model. After a crash, verify the PID in `.slides-state/server.lock` is gone before removing that file. Slides never steals a lease automatically.

## Limits

- Native object animations and embedded MP4 playback require the experimental PowerPoint COM/pywin32 path, which is outside this Linux release's supported scope. The studio's motion preview approximates those builds. Static decks, transitions, imports and PPTX/PDF/PNG exports use the Linux path. Export reports an error when a deck requires an unavailable renderer capability.
- PDF and PNG are static. Fonts, effects, media and complex imported formatting can differ between LibreOffice and PowerPoint. Inspect exported pages before sharing.
- Import accepts up to 32 MiB, 5,000 ZIP members and 128 MiB of expanded data. Both imported and newly edited decks are limited to 200 slides and a 2 MiB model. MCP requests are limited to 1 MiB, queued work to 64 requests / 4 MiB, and text replies to 60,000 characters.
- If pypdfium2 is missing, PNG thumbnails report why they are unavailable; PPTX and PDF remain usable. Without LibreOffice on Linux, only PPTX export works.
- Human undo/redo and slide claims are in memory. Object history, model, board, pause state and protections are durable. Imported originals are retained so history can refer to them; old originals may consume disk space.
- This is a local, single-user application, not a server for untrusted network clients. Host/Origin checks and path confinement protect its APIs; they do not sandbox a host or user that already has filesystem access. Do not expose the port through a tunnel or proxy.

See [all MCP tools](docs/MCP.md), [test instructions](docs/TESTING.md) and [experimental Windows renderer review](docs/COM-REVIEW.md). Licensed under the [MIT License](LICENSE).

## User commands

Claude Code 2.1.287 provides the read-only `/slides` panes; the bare command opens `home`. They use the configured Node runtime and external workspace without MCP calls, model turns, editor registration, server startup or permission prompts. Use `1`–`8` for details, `n`/`p` to page, `b` to return, `r` to reload, `h` for home, `k` for help, and Esc or `q` to close. Help shows two commands per page with their descriptions and Codex equivalents. Other views show eight records per page. A changed snapshot requires an explicit reload. Detail text is bounded and marks truncation. Status offers a renderer probe only when you press `v`; opening the pane never runs it.

Native action commands start ordinary model work with the usual tool permissions. Type the full `/toolsenabled-slides:slides-…` name: unprefixed action names do not resolve in 2.1.287. Panes never put workspace content into model context. Codex has no plugin slash-command registration; its equivalents below are CLI views and the `$toolsenabled-slides:toolsenabled-slides` skill. A Codex `!` command's output enters the next model turn, so the CLI quotes workspace data and applies the same secret/control filters. This mapping is not native slash-command parity.

In CLI examples, replace `<plugin>` with the absolute installed plugin directory (the parent of `src/`, shown by `codex plugin list --json`), `<ws>` with the configured workspace, and `<port>` with its port. Node and workspace settings are literal arguments. `ppt` is not automatically placed on PATH by plugin installation. Optional selectors in brackets are notation, not literal arguments. For object history, pass three words: `history s1 element e1` or `history s1 decor d1`.

| Claude command | Kind | Result | Codex equivalent |
|---|---|---|---|
| `/slides home` | Pane | Deck outline, revision, pause state, task count and studio guidance. | `!node "<plugin>/src/cli/view.js" home --workspace "<ws>" --port <port>` |
| `/slides slide <number-or-id>` | Pane | Full slide text, media, builds, notes, locks and protections. | `!node "<plugin>/src/cli/view.js" slide <number-or-id> --workspace "<ws>" --port <port>` |
| `/slides notes [number-or-id]` | Pane | Speaker notes in slide order, or one selected slide. | `!node "<plugin>/src/cli/view.js" notes [number-or-id] --workspace "<ws>" --port <port>` |
| `/slides search <text>` | Pane | Literal search across visible text, bullets and speaker notes. | `!node "<plugin>/src/cli/view.js" search <text> --workspace "<ws>" --port <port>` |
| `/slides board` | Pane | Pinned notes and messages with recorded provenance. | `!node "<plugin>/src/cli/view.js" board --workspace "<ws>" --port <port>` |
| `/slides tasks [loops]` | Pane | Open/all task records and grant scope; Loops shows cadence and last run. | `!node "<plugin>/src/cli/view.js" tasks [loops] --workspace "<ws>" --port <port>` |
| `/slides history [undo\|redo\|slide-id element\|decor object-id]` | Pane | Saved activity, live undo/redo history or selected object versions; dashboard-only restore. | `!node "<plugin>/src/cli/view.js" history [undo\|redo\|slide-id element\|decor object-id] --workspace "<ws>" --port <port>` |
| `/slides lint` | Pane | Local quality findings plus existing full lint only when cached for this revision. | `!node "<plugin>/src/cli/view.js" lint --workspace "<ws>" --port <port>` |
| `/slides timing` | Pane | Speaking estimate, total target/budget, transitions and playback. | `!node "<plugin>/src/cli/view.js" timing --workspace "<ws>" --port <port>` |
| `/slides status` | Pane | Configured runtime, live locks/editors, render receipt and explicit renderer probe. | `!node "<plugin>/src/cli/view.js" status --workspace "<ws>" --port <port>` |
| `/slides protections` | Pane | Protected content, exceptions, decision history and task grants. | `!node "<plugin>/src/cli/view.js" protections --workspace "<ws>" --port <port>` |
| `/slides assets` | Pane | Local assets metadata and slide usage; never follows symbolic links. | `!node "<plugin>/src/cli/view.js" assets --workspace "<ws>" --port <port>` |
| `/slides layouts` | Pane | Native and observed layouts, element types, effects and theme accent. | `!node "<plugin>/src/cli/view.js" layouts --workspace "<ws>" --port <port>` |
| `/slides exports` | Pane | Past successful exports with revision, renderer and file receipts. | `!node "<plugin>/src/cli/view.js" exports --workspace "<ws>" --port <port>` |
| `/slides studio` | Pane | Clean studio URL and human-only launch-link instructions; never reads secrets. | `!node "<plugin>/src/cli/view.js" studio --workspace "<ws>" --port <port>` |
| `/slides help` | Pane | Every view and action with its Codex equivalent. | `!node "<plugin>/src/cli/view.js" help` |
| `/toolsenabled-slides:slides-new <brief>` | Action | Build a first presentation from a brief. | `$toolsenabled-slides:toolsenabled-slides new <brief>` |
| `/toolsenabled-slides:slides-add <brief>` | Action | Add requested slides in the current deck style. | `$toolsenabled-slides:toolsenabled-slides add <brief>` |
| `/toolsenabled-slides:slides-edit <slide> <change>` | Action | Make a focused presentation edit and verify it. | `$toolsenabled-slides:toolsenabled-slides edit <slide> <change>` |
| `/toolsenabled-slides:slides-style <instructions>` | Action | Apply requested styles to selected slides. | `$toolsenabled-slides:toolsenabled-slides style <instructions>` |
| `/toolsenabled-slides:slides-import <file.pptx>` | Action | Import a workspace PowerPoint file as the current deck. | `$toolsenabled-slides:toolsenabled-slides import <file.pptx>` |
| `/toolsenabled-slides:slides-preview [slide-or-all]` | Action | Export PNG previews and report the selected pages. | `$toolsenabled-slides:toolsenabled-slides preview [slide-or-all]` |
| `/toolsenabled-slides:slides-export <pptx\|pdf\|png> [path]` | Action | Export a fresh presentation copy. | `$toolsenabled-slides:toolsenabled-slides export <pptx\|pdf\|png> [path]` |
| `/toolsenabled-slides:slides-write-notes <slide\|all> [guidance]` | Action | Write or revise speaker notes. | `$toolsenabled-slides:toolsenabled-slides write-notes <slide\|all> [guidance]` |
| `/toolsenabled-slides:slides-media <slide> <assets/file> [placement]` | Action | Place or update local images and video. | `$toolsenabled-slides:toolsenabled-slides media <slide> <assets/file> [placement]` |
| `/toolsenabled-slides:slides-animate <slide> <instructions>` | Action | Set slide builds and transitions. | `$toolsenabled-slides:toolsenabled-slides animate <slide> <instructions>` |
| `/toolsenabled-slides:slides-fix-lint [slides]` | Action | Resolve relevant quality findings. | `$toolsenabled-slides:toolsenabled-slides fix-lint [slides]` |
| `/toolsenabled-slides:slides-fit <minutes>` | Action | Adjust visible text toward a speaking-time target. | `$toolsenabled-slides:toolsenabled-slides fit <minutes>` |
| `/toolsenabled-slides:slides-task <task-id>` | Action | Carry out a dashboard-assigned task. | `$toolsenabled-slides:toolsenabled-slides task <task-id>` |
