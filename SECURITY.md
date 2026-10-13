# Security policy

ToolsEnabled's security policy applies to every ToolsEnabled product; this file states it for ToolsEnabled Slides. The full policy lives at https://toolsenabled.ai/security/. The latest release of Slides is the supported one; fixes ship as a new release.

## Report a problem

Please report a security problem privately, not in a public issue:

- use **Report a vulnerability** on this repository's **Security** tab (GitHub's private vulnerability reporting, enabled for this repository: https://github.com/ToolsEnabled/toolsenabled-slides/security/advisories/new), or
- email **security@toolsenabled.ai**.

Reports from anyone are welcome, including from the directories that list this plugin. Tell us the Slides version (the `version` in `manifest.json` and `package.json`, which your agent CLI's plugin list also shows), what you found, and how to reproduce it. We read every report, reply as soon as we can, keep you informed while we fix it, tell you when the fix is released, and credit you in the release notes if you want that.

## What we ask

Good faith means:

- you test on computers, accounts and projects that are yours or that you have permission to use;
- you stop once you can show the problem, and do not use it to go further;
- you do not access, change or keep other people's data beyond what you need to show the problem, and you delete it afterwards;
- you do not disrupt services or other people;
- you give us a reasonable chance to fix the problem before you publish it. We will not ask you to stay silent indefinitely; if we have not fixed it within 90 days of your report, you may publish.

If you are unsure whether something is covered, ask us first at the addresses above.

## Safe harbor

We want people to look for problems in Slides, and we will not treat good-faith research as an attack. If you research and report in good faith under this policy:

- we consider your research authorized, and we will not bring or support any legal action against you for it, including under anti-hacking, anti-circumvention or similar laws;
- we waive any part of our own terms that would otherwise stop you from doing that research;
- if someone else takes legal action against you for research that followed this policy, we will make it known that your research was authorized by us.

This safe harbor covers ToolsEnabled's own code and releases. It cannot grant permission for other parties' systems: report a problem in an agent CLI, a model provider or any other software we did not write to its own maker.

## Rewards

ToolsEnabled is a small, self-funded company. We do not pay rewards for reports. We are grateful for every one, and we will credit you publicly if you want that.

Like every ToolsEnabled release, Slides is provided "as is", without warranty of any kind, as this repository's [LICENSE](LICENSE) (MIT) says. This policy says how we handle reports, not that any release is free of problems.

## Security boundaries of this release

The rest of this file is the security document that ships with this release, kept as written: what Slides protects, what it does not claim, and the limits it enforces. Where it says to report privately to the package maintainer, use the addresses above.

# Security

ToolsEnabled Slides runs on loopback for one local user. Human controls are not available as MCP tools and require the dashboard session. Open the one-time URL printed at launch within ten minutes. Its secret is a URL fragment, which is never sent in an HTTP request or Referer header. The page removes that fragment and exchanges the secret once by a same-Origin JSON POST. It stores the returned token only in sessionStorage, scoped to the exact origin including its port, and sends it in the X-Slides-Session header for human controls. An independent HttpOnly, SameSite=Strict, host-only cookie is an additional factor; that cookie alone never authorizes a control. No GET returns a controller or session token. Restarting the server invalidates both values. Keep the launch URL private.

A process running as the same user can still act as the user. The dashboard session prevents casual HTTP invocation; it does not isolate hostile programs with access to the user's files, browser or process output. Host and Origin validation and JSON content checks remain in effect.

MCP clients may edit within the workspace, hold their own locks, leave notes and export a new workspace copy. Pause and content protections apply. Import and export paths are confined to the workspace; existing files are not overwritten. State lives in the private `.slides-state` directory. The server does not send presentations to a model provider.

Report security issues privately to the package maintainer with a minimal reproduction and no private presentation content.

Import parsing limits XML parts to 2 MiB each and 64 MiB total, 50,000 elements and 50,000 attributes per part (2,000,000 elements and attributes per package), depth 128, and a 200:1 ratio for parts over 1 MiB. Must-pass scale fixtures cover 200 designed slides and 200 slides including 180 freeforms with 60 vertices on one slide. Slides’ own render output does not use import volume limits; it retains the depth, DTD, active-content and image-format checks. DTDs, duplicate parts and unsupported ZIP methods are refused. Imported raster canvases are limited to 25 million pixels, GIF/APNG metadata to 10,000 frames, and total first-frame decoding to 100 million pixels per package; generated output is not subject to that import cap. Every part passes one byte-content gate, including fonts and thumbnails: bounded XML, validated PNG/JPEG/GIF, recognized font headers, or structured Windows DEVMODE/Mac plist printer records. Embedded printer plists receive XML caps; only their fixed standard Apple external plist declaration is allowed, without loading a DTD. XML cannot stand in for a font or printer part. Unsupported binaries (including BMP/TIFF/WebP) are refused; image relationships and drawing blips must resolve to validated raster parts. Validation decodes only the first image frame, scans GIF blocks and PNG frame dimensions without decoding later frames, and refuses PNG msOG embedded animation. GIF extension payloads are limited to 1 MiB; comments and later frames are removed from the bytes passed to the pixel decoder. Incomplete later GIF frames are preserved. Private import/render copies carry versioned content-hash receipts; unchanged inputs and image bytes reuse that validation. Changed bytes or missing receipts require fresh validation. Original raster bytes and animation are preserved. Python import/render helpers enforce a 768 MiB address-space ceiling on POSIX and process-memory Job Object ceiling on Windows. Import/export jobs are serialized; background rendering already uses a single running job.

Structural import caps are refusal thresholds, not a guarantee that every deck below them fits in memory. XML trees, decoded pixels and library objects can exhaust the Python helper’s 768 MiB limit sooner; a deck with 58 MiB of XML has reached that ceiling while staying within every structural cap. Such a job fails closed. Reduce image resolution or split a very large deck if import or rendering fails under the memory limit.

Board messages from agents share a 128 KiB pool within the 512 KiB board budget. Old unpinned agent messages are evicted to leave room for human notes, pins and tasks. Only the authenticated dashboard marks human provenance; author strings and request body claims confer no priority. Human notes and pins are never evicted automatically. Human-authored data can still fill the overall budget and require manual cleanup.

Embedded workbook packages, including standard Excel-backed charts, are intentionally refused. The import error directs the user to replace these charts with raster images before import. This restriction does not assert that ordinary workbook-backed charts contain malicious code.

The import pixel caps do not apply to Slides-generated output, so large output images can reach LibreOffice. LibreOffice runs with a fresh private profile and a timeout, but it is not covered by the Python helper’s memory ceiling or an OS filesystem sandbox. It can therefore consume substantially more memory before the timeout. This preserves high-resolution output; reduce output image dimensions when memory use is a concern.

Original raster byte preservation includes EXIF/GPS, XMP, ICC profiles and trailing bytes. Import validation does not scrub private image metadata; PPTX exports retain those bytes. If that metadata must be removed before sharing, strip it explicitly from the source images and replace them before export. Preserving these bytes avoids silent fidelity and animation changes.

Before PDF or PNG conversion, Slides copies the already validated deck into a private staging directory and binds preprocessing to that copy’s SHA-256. Animated GIF parts become content-addressed first-frame PNG parts with matching relationships and content types. APNG animation chunks and PNG msOG chunks are removed without pixel decoding. Signatures, rather than filenames, select projection in every part. Later frames are never decoded by the preprocessing helper, which shares the Python job queue and 768 MiB ceiling. Every GIF decoded by projection is checked against the 25 MP image and 100 MP per-pass decode caps. Static render images and package XML are not subjected to import volume caps. Projected PNGs are cached by source hash and policy version under private state (128 entries, 64 MiB); output hashes and static PNG structure are checked on reuse. Original single-frame GIFs and other media stay unchanged. The projection is used only as Office input and discarded after conversion. Original files, private base media, model state and PPTX exports retain their animation bytes.
