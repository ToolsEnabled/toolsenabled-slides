# Final deck acceptance

Run `npm test` to generate a synthetic three-slide deck and verify slide order, readable fonts, geometry, footer clearance, notes, imported media, package integrity, and the render marker. The reusable render/import tests also cover rich text, tables, shape presets, native overlays, animation, and media.

Run `env -u DISPLAY node test/prove-lifecycle.js --output ./proof` on a machine with the documented prerequisites. It builds a three-slide deck through stdio MCP, exports PPTX/PDF/PNG, reimports the PPTX, and verifies startup, attachment, and shutdown. Inspect all three PNG pages for layout, text clipping, contrast, and font substitution before distributing a presentation.
