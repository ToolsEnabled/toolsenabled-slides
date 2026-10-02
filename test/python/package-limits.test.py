import io, subprocess, sys, tempfile, unittest, zipfile
from pathlib import Path
from pptx import Presentation
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'src/python'))
from package_safety import validate_package, MAX_PART_ATTRIBUTES
class Limits(unittest.TestCase):
 def test_small_compressed_xml_with_excess_elements_attributes_or_ratio_is_refused(self):
  with tempfile.TemporaryDirectory() as d:
   deck=Path(d)/'deck.pptx';prs=Presentation();prs.slides.add_slide(prs.slide_layouts[6]);prs.save(deck)
   with zipfile.ZipFile(deck) as z: original={n:z.read(n) for n in z.namelist()}
   for label,xml in [('elements',b'<root>'+b'<n/>'*50001+b'</root>'),('attributes',('<root '+' '.join(f'a{i}="x"' for i in range(MAX_PART_ATTRIBUTES + 1))+'/>').encode()),('bytes',b'<root>'+b'x'*(2*1024*1024)+b'</root>')]:
    with self.subTest(label=label):
     with zipfile.ZipFile(deck,'w',zipfile.ZIP_STORED) as z:
      for n,b in original.items():z.writestr(n,b)
      z.writestr('ppt/extra.xml',xml)
     with self.assertRaisesRegex(ValueError,'XML|compression'):validate_package(deck)
 def test_child_has_a_real_OS_memory_ceiling(self):
  code='import sys;sys.path.insert(0,sys.argv[1]);from process_limits import apply_memory_limit;apply_memory_limit();import resource;assert resource.getrlimit(resource.RLIMIT_AS)[0] <= 768*1024*1024'
  if sys.platform=='win32':self.skipTest('Windows Job Object requires native qualification')
  result=subprocess.run([sys.executable,'-c',code,str(ROOT/'src/python')],capture_output=True,timeout=10)
  self.assertEqual(result.returncode,0,result.stderr)
if __name__=='__main__':unittest.main()
