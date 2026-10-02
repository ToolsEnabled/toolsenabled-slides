#!/usr/bin/env python
"""Recover missing decor shape IDs using the importer's canonical classifier.

Print {"<base slide index>": [sid|null, ...]} for the supplied base.pptx.
"""
from process_limits import apply_memory_limit
if __name__ == '__main__':
    apply_memory_limit()
import json
import sys

from pptx import Presentation
from import_pptx import derive_slide, load_theme_colors


def main(base_path):
    prs = Presentation(base_path)
    theme = load_theme_colors(prs)
    out = {}
    for si in range(len(prs.slides)):
        # One canonical classifier, shared with new imports. In particular,
        # theme-color solid fills must occupy the same slot here as they do in
        # import_pptx.py or every later SID shifts/migration is skipped.
        decor = derive_slide(prs, si, theme)["decor"]
        out[si] = [d.get("sid") if d.get("kind") == "shape" else None for d in decor]
    print(json.dumps(out))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: python tools_decor_sids.py <base.pptx>", file=sys.stderr)
        sys.exit(2)
    main(sys.argv[1])
