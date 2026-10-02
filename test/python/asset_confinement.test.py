"""The Python renderer independently rejects an escaped assets directory."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src" / "python"))
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import render_pptx as renderer

class AssetConfinementTests(unittest.TestCase):
    def test_assets_symlink_cannot_point_outside_workspace(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir()
            outside = Path(tmp) / "outside"
            outside.mkdir()
            (outside / "example.png").write_bytes(b"outside sentinel")
            (outside / "example.mp4").write_bytes(b"outside sentinel")
            (root / "assets").symlink_to(outside, target_is_directory=True)
            with patch.object(renderer, "PROJECT_ROOT", root), patch.object(renderer, "PROJECT_ASSETS", outside):
                for resolve, source in [(renderer._resolve_image_source, "assets/example.png"),
                                        (renderer._resolve_video_source, "assets/example.mp4")]:
                    with self.assertRaisesRegex(ValueError, "inside"):
                        resolve(source)

if __name__ == "__main__":
    unittest.main()
