# ToolsEnabled Slides design

ToolsEnabled Slides runs locally for one user. An MCP host supplies the agent; the plugin provides presentation tools and a browser studio. It has no built-in model provider, account system or automatic agent dispatcher.

## Processes and state

The root `slides-mcp.js` entry starts the stdio transport and a loopback server for the configured workspace. An existing server is reused only after its service identity and canonical workspace match. A workspace lease prevents concurrent writers. An owned server exits on MCP EOF or signals; an attached client leaves the server running. Stdout carries MCP messages, while launch details go to stderr.

The server creates a neutral first slide and private `.slides-state` directory. The model, imported originals, object history, board, tasks, loops, pause state and content protections persist in the workspace. Deck undo/redo and slide claims remain in memory. Tasks and loops are shared records; external clients decide when to perform them.

## Editing and human controls

All MCP edits use the shared model validator and require slide ownership. Deck-wide operations require every current slide. Pause and content protections apply before committing edits. Object history records bounded snapshots and supports human restoration. Pinned board text is guidance for the host, subject to that host's instructions.

Human controls are not available as MCP tools and require the dashboard session. The per-launch fragment secret redeems once through a same-Origin JSON POST. The browser stores the token in origin-scoped sessionStorage and sends it as X-Slides-Session. An independent HttpOnly, SameSite=Strict, host-only cookie is also required; cookie-only requests are refused. Host, Origin and JSON checks also apply. This is a local application: a process running as the same user can still act as that user.

## Rendering and files

Python and python-pptx create PPTX files. LibreOffice supplies portable PDF rendering and pypdfium2 rasterizes every PDF page. Windows PowerPoint provides an optional COM path for native animation and embedded video. Every conversion runs with bounded time and output in a private staging directory. Missing dependencies produce installation guidance; startup never installs packages.

Import and export resolve paths within the workspace, reject traversal and symlink escapes, and refuse overwriting export destinations. Import validates archive size and document relationships before opening a deck. Imported originals remain available for history. Media sources must live inside workspace `assets/`.

## Layout and verification

JavaScript lives in `src/`, Python in `src/python/`, browser code in `public/`, Windows helpers in `scripts/windows/`, and tests in `test/`. `tools/mcp-config.mjs` prints client registration without changing settings. `tools/package.py` builds a deterministic source ZIP and excludes runtime state and dependencies.

The full headless runner uses synthetic decks and media. It covers input validation, rendering, persistence failures, history, locks, human session controls and the browser UI. A golden fixture freezes every tool name, description and schema. The stdio lifecycle proof exercises startup, attachment, editing, exports, reimport and clean shutdown. Actual LibreOffice and Windows COM proofs require their respective installed renderers; see [testing](TESTING.md).
