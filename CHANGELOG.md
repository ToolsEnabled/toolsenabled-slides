# Changelog

## 0.1.4 — 2026-10-13

- A lock refusal now names the slides to lock. For example, `ppt_add_slide` with a slide still unlocked returns "Lock the affected slides with ppt_lock before editing: s2 (add-slide changes the whole deck, so it needs every current slide locked)" instead of the bare instruction; the HTTP response also lists them as `lockSlides`.
- A start that finds no `presentation.pptx` yet (for example after `claude mcp list` stopped the first start before its first render) logs "creating the initial presentation.pptx" instead of "presentation needs a boot render: ENOENT …". A deck that is out of date for another reason logs "presentation.pptx is out of date, rendering it again: <reason>".
- `node src/cli/doctor.js` prints install commands only for what is missing (`missing` and `install` appear only then); with everything present it prints none.
- `node tools/mcp-config.mjs` names Node.js by the PATH entry that runs it (for example `/usr/local/bin/node`) instead of the file a version manager links it to, falling back to the running executable when no PATH entry matches.
- Install docs: after the documented `claude plugin install`, the message "2 userConfig options not yet set" is expected; it refers to the optional renderer and LibreOffice settings, which keep their defaults. The docs name Claude Code 2.1.296, the version this release was tested with.

## 0.1.3 — 2026-10-13

- Every one of the 37 MCP tools now declares a plain title and the `readOnlyHint`, `destructiveHint`, `idempotentHint` and `openWorldHint` annotations, reviewed against each tool's handler. Eight tools only read. The other 29 are marked destructive; for `ppt_add_*`, `ppt_note`, `ppt_lock`, `ppt_unlock`, `ppt_task_done` and `ppt_export` this is new and conservative (an edit clears redo and can drop the oldest undo state, a board post can drop old agent messages, an export trims its receipt list; an export still never overwrites a file). No tool reaches beyond this computer. Tool names, inputs and behavior are unchanged; docs/MCP.md lists the rules.
- Claude Code now starts the MCP server as `node ${CLAUDE_PLUGIN_ROOT}/slides-mcp.js`, with the settings passed as environment variables and the same strict plugin-mode startup as the Codex manifest. The `node` on the PATH that Claude Code runs with must be Node.js 22 or newer; the `node_executable` setting is still used by the `/slides` panes.
- The start-up error for a missing workspace no longer says "the Codex plugin".
- Add the plugin directory's listing icon to the repository.
- README: a new section, "What this plugin runs, sends and reads", lists the programs the plugin starts, what it reads and writes, what it sends and where, and the events the `/slides` mod handles. The install command now shows the four required settings, and the local studio is named by its path and port rather than a link.
- Plugin listing links: the Claude plugin manifest names the documentation (README), privacy (https://toolsenabled.ai/privacy/) and support (https://toolsenabled.ai/support/) pages, and the Claude, Codex and Desktop manifests use the product page https://toolsenabled.ai/slides/ as the homepage. The old privacy address, now a redirect, is replaced everywhere.
- Tests that start the server or the CLI next to placeholder hosts give the child process only the operating-system basics and the suite's own settings; a new test starts the server exactly as Claude Code's `.mcp.json` does; a new test pins every tool's annotations.

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
