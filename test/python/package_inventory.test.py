import importlib.util,json,subprocess,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('package_inventory',Path(__file__).resolve().parents[2]/'tools/package_inventory.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
class InventoryTests(unittest.TestCase):
 def fixture(self,git=False):
  temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup);root=Path(temp.name);(root/'tools').mkdir();(root/'hooks').mkdir();(root/'README.md').write_text('Synthetic release\n');(root/'hooks/register.tsx').write_text('export const register=on=>{}\n');names=['README.md','hooks/register.tsx','tools/source-files.json'];(root/'tools/source-files.json').write_text(json.dumps(names))
  if git:
   def run(*args):return subprocess.run(['git','-C',str(root),*args],capture_output=True,text=True,check=True)
   run('init','-q');run('add','.');run('-c','user.name=Synthetic','-c','user.email=synthetic@example.invalid','commit','-qm','fixture')
  return root
 def test_archive_without_git_binary_uses_exact_inventory(self):
  root=self.fixture()
  with patch.object(mod.subprocess,'run',side_effect=FileNotFoundError('git')):files=mod.files(root)
  self.assertEqual([n for n,p in files],['README.md','hooks/register.tsx','tools/source-files.json'])
 def test_stale_inventory_refused_in_checkout(self):
  root=self.fixture(True);(root/'tools/source-files.json').write_text('["README.md"]')
  with self.assertRaisesRegex(ValueError,'inventory|snapshot'):mod.files(root)
 def test_dirty_tracked_source_is_refused(self):
  root=self.fixture(True);(root/'README.md').write_text('Uncommitted change')
  with self.assertRaisesRegex(ValueError,'clean|uncommitted'):mod.files(root)
 def test_archive_extras_not_discovered(self):
  root=self.fixture();(root/'private.txt').write_text('never packaged');self.assertNotIn('private.txt',[n for n,p in mod.files(root)])
if __name__=='__main__':unittest.main()
