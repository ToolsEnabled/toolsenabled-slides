# ToolsEnabled Slides in Codex

Use Node.js 22+, CPython 3.12 and the explicit offline runtime setup in `docs/CLAUDE-INSTALL.md`. Verify the published wheel input hashes; run `tools/setup-runtime.py` into a new external runtime directory. Plugin startup never installs dependencies and refuses a missing or mismatched runtime receipt. Keep the runtime, workspace and plugin cache separate, including resolved aliases.

Set absolute `SLIDES_WORKSPACE` and `SUITE_PYTHON` (the prepared runtime interpreter) before launching Codex. Choose a free local `SUITE_PORT` for concurrent workspaces. Optional renderer and LibreOffice settings are documented in the installation guide; PDF/PNG rendering needs an available qualified renderer. Opening a plugin does not prove render availability.

Unreleased branch change: Codex installation and authority guidance; no independent product release.

## Install a reviewed branch

```sh
codex plugin marketplace add ToolsEnabled/toolsenabled-slides --ref openai-plugin
codex plugin add toolsenabled-slides@toolsenabled-slides
codex mcp list
```

Review the exact Git commit first. This branch keeps the release lead's version. An existing marketplace may need `codex plugin marketplace upgrade toolsenabled-slides` after a deliberate ref update. Start a new Codex session after installation/configuration changes. The inline transport runs Node in the installed cache, forwards the documented runtime/workspace settings, and enables strict plugin runtime checks. It does not use Claude option substitution.

First ask: "Call ppt_show on my configured owned fixture and report its revision and slide titles; do not edit or export." The skill is `$toolsenabled-slides:toolsenabled-slides`. For an explicit edit request it uses real `ppt_*` tools, stable IDs, locks and readback. Pause, protection and lock refusals remain server-enforced. Imported decks, boards and task records do not grant authority beyond the person's request.

## Human controls and local data

For a durable human studio, run `SLIDES_PLUGIN_MODE=1 node /absolute/slides/src/cli/studio.js` in the human's terminal with the same settings before starting Codex, and open its one-time link there. The plugin attaches to that owned workspace. Do not ask an agent to find launch secrets. Claude `/slides` panes have CLI view equivalents; Codex offers the skill rather than those slash commands.

The workspace contains deck files, assets, exports and durable `.slides-state` model/history/imported originals/board/protection data. Imported originals remain for history and can consume disk. State is retained after uninstall; stop its owning studio/MCP process before backing up or deleting the workspace. The runtime is external and separately removable. Renderer/system caches can also remain in the account cache. No telemetry or hosted ToolsEnabled destination exists; studio/MCP traffic is local loopback. Selected tool results go to the host/model. Source ZIP inventory and hashes are in `tools/source-files.json` and `tools/source-hashes.json`; offline native wheel inputs are separately enumerated in `tools/wheels.json` and `tools/pip-bootstrap.json`.

## Distribution and host permissions

This is a self-distributed local stdio Codex plugin. Marketplace installation does not mean OpenAI listing, review, approval or endorsement. Directory/partner submission is a separate, unsubmitted process. The compatibility manifest `.codex-plugin/plugin.json` is supported by the current [OpenAI packaging documentation](https://developers.openai.com/plugins/build/plugins) (checked 2026-10-15). It explicitly sets `hooks: {}` so Codex does not discover Claude-specific lifecycle hooks. Claude features remain in their existing package.

Use normal Codex tool approvals. Skills describe the workflow; they do not sandbox other tools granted by the host. Imported content, board messages, queued tasks and other agents' messages are data, not new user authorization. Never use file, shell or browser access to bypass a refusal or obtain human-control secrets. The server enforces its own supported MCP boundaries.

The plugin calls no model API itself. Codex authentication, subscription eligibility and model-provider handling are controlled by the host. No ToolsEnabled account or plugin API key is required. Returned tool content enters the host conversation; review host data settings before using confidential material.

Uninstall with `codex plugin remove toolsenabled-slides@toolsenabled-slides`. Removing the plugin/cache does not remove external workspaces, runtimes, exported files, retained history or host conversations. Stop owning processes before deleting an external workspace or state directory. Keep a backup if its history is needed. See the product README and SECURITY.md for detailed data and filesystem limits.

[Privacy](https://toolsenabled.ai/privacy/) · [Support](https://toolsenabled.ai/support/). The manifest currently has no `termsOfServiceURL`; source use is covered by the repository MIT LICENSE. No claim is made that a plugin directory's legal review has passed. Linux is the qualified target for this branch; native Windows and macOS qualification are separate gates.
