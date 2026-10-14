# Changelog

## 0.1.8 — 2026-10-13

Fixes from the 2026-10-13 fresh-user re-test of 0.1.7; the tools, studio, panes and mod are unchanged:

- A start of a workspace whose deck model exists but whose `presentation.pptx` is missing (a client's health check can stop the first start before its first render) now says `presentation.pptx is missing, rendering it for rev N`. `creating the initial presentation.pptx` is printed only when the deck itself is new. `test/js/first-boot.test.js` pins both lines.
- README no longer says that agent file tools can read the one-time studio link "even from mode-600 logs". The log's mode depends on the MCP host and your umask: Claude Code 2.1.296 wrote it as mode 644 under umask 022, readable by every local account. Open the link promptly, before assigning agent work. `test/js/readme-studio-link.test.js` pins the wording.
- `test/js/dashboard-browser-session.test.js` failed on a busy machine and passed alone: each of its waits (a real Chromium start, page loads, server state) allowed 10 s. The waits now go through `test/helpers/until.js`, 30 s each by default; `SLIDES_TEST_WAIT_MS` sets another deadline, and a wait that never holds names what it waited for. The checks are unchanged. `test/js/until-helper.test.js` covers the helper, and docs/TESTING.md describes the setting.
- `tools/source-files.json` lists the three new test files; the source ZIP gains them.

## 0.1.7 — 2026-10-13

Codex self-distribution fixes; the server, tools, studio, panes and mod are unchanged:

- Codex no longer tries to read `hooks/hooks.json`, the Claude Code `/slides` mod, as a Codex hook file, which it cannot parse. `.codex-plugin/plugin.json` declares `"hooks": {}`; an explicit `hooks` value replaces Codex's default hooks-file discovery, and an empty one adds no hooks. Claude Code is unaffected.
- `.codex-plugin/plugin.json` declares `"skills": "./skills/"`, which OpenAI's documentation requires for Codex-format packages with skills (Codex already fell back to `skills/`).
- The Codex listing gains `interface.supportURL` (https://toolsenabled.ai/support/); `websiteURL` and `privacyPolicyURL` were already set. `shortDescription` is "Local PowerPoint deck editing", within the 30-character limit.
- README, docs/CLAUDE-INSTALL.md and the skill use only Codex commands that OpenAI documents: add the marketplace with `codex plugin marketplace add ToolsEnabled/toolsenabled-slides`, then install from Codex's `/plugins` browser. For the CLI views, the installed plugin folder is named as a version folder under `~/.codex/plugins/cache/toolsenabled-slides/toolsenabled-slides/`. They used to name `codex plugin add` and `codex plugin list --json`, which OpenAI's documentation does not list.
- `test/js/claude-package.test.js` now also pins the empty `hooks` object, the skills path, the description length and the listing links; the suite runs the same tests as 0.1.6.

## 0.1.6 — 2026-10-13

- README: a "Try it" section gives the shortest path from nothing to a working result: prepare the external runtime from the 0.1.0 wheel bundle, install the plugin with its four settings, then three prompts (show the deck, add a slide with three bullets, export the deck as PPTX), each with the result it shows. No account or API key is needed.
- SECURITY.md cites this repository's LICENSE (MIT) for "as is". https://toolsenabled.ai/terms/ covers only Fleet and the website.
- The skill no longer gives the model the path of the log that holds the one-time dashboard link. It tells the human to find the link in the host's MCP log, as the README explains; the rest of the skill is unchanged.
- `test/js/managed-presentation.test.js` no longer starts a program itself: the helper that writes a deck with python-pptx moved unchanged to `test/helpers/user-deck.js`, so the file that polls the local server over HTTP runs no child process. The test checks exactly what it checked before; `tools/source-files.json` lists the new helper.
- The server, tools, studio and panes are unchanged.

## 0.1.5 — 2026-10-13

- `ppt_import` now respects protections on single objects. It used to check only slide protections, so an agent holding every slide lock could replace a deck in which a human had protected an object: the object was lost, its protection could not be removed in the studio, and the next start refused the workspace ("protections[0] names missing element …") until `state.json` was edited by hand. Import is now refused while any slide or object of the deck is protected, and the refusal names it, for example "Protected content must be unlocked by the human before replacing the deck (element e1 on slide s1 is protected)".
- A workspace left in that state starts again. At startup, a protection that names an object the deck no longer has is removed, the previous `state.json` is kept as `.slides-state/state-before-protection-repair-<time>-<id>.json`, and the log says, for example, "Removed 1 protection for objects no longer in the deck (element e1 on slide s1); the previous state.json is kept as …". Any other mismatch between `state.json` and the deck still stops the start.
- An MCP edit or import refused because content is protected now answers "PROTECTED." with the reason, instead of "PAUSED. The human has paused all editing …", which told the agent to wait for a Resume that would never come. The CLI already told the two apart.
- `presentation.pptx` in the workspace is the deck as Slides renders it. A `presentation.pptx` that Slides did not write (your own deck with that name, or changes saved over the render in PowerPoint) is now copied to `presentation.user-<time>.pptx` before a render replaces it, and the log names the copy; before, it was overwritten without a copy. README now says to give imported decks another name.
- `ppt_lint` right after an edit reports font lint as pending ("Font lint waits for the render of rev N …; run lint again after it") until `presentation.pptx` has been rendered for that revision. It used to check the fonts of the previous render and report them against the new slide order and revision, so after a slide move it named the wrong slide. The studio now refreshes its lint panel when a render is published.

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
