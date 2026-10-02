# Tests

Install `requirements.txt` in `.venv` with `python -m pip install --require-hashes -r requirements.txt`, then run:

```sh
env -u DISPLAY npm test
```

`test/run.js` discovers every `test/js/*.test.js` and `test/python/*.test.py`. It copies source into a temporary suite, generates an original synthetic deck and local media fixtures, and executes test files sequentially. The suite runs without credentials or model calls. Node has no npm dependency installation step.

The browser smoke test requires Chrome, Chromium or Edge. Set `SLIDES_TEST_BROWSER` when its executable is outside PATH. This explicit override enables sandbox-compatible headless flags for a test-owned profile. Missing browsers are a test failure, not a silent pass.

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

Security regressions cover split UTF-8 HTTP frames, renamed active parts and relocated image parts, bounded XML trees and child memory, per-instance MCP identity, abrupt owner death, Windows helper resolution (mocked platform), PowerShell quote delimiters, two-client text spoofing, browser fetch metadata, concurrent lint/render limits, legacy board floods, safe diagnostics, all 36 tool annotations and hash-locked dependencies. Native Windows helper execution, Job Object enforcement and PowerPoint COM still require a Windows host.
