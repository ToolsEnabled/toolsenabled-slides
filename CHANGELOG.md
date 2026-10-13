# Changelog

## 0.1.1 — unreleased

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
