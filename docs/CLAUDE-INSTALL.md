# Install ToolsEnabled Slides for Claude

Works with Claude Code; provides a Claude Desktop bundle that still needs native macOS and Windows qualification. ToolsEnabled is not affiliated with or endorsed by Anthropic. These instructions describe the release candidate; the coordinator must publish reviewed artifacts before the public marketplace commands work. Native Desktop installation and trusted production signing require separate qualification.

## Prepare the runtime explicitly

Install Node.js 22+ and an existing CPython 3.12 interpreter. Select the separate offline wheel bundle for your platform: Linux x86_64 (glibc 2.28+), macOS 13+ arm64, or Windows amd64. Other Python/CPU combinations are not qualified by these offline bundles. The ordinary manual installation in README supports Python 3.10+ with its matching dependencies.

Verify the release SHA256 manifest, extract the matching wheel ZIP outside the plugin directory, and use that CPython 3.12 executable to run:

```sh
python3.12 /absolute/slides/tools/setup-runtime.py --runtime "/absolute/private/Slides Runtime" --wheels "/absolute/downloads/cp312-linux-x86_64" --pip-wheel "/absolute/downloads/cp312-linux-x86_64/pip-24.3.1-py3-none-any.whl"
```

On Windows use the existing CPython 3.12 executable and Windows absolute paths. Setup requires a new runtime directory with an existing parent. It verifies all six runtime wheel hashes and the supplied pip 24.3.1 installer hash against the shipped PyPI inventory, creates a venv, installs only those offline wheels with `--no-index --require-hashes --find-links`, checks imports and prints the venv Python path. The installer is unpacked into a temporary directory and removed after setup; it is not needed at runtime. Python distributions with working `ensurepip` may omit `--pip-wheel`. No runtime is bundled or copied from a developer machine. The source and `.mcpb` contain no wheels. Setup uses neither a package index nor a network installer; launching MCP never installs anything. Retain the external runtime's `slides-runtime.json` receipt. Run setup again into a new directory when a future release changes its lock.

## Claude Code

Claude Code 2.1.284 is the packaging reference. After publication:

```sh
claude plugin marketplace add ToolsEnabled/toolsenabled-plugins
claude plugin install -s local toolsenabled-slides@toolsenabled --config python_executable="/absolute/private/Slides Runtime/bin/python" --config node_executable=/absolute/node --config workspace_directory="/absolute/decks/Project Update" --config port=4599
```

Run installation from the presentation project directory with `-s local`. This stateful server can start when the plugin is loaded or when `claude mcp list` checks connectivity. Before either public or local installation, obtain the expected marketplace commit or packet digest from the reviewed release handoff, verify that exact commit or digest, then verify all supplied file hashes and the packet private-key scan. A checksum from the same untrusted download cannot authenticate it. For local review, add the verified absolute marketplace directory instead of the public repository. Disable automatic catalog updates until each new version is reviewed and verified. Public releases must use a reviewed marketplace commit and a release entry pinned to its tag and exact pushed commit; do not install an unverified moving branch. Windows venv Python is `Scripts/python.exe`. Use an absolute Node executable, not a shell wrapper or npm command. Each path is one literal argument, including spaces. The workspace must be outside the plugin cache. It holds deck files, assets and private `.slides-state`; keep the runtime outside both the plugin cache and workspace. Use a distinct workspace and local port for simultaneous clients.

Start `/toolsenabled-slides:toolsenabled-slides` and describe the deck or changes. The skill teaches read → lock → edit → readback → lint. Human pause, undo and protection controls remain in the dashboard. MCP export is available when requested; it writes only new workspace destinations.

Configured paths are saved in user options. For a project-specific local override, pass `claude --settings /absolute/project-options.json` with:

```json
{"pluginConfigs":{"toolsenabled-slides@toolsenabled":{"options":{"python_executable":"/absolute/private/Slides Runtime/bin/python","node_executable":"/absolute/node","workspace_directory":"/absolute/decks/Project Update","port":4599}}}}
```

Keep machine-specific options out of shared source control. The Codex manifest uses the relative Node entry `./slides-mcp.js` with `cwd: "./"`, which Codex resolves against the installed plugin. It does not use Claude variable substitution. Before launching Codex, configure `SLIDES_WORKSPACE` as an absolute workspace outside the plugin cache and `SUITE_PYTHON` as the absolute prepared venv Python; set `SUITE_PORT` for concurrent workspaces. The inline `env_vars` allowlist forwards those three settings plus optional renderer/LibreOffice, allowed-origin and timeout settings; Codex otherwise filters inherited variables. Plugin startup requires Node.js 22+, an absolute prepared external Python interpreter and a matching runtime receipt and dependency versions. Missing Python configuration never falls back to PATH or a plugin `.venv`. The workspace and runtime must not contain one another or overlap the plugin cache, including ancestor, sibling-cache and resolved alias paths. These checks precede state creation. Claude Code and Desktop explicitly map their configured workspace, Python and port into the launch environment as well as literal argv; the Python launcher establishes the same settings before Node startup. Optional `renderer` defaults to `auto`; optional `libreoffice_executable` defaults to empty (normal PATH discovery), and any nonempty value must be an absolute path. Choose that option for LibreOffice installations outside PATH, such as the macOS app bundle. The plugin fixes extra allowed origins to none, HTTP header/body deadlines to 10/15 seconds, and MCP requests to their ordinary per-tool deadlines. Direct registration retains the advanced environment overrides documented in README. Use the print-only registration helper for direct registration without plugin loading. The historical `.mcp.codex.json` sample is no longer shipped.

## Find and recover the human dashboard link

Open the one-time link before giving the agent presentation work. The link is a bearer capability. Agents with file or shell tools can read the host log while it is unused; the dashboard boundary does not protect against another process with your OS identity.

In Claude Code 2.1.284, startup stderr is recorded under `~/.cache/claude-cli-nodejs/<cwd-slug>/mcp-logs-plugin-toolsenabled-slides-slides/<timestamp>.jsonl` (it can be labelled an error entry). The cache base may change with XDG settings. For a human-controlled log on any OS, start the client with `--debug-file /absolute/private/claude-debug.log` (use a Windows absolute path on Windows); `--debug` MCP diagnostics are also available. Search only your current project's plugin log for `/studio#launch=`; do not paste that URL into agent chat or a shared issue.

For Codex, use the persistent studio route so the human receives the link directly in their terminal. Before opening Codex, set the same absolute `SLIDES_WORKSPACE`, prepared `SUITE_PYTHON` and `SUITE_PORT` values that Codex will forward, then run `SLIDES_PLUGIN_MODE=1 node /absolute/slides/src/cli/studio.js` (PowerShell: set `$env:SLIDES_PLUGIN_MODE='1'`, then run Node with the absolute script path). Open the one-time link printed in that terminal and keep the authenticated tab. Start Codex afterward; its plugin attaches to the existing workspace and reports a clean studio URL. Closing the Codex session releases its locks and leaves this human-owned studio running. The tested route does not depend on a Codex stderr-log location. To recover the dashboard, stop and restart the terminal studio, open its new link, then reconnect Codex. Never ask the agent to find the launch link.

For a direct Node launch, the link is printed on the terminal's stderr. Claude Desktop's server diagnostics are normally in `~/Library/Logs/Claude/` on macOS and `%APPDATA%\Claude\logs\` on Windows, in the `mcp-server-…log` for this plugin; use Desktop's developer log controls to locate it. These are installation instructions, not native Desktop proof.

If the ten-minute link expired or another client consumed it, use the host's human MCP controls to stop and reconnect the owning Slides server. For a persistent studio, stop and restart its terminal process. This invalidates the previous dashboard session and prints a new one-time link while preserving the workspace model. Attached clients must reconnect afterward. There is no unauthenticated HTTP or MCP command to issue dashboard credentials. Do not delete workspace state or leases as part of plugin installation or recovery.

## Claude Desktop and registry

Open the reviewed `.mcpb` in Desktop on macOS or Windows, then choose the prepared Python executable, Node executable, workspace and port. MCP directly runs the external Python executable, which checks the lock and launches the existing Node stdio server. A bundled workflow skill does not establish automatic skill loading in Desktop. This local server does not run in claude.ai chat.

`tools/package-mcpb.py` uses the unmodified pinned mcpb 2.1.2 CLI with a fixed build clock and normalized modes. Two unsigned builds must match. `server.json` is an external, unpublished Registry draft generated from signed artifact bytes; it is excluded from source, ZIP, marketplace and `.mcpb`. After the reviewed source has been pushed and tagged and production-signed bytes uploaded, the release owner runs `tools/generate-release.py --source /absolute/checkout --repository https://github.com/ToolsEnabled/toolsenabled-slides --tag v0.1.0 --commit FULL_PUSHED_COMMIT --signed-mcpb /absolute/release.mcpb --release-url HTTPS_TAGGED_RELEASE_URL --output /absolute/new-sidecars --description "Create and edit local PowerPoint decks with a live studio, slide locks and portable exports."`. It verifies the remote peeled tag, pushed plugin identity and downloaded signed bytes before writing external `server.json`, `SOURCE-PINS.json` and `marketplace-entry.json`. The description is carried verbatim; it is never shortened. Signature trust and native qualification are separate gates. `registry-draft.py` remains for explicitly unpublished review examples. Production signing, namespace DNS verification, remote publication, directory submission and native Desktop installation are owner/coordinator actions.

The supplied development signature establishes no publisher trust. Stock mcpb 2.1.2 verification has a known failure even for signed bundles; preserve its result alongside independent OpenSSL CMS verification and a tamper negative control. No production signing or Desktop acceptance is implied by local schema validation.

## Privacy and support

Slides edits local files and serves a loopback dashboard. The MCP host receives tool results and may apply its own service/data policy. Slides has no built-in provider or credential store. See [SECURITY.md](../SECURITY.md), [ToolsEnabled privacy policy](https://toolsenabled.ai/legal/privacy/) and contact [support@toolsenabled.ai](mailto:support@toolsenabled.ai).

## Startup environment contract

`SLIDES_WORKSPACE` and `SUITE_PYTHON` select the required external workspace and runtime. `SUITE_PORT` defaults to 4599. `SLIDES_RENDERER` defaults to auto and `SLIDES_SOFFICE` to PATH discovery; both are optional. The optional direct-registration settings `SUITE_ALLOWED_ORIGINS`, `SUITE_HEADERS_TIMEOUT_MS`, `SUITE_REQUEST_BODY_TIMEOUT_MS` and `SUITE_MCP_HTTP_TIMEOUT_MS` retain the documented defaults above when absent; Codex explicitly forwards them when supplied. Claude hosts explicitly assign their standard defaults. The OS supplies PATH and, on Windows, SystemRoot. Session identity, editor identity, loopback host, the ownership pipe flag and Windows executable-search protection are derived inside Slides and must not be copied from host configuration.
