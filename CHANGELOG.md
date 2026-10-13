# Changelog

## 0.1.2 — 2026-10-13

- Pass the workspace path-confinement reason through to `ppt_import`/`ppt_export` results (for example `Output already exists; choose a new destination`) instead of a generic export failure.
- Label tool-argument schema failures `Invalid arguments: …` instead of `Tool crashed: …`.
- Report a refused workspace lease at startup in one line, without a stack trace, from `src/server.js` and `slides-mcp.js`.
- Log `thumbnail render cancelled at shutdown` when shutdown interrupts the background thumbnail render instead of surfacing LibreOffice's benign javaldx warning as `Renderer failed`.
- Remove the duplicated `use tools/setup-runtime.py` hint from the prepared-runtime failure message.
- Describe the real slide and element id formats in `ppt_show` and docs/MCP.md: `s`/`e` plus 8 hex characters for created objects, `s1`/`e1`/`e2` for the default deck, `sN` and `eN_M` for imported decks.
- Make the repository its own plugin marketplace for Claude Code (`.claude-plugin/marketplace.json`) and Codex (`.agents/plugins/marketplace.json`) and document the literal install commands.
- README: add the download-and-verify step, state that no Claude Desktop bundle (`.mcpb`) is distributed, and link the 0.1.0 Linux wheel bundle with its SHA-256. docs/CLAUDE-INSTALL.md: verify the asset's `.sha256` file rather than a "SHA256 manifest". docs/TESTING.md: name the prepared runtime the plugin-mode tests need.

## 0.1.1 — 2026-10-13

- Add sixteen read-only Claude Code views under `/slides`, with paging, bounded detail, provenance, help and explicit renderer diagnostics.
- Add thirteen native action commands for creating, editing, notes, media, animation, task work, lint, timing, import, preview and export.
- Add `ppt_tasks` (37 MCP tools total), export receipts and cached-only lint reads.
- Require locks for every unauthenticated editor regardless of display name.
- Validate plugin studio settings before creating its workspace; require explicit Python in generated registrations.
- Verify clean release inventories and support archive packaging without Git. Correct the earlier Codex loader isolation claim and assert expected negative-control causes.
- Start `/slides` pane readers and the renderer probe through `/usr/bin/env -i` with only PATH, HOME, LANG and the configured Slides settings. Claude Code adds a `$.process.run` environment to its own, so client credentials and loader variables previously reached these children.
- Hold every advertised `/slides` pane key (p, n, b, r, h, k, q, a, l, u, d, v and all digits) in every pane state, including first and last pages, help, detail, empty, error and loading. A key that does not apply shows a short hint instead of falling into the prompt composer, q and Esc always close, and the footer lists only the keys that act in the current state.

## 0.1.0 — 2026-10-01

- Create, edit, import and export PowerPoint decks through 36 local MCP tools.
- Watch edits in the browser studio and coordinate clients with slide locks, a shared board, tasks and recurring check records.
- Control pause, resume, undo, redo, content protection and downloads through a per-launch dashboard session with an origin-scoped header token.
- Export new workspace copies as PPTX, PDF or PNG with local Python, LibreOffice or Windows PowerPoint.
- Validate document paths, imported packages, tool inputs and shared workspace ownership.
- Require the prepared external runtime in Codex and Claude plugins; validate binary package parts by content and preserve first-frame rendering for imported animations.
- Keep all 36 tools visible to Claude and forward the configured Python runtime in generated client registrations.
- Include a complete headless test runner, synthetic fixtures and a reproducible source package.
