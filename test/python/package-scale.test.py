import json, subprocess, sys, tempfile, unittest, zipfile
from pathlib import Path
from unittest import mock
from lxml import etree
from pptx import Presentation
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'src/python'))
import package_safety as safety
import render_pptx as renderer

class Scale(unittest.TestCase):
 def test_two_hundred_designed_slides_import_and_render(self):
  with tempfile.TemporaryDirectory() as d:
   deck=Path(d)/'designed.pptx'
   model={'slides':[{'id':f's{i}','layout':'blank','elements':[{'id':f't{i}','type':'title','text':f'Quarterly review {i}'},{'id':f'b{i}','type':'body','text':'Revenue, customer adoption and operational progress.'}], 'decor':[{'id':f'd{i}-{j}','kind':'shape','sid':None,'generated':True,'shapeType':'rect','box':{'x':(j%6)/6,'y':(j//6)/6,'w':0.1,'h':0.1},'fill':'#2367A1'} for j in range(36)]} for i in range(200)]}
   self.assertLess(len(json.dumps(model).encode()),2*1024*1024)
   renderer.render(model,deck)
   stats=[]
   with zipfile.ZipFile(deck) as z:
    for name in z.namelist():
     if name.endswith(('.xml','.rels')):
      data=z.read(name);nodes=list(etree.fromstring(data).iter());stats.append((len(data),len(nodes),sum(len(n.attrib) for n in nodes)))
   totals=[sum(s[i] for s in stats) for i in range(3)]; peaks=[max(s[i] for s in stats) for i in range(3)]
   print('200-slide measured XML bytes/elements/attributes:',totals,'per-part peaks:',peaks,flush=True)
   self.assertGreater(totals[2],100000)
   safety.validate_package(deck)
   self.assertEqual(len(Presentation(deck).slides),200)
   result=subprocess.run([sys.executable,str(ROOT/'src/python/import-model.py'),str(deck),str(deck)],capture_output=True,timeout=60)
   self.assertEqual(result.returncode,0,result.stderr.decode())
 def test_own_render_output_does_not_use_import_byte_budgets(self):
  with tempfile.TemporaryDirectory() as d, mock.patch.object(safety,'MAX_XML_BYTES',1),mock.patch.object(safety,'MAX_TOTAL_XML_BYTES',1):
   deck=Path(d)/'native.pptx'
   renderer.render({'slides':[{'id':'s1','elements':[{'id':'e1','type':'title','text':'A valid native deck'}]}]},deck)
   with self.assertRaisesRegex(ValueError,'XML byte budget'):safety.validate_package(deck)
if __name__=='__main__':unittest.main()
