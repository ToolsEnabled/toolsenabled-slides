import json, runpy, subprocess, tempfile, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
files = runpy.run_path(str(ROOT / 'tools/package_inventory.py'))['files']
class Inventory(unittest.TestCase):
    def test_git_inventory_omits_untracked_files_and_registry_sidecars(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); (root / 'src').mkdir(); (root / 'tools').mkdir()
            (root / 'README.md').write_text('tracked'); (root / 'src/module.js').write_text('tracked')
            subprocess.run(['git','init','-q',str(root)],check=True)
            subprocess.run(['git','-C',str(root),'add','.'],check=True)
            (root / 'src/untracked.json').write_text('must not ship')
            (root / 'tools/server.json').write_text('must not ship')
            subprocess.run(['git','-C',str(root),'add','tools/server.json'],check=True)
            (root / 'tools/source-files.json').write_text(json.dumps(['README.md','src/module.js','tools/server.json','tools/source-files.json']))
            subprocess.run(['git','-C',str(root),'add','tools/source-files.json'],check=True)
            subprocess.run(['git','-C',str(root),'-c','user.name=Synthetic','-c','user.email=synthetic@example.invalid','commit','-qm','release fixture'],check=True)
            self.assertEqual([name for name, _ in files(root)], ['README.md','src/module.js','tools/source-files.json'])
    def test_extracted_mcpb_uses_snapshot_without_discovering_extras(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); (root / 'tools').mkdir()
            (root / 'README.md').write_text('tracked')
            (root / 'tools/untracked.json').write_text('not in snapshot')
            (root / 'tools/source-files.json').write_text(json.dumps(['.gitignore', 'README.md', 'tools/source-files.json']))
            self.assertEqual([name for name, _ in files(root)], ['README.md','tools/source-files.json'])
if __name__ == '__main__': unittest.main()
