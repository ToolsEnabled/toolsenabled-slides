'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const renderer=require('../../src/lib/renderer');
const fixturePython=require('../../src/lib/prerequisites').python();
function deck(file){const r=require('node:child_process').spawnSync(fixturePython,['-c','from pptx import Presentation;import sys;Presentation().save(sys.argv[1])',file],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);}
test('doctor recognizes the installed pinned rasterizer',()=>{
 const {spawnSync}=require('node:child_process');
 const r=spawnSync(process.execPath,[path.resolve(__dirname,'../..','src','cli','doctor.js')],{encoding:'utf8'});
 const info=JSON.parse(r.stdout);assert.equal(info.rasterizerAvailable,true,r.stdout+r.stderr);
});
test('missing rasterizer keeps PDF usable and makes PNG failure explicit',{skip:process.platform==='win32'?'POSIX executable double; real renderer proof covers Windows separately':false},async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'slides-raster-test-'));
 const env={SLIDES_SOFFICE:process.env.SLIDES_SOFFICE,SUITE_PYTHON:process.env.SUITE_PYTHON,SLIDES_RENDERER:process.env.SLIDES_RENDERER};
 const exe=path.join(tmp,'soffice');
 fs.writeFileSync(exe,`#!/usr/bin/env node\nconst fs=require('node:fs'),path=require('node:path');if(process.argv.includes('--version'))console.log('offline renderer double');else fs.writeFileSync(path.join(process.argv[process.argv.indexOf('--outdir')+1],'deck.pdf'),'%PDF-1.4\\n%%EOF');\n`,{mode:0o755});
 const limitedPython=path.join(tmp,'python-no-rasterizer');
 fs.writeFileSync(limitedPython,`#!/usr/bin/env node\nconst {spawnSync}=require('child_process');const args=process.argv.slice(2);if(args.includes('import pypdfium2'))process.exit(1);const r=spawnSync(${JSON.stringify(fixturePython)},args,{stdio:'inherit'});process.exit(r.status==null?1:r.status);\n`,{mode:0o755});
 process.env.SLIDES_SOFFICE=exe;process.env.SUITE_PYTHON=limitedPython;process.env.SLIDES_RENDERER='libreoffice';
 const source=path.join(tmp,'input.pptx');deck(source);
 try{
  assert.equal(renderer.detectRenderer().png,false);
  const pdf=path.join(tmp,'export.pdf');assert.equal((await renderer.convert(source,pdf,'pdf')).renderer,'libreoffice');
  assert.ok(fs.readFileSync(pdf,'utf8').startsWith('%PDF-'));
  await assert.rejects(renderer.convert(source,path.join(tmp,'pages'),'png'),/pypdfium2 is missing.*PDF\/PPTX remain available/);
  assert.ok(!fs.readdirSync(tmp).some(n=>n.startsWith('.slides-render-')));
 }finally{for(const [key,value] of Object.entries(env))value===undefined?delete process.env[key]:process.env[key]=value;fs.rmSync(tmp,{recursive:true,force:true});}
});
test('renderer shutdown joins its child and removes staging before returning',{skip:process.platform==='win32'?'POSIX child process group test':false},async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'slides-render-stop-'));
 const previous=process.env.SLIDES_SOFFICE;const choice=process.env.SLIDES_RENDERER;
 const exe=path.join(tmp,'soffice');const marker=path.join(tmp,'started');
 fs.writeFileSync(exe,`#!/usr/bin/env node\nconst fs=require('node:fs');if(process.argv.includes('--version'))console.log('offline renderer double');else {fs.writeFileSync(${JSON.stringify(marker)},String(process.pid));setInterval(()=>{},1000);}\n`,{mode:0o755});
 process.env.SLIDES_SOFFICE=exe;process.env.SLIDES_RENDERER='libreoffice';
 const source=path.join(tmp,'input.pptx');deck(source);
 let outcome;const pending=renderer.convert(source,path.join(tmp,'export.pdf'),'pdf').catch(e=>{outcome=e;});
 try{
  for(let i=0;i<100&&!fs.existsSync(marker);i++)await new Promise(r=>setTimeout(r,20));
  assert.ok(fs.existsSync(marker));
  const preparing=renderer.convert(source,path.join(tmp,'second.pdf'),'pdf').catch(e=>e);
  await renderer.stop();
  assert.ok(await preparing instanceof Error,'shutdown must also join a conversion still preparing its private copy');
  assert.ok(!fs.readdirSync(tmp).some(n=>n.startsWith('.slides-render-')),'shutdown must join conversion cleanup');
  await pending;assert.ok(outcome);
 }finally{
  await renderer.stop();await pending;
  previous===undefined?delete process.env.SLIDES_SOFFICE:process.env.SLIDES_SOFFICE=previous;
  choice===undefined?delete process.env.SLIDES_RENDERER:process.env.SLIDES_RENDERER=choice;
  fs.rmSync(tmp,{recursive:true,force:true});
 }
});
