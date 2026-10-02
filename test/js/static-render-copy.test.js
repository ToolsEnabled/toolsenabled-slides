'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const net=require('node:net');const crypto=require('node:crypto');const {spawnSync}=require('node:child_process');
const {Client}=require('../helpers/mcp-client');const renderer=require('../../src/lib/renderer');const python=require('../../src/lib/prerequisites').python();const root=path.resolve(__dirname,'../..');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function py(code,args=[]){const r=spawnSync(python,['-c',code,...args],{encoding:'utf8',timeout:20000});assert.equal(r.status,0,r.stderr);return r.stdout;}
function fixture(folder){
 py(`import io,runpy,sys
from pathlib import Path
from PIL import Image
from pptx import Presentation
folder=Path(sys.argv[1]);animation=runpy.run_path(sys.argv[2])['animation'];p=Presentation()
for i in range(4):p.slides.add_slide(p.slide_layouts[6]).shapes.add_picture(io.BytesIO(animation(i)+bytes([i])),0,0)
p.save(folder/'animation.pptx')
Image.new('RGB',(32,32),'white').save(folder/'fake.pdf',save_all=True,append_images=[Image.new('RGB',(32,32),'white') for _ in range(3)])`,[folder,path.join(root,'test/python/animated-render.test.py')]);
 return path.join(folder,'animation.pptx');
}
test('PDF and PNG Office inputs contain only static first-frame PNGs and preserve their source',{skip:process.platform==='win32'?'POSIX Office executable double; Python projection tests are portable':false},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'slides-static-'));const source=fixture(dir);const sourceHash=sha(source);const captures=path.join(dir,'captures');fs.mkdirSync(captures);const exe=path.join(dir,'soffice');
 fs.writeFileSync(exe,`#!/usr/bin/env node\nconst fs=require('fs'),path=require('path');if(process.argv.includes('--version'))console.log('offline Office double');else {fs.copyFileSync(process.argv.at(-1),path.join(${JSON.stringify(captures)},process.pid+'.pptx'));fs.copyFileSync(${JSON.stringify(path.join(dir,'fake.pdf'))},path.join(process.argv[process.argv.indexOf('--outdir')+1],'deck.pdf'));}\n`,{mode:0o755});
 const saved={SLIDES_SOFFICE:process.env.SLIDES_SOFFICE,SLIDES_RENDERER:process.env.SLIDES_RENDERER};process.env.SLIDES_SOFFICE=exe;process.env.SLIDES_RENDERER='libreoffice';
 try{
  for(const format of ['pdf','png']){
   const result=await renderer.convert(source,path.join(dir,format==='pdf'?'out.pdf':'pages'),format);assert.equal(result.files.length,format==='pdf'?1:4);assert.equal(sha(source),sourceHash);
  }
  const inputs=fs.readdirSync(captures);assert.equal(inputs.length,2);
  for(const name of inputs)py(`import io,sys,zipfile
from PIL import Image
from pptx import Presentation
before,after=map(Presentation,sys.argv[1:3]);assert len(after.slides)==4
with zipfile.ZipFile(sys.argv[2]) as z:
 for n in z.namelist():
  if '/media/' in n:assert not z.read(n).startswith((b'GIF87a',b'GIF89a')), 'Office input still contains GIF media'
for a,b in zip(before.slides,after.slides):
 x,y=a.shapes[0],b.shapes[0]
 assert (x.left,x.top,x.width,x.height)==(y.left,y.top,y.width,y.height)
 with Image.open(io.BytesIO(x.image.blob)) as original,Image.open(io.BytesIO(y.image.blob)) as static:
  assert static.format=='PNG' and getattr(static,'n_frames',1)==1
  assert original.size==static.size==(1920,1080)
  assert original.convert('RGBA').tobytes()==static.convert('RGBA').tobytes()
sys.path.insert(0,sys.argv[3]);from package_safety import validate_package
validate_package(sys.argv[2],import_limits=False)`,[source,path.join(captures,name),path.join(root,'src/python')]);
  assert(!fs.readdirSync(dir).some(n=>n.startsWith('.slides-render-')));
 }finally{await renderer.stop();for(const [k,v] of Object.entries(saved))v===undefined?delete process.env[k]:process.env[k]=v;fs.rmSync(dir,{recursive:true,force:true});}
});
test('actual MCP PPTX export keeps original animated GIF bytes and leaves the imported model unchanged',async()=>{
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'slides-original-gifs-'));const source=fixture(workspace);const originalHash=sha(source);const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));const client=new Client({SLIDES_WORKSPACE:workspace,SUITE_PORT:String(port),SLIDES_SOFFICE:path.join(os.tmpdir(),'slides-no-office-installed')});
 try{
  await client.tool('ppt_lock',{slide_ids:['s1']});await client.tool('ppt_import',{path:'animation.pptx'});const before=await client.tool('ppt_show');await client.tool('ppt_export',{path:'originals.pptx',format:'pptx'});assert.equal(await client.tool('ppt_show'),before);assert.equal(sha(source),originalHash);
  py(`import sys,zipfile,hashlib
def media(file):
 with zipfile.ZipFile(file) as z:return sorted(hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist() if '/media/' in n)
assert media(sys.argv[1])==media(sys.argv[2]);assert len(media(sys.argv[1]))==4`,[source,path.join(workspace,'originals.pptx')]);
 }finally{await client.close();fs.rmSync(workspace,{recursive:true,force:true});}
});
