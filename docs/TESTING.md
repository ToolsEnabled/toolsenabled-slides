# Tests

Install `requirements.txt` in `.venv` with `python -m pip install --require-hashes -r requirements.txt`, then run:

```sh
env -u DISPLAY npm test
```

The plugin-mode tests check the `slides-runtime.json` receipt that `tools/setup-runtime.py` writes, so point `SUITE_PYTHON` at a runtime prepared that way (see docs/CLAUDE-INSTALL.md) before `npm test`; with only the in-tree `.venv`, four plugin-mode test files fail on the missing receipt.

`test/run.js` discovers every `test/js/*.test.js` and `test/python/*.test.py`. It copies source into a temporary suite, generates an original synthetic deck and local media fixtures, and executes test files sequentially. The suite runs without credentials or model calls. Node has no npm dependency installation step.

Tests that start the server, the CLI or the MCP launcher next to placeholder hosts give the child only the operating-system basics and the suite's `SUITE_*` and `SLIDES_*` settings, through `test/helpers/child-env.js`; the MCP test client, `test/helpers/mcp-client.js`, does the same for every test (`test/js/test-client-env.test.js`). The four test files that the plugin directory's credential check listed (`security`, `board-human-capacity`, `codex-dashboard-route` and `swarm-locks-selectors`) spell no address other than 127.0.0.1: the hostile `Host` and `Origin` values of `test/js/security.test.js` are in `test/fixtures/foreign-requests.json`, its deck with an external link is written by `test/helpers/external_link_deck.py`, and the pattern for the one-time link is `launchLink` in `test/helpers/dashboard.js`. `test/js/directory-pairs.test.js` pins this. `test/js/claude-package.test.js` starts the server the way `.mcp.json` describes, with `${CLAUDE_PLUGIN_ROOT}` and the options substituted, and checks the runtime receipt, the workspace, the full tool list and the refusals when the Python or workspace setting is missing; `test/js/plugin-readonly.test.js` checks that this launch never writes into the installed plugin.

The browser smoke test requires Chrome, Chromium or Edge. Set `SLIDES_TEST_BROWSER` when its executable is outside PATH. This explicit override enables sandbox-compatible headless flags for a test-owned profile. Missing browsers are a test failure, not a silent pass. Each of that test's waits (the browser answering on its DevTools port, page loads, the server's pause state) allows 30 s through `test/helpers/until.js`; on a machine busy with other suites or LibreOffice exports that is enough where 10 s was not. `SLIDES_TEST_WAIT_MS` sets another deadline in milliseconds. A wait that never holds fails naming what it waited for. To rerun that file alone: `node test/run.js test/js/dashboard-browser-session.test.js`.

For a targeted rerun: `node test/run.js test/js/applyop.test.js test/js/backend-robustness.test.js`. Set `SLIDES_KEEP_TESTS=1` to retain the generated fixture tree for diagnosis.

The exact real-render proof command, from the installed directory, is:

```sh
env -u DISPLAY SLIDES_RENDERER=libreoffice node test/prove-lifecycle.js --output ./libreoffice-proof
```

It requires LibreOffice Impress and pypdfium2 and fails if they are missing. It creates a three-slide deck through stdio MCP, compares the entire tools/list golden, verifies lock enforcement, attachment, export to PPTX/PDF/three PNG pages, reimport, clean EOF and lease removal. Its output directory holds the receipt, transcript, artifacts and stderr. `--pptx-only` is a separate, explicitly narrower proof for environments without LibreOffice. The full suite reports a reasoned skip for its LibreOffice test when no renderer is installed; the strict proof is required before release.

Windows-only coverage:

- `test/windows/export_scripts.test.ps1`: PowerShell parsing, literal-path and staged-rollback helper tests, plus source checks for COM ownership/release. The runner executes it on Windows because PowerShell is not a Linux prerequisite. This test does not launch PowerPoint; actual COM rendering needs Windows and desktop PowerPoint.
- `test/python/render_tools.test.py::test_generated_picture_and_native_animation_render_into_pptx`: PowerPoint's native animation object model; needs Windows, PowerPoint and pywin32.
- `test/python/render_tools.test.py::test_generated_video_is_embedded_with_persistent_playback_settings`: PowerPoint media playback settings; same prerequisites.
- `test/python/render_tools.test.py::test_native_generated_video_embeds_in_model_order_behind_text`: native PowerPoint media placement and playback settings.
- `test/python/render_tools.test.py::test_sharp_corner_roundtrip_preserves_shape_style_order_and_animation_identity`: actual PowerPoint animation round trip.
- `test/python/render_tools.test.py::test_animation_postprocessor_closes_deck_but_not_attached_app` and `test_media_postprocessor_closes_deck_but_not_attached_app`: the real Windows COM initialization path.

The Linux suite executes all other COM host tests using deterministic process doubles, including timeout, retirement, stale PID and ownership behavior. Portable transition, import, rich text, media validation and render staging checks execute on Linux.

`test/js/findings.test.js` checks first-run behavior, prerequisite diagnostics, renderer availability, package exclusions and test discovery. `test/js/security.test.js` exercises loopback headers, private state, provider removal, human-only controls, pause, locks, path confinement, external relationship refusal, overwrite refusal, workspace lease and attach identity. `test/js/golden.test.js` compares complete tool descriptions and input schemas.

Security regressions cover split UTF-8 HTTP frames, renamed active parts and relocated image parts, bounded XML trees and child memory, per-instance MCP identity, abrupt owner death, Windows helper resolution (mocked platform), PowerShell quote delimiters, two-client text spoofing, browser fetch metadata, concurrent lint/render limits, legacy board floods, safe diagnostics, all 37 tool annotations and hash-locked dependencies. Native Windows helper execution, Job Object enforcement and PowerPoint COM still require a Windows host.

## Command qualification

Run `claude plugin test /absolute/plugin` with Claude Code 2.1.296 and a fresh, unsigned-in scratch `CLAUDE_CONFIG_DIR`. It executes the hook engine, not a model turn. The tests cover local child binding, paging, stale revisions, untrusted text, late responses, help, navigation and explicit diagnostics. They do not establish real terminal painting or composer restoration: qualify those separately in the real TUI, including Esc/q, detail-only markers, pagination, transcript absence and zero permission prompts.

The hook test engine has no process implementation, so `test/js/pane-environment.test.js` covers pane children directly: it builds each reader and renderer-probe launch with the hook's own launch builders, starts it as Claude Code 2.1.287 starts `$.process.run` (the init environment set over the client's own), and requires the real Node child to report only its allowlisted variable names. Values are never printed.

Pane key tests press keys the way Claude Code 2.1.287 dispatches them in a focused pane: each Button in the drawn description by its `hotkey`, the later one winning, regardless of display. A key no Button holds is not consumed and reaches the prompt composer, so every state test requires each pressed key to be held, q to close afterwards, nothing to reach the composer, every advertised key to be bound and the footer to list only live keys.

`tools/prove-codex-plugin.py` is a no-model Linux host gate. Supply the exact source ZIP and SHA256, prepared Python, a new absolute `--isolated-profile` path that does not exist, `--mode inline|root-only|no-env|no-python`, and `--output`. Keep `TMPDIR` in your test lane. It reserves the scratch profile itself and sets both HOME and CODEX_HOME to it, never using inherited CODEX_HOME. The gate checks `codex mcp list --json` for the installed command, arguments, cache location and runtime forwarding. Each negative mode must expose no tools in the host and fail for its expected cause when the listed transport is spawned directly with its declared `env`/`env_vars`: root-only leaves an unresolved command, no-env lacks the workspace, and no-python lacks the external Python even when an installed local `.venv` exists. Codex may hide that cause in its host status; the receipt records the direct spawn error or exit/stderr as `directTransport`. A timeout or unrelated refusal fails the gate. Its positive path holds an idle ephemeral thread without a turn and expects all 37 tools. It reads only that synthetic server's selected runtime settings.

Qualification correction: an early 0.1.0 Codex loader receipt incorrectly claimed an isolated profile while inheriting a signed-in CODEX_HOME. A subsequent isolated-profile runtime gate passed. The earlier loader-only receipt must not be used as proof of isolation, runtime startup or a model turn. New receipts distinguish metadata discovery, actual MCP startup, hook logic and real TUI evidence.

The runtime-reader, action and inventory unit tests can run locally without a renderer. Full-suite browser/render coverage and real PTY/TUI qualification require the designated host runner when the development sandbox prohibits those processes. Do not relabel missing host evidence as a pass.

Native Windows candidate: full runner requires `SLIDES_TEST_POWERPOINT_COM=1` to opt into its final GUI-only PowerPoint COM script. Leave it unset for unattended runs. The same explicit opt-in gates the six real PowerPoint/pywin32 methods listed above; portable OOXML and process-double tests still run. The opt-in is not proof of native COM ownership and must not be enabled before that separate path qualifies. The ACL and Job Object fixtures run only on real Windows. See [Windows acceptance](WINDOWS.md); Linux passes do not qualify native APIs.

For native full-suite maintainer tests, select an approved Chrome executable with `SLIDES_TEST_BROWSER`. The two packaging test files also need a verified native Git executable in their controlled test PATH. They initialize real fresh synthetic repositories and commits; the extracted product archive itself continues to use its exact reviewed inventory without fabricated Git metadata. Keep Git system/global configuration and templates isolated from account settings.

`tools/prove-codex-plugin.py` is a Linux-only no-model host proof: it uses Linux process metadata and Unix pipe polling. It refuses non-Linux profile reservation before reading or creating a profile. Its unit tests retain actual platform error details; they do not establish private Windows profile custody or qualify the Windows Codex client.
