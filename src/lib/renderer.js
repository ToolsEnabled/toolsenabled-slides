'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {spawn,spawnSync}=require('./helper-paths');
function probe(cmd,args){return spawnSync(cmd,args,{encoding:'utf8',timeout:10000,windowsHide:true,maxBuffer:16384});}
function detectRenderer(){
 const choice=process.env.SLIDES_RENDERER || 'auto';
 if(!['auto','libreoffice','powerpoint'].includes(choice))throw new Error('SLIDES_RENDERER must be auto, libreoffice or powerpoint');
 if(process.platform==='win32' && choice!=='libreoffice'){
  const r=probe('powershell',['-NoProfile','-NonInteractive','-Command',"if ([type]::GetTypeFromProgID('PowerPoint.Application')) { exit 0 } else { exit 1 }"]);
  if(r.status===0)return {renderer:'powerpoint',png:true};
 }
 if(choice==='powerpoint')throw new Error('PowerPoint renderer requires Windows and desktop PowerPoint');
 let soffice;
 try{soffice=require('./helper-paths').resolveExecutable(process.env.SLIDES_SOFFICE || 'soffice');}catch{throw new Error('LibreOffice is required for PDF/PNG; set SLIDES_SOFFICE to an absolute executable outside the workspace.');}
 const r=probe(soffice,['--version']);
 if(r.status!==0)throw new Error('LibreOffice is required for PDF/PNG. Install LibreOffice Impress (Ubuntu: sudo apt-get install libreoffice-impress), or set SLIDES_SOFFICE to soffice.');
 let raster;let png=false;
 try{raster=require('./prerequisites').python();png=probe(raster,['-I','-B','-c','import pypdfium2']).status===0;}catch{}
 return {renderer:'libreoffice',version:r.stdout.trim().slice(0,120),soffice,rasterizer:'pypdfium2',raster,png};
}
const children=new Set();
const conversions=new Set();
let stopping=false;
function signalChild(child,signal){
 try{if(process.platform!=='win32')process.kill(-child.pid,signal);else child.kill(signal);}catch{child.kill(signal);}
}
async function stop(){
 stopping=true;
 await Promise.all([...children].map(child=>new Promise(resolve=>{
  const timer=setTimeout(()=>signalChild(child,'SIGKILL'),1500);
  child.once('close',()=>{clearTimeout(timer);resolve();});
  signalChild(child,'SIGTERM');
 })));
 await Promise.allSettled([...conversions]);
}
function run(cmd,args){return new Promise((resolve,reject)=>{
 if(stopping)return reject(new Error('Renderer is stopping'));
 const child=spawn(cmd,args,{stdio:['ignore','pipe','pipe'],windowsHide:true,detached:process.platform!=='win32',env:{...process.env,SAL_USE_VCLPLUGIN:'svp'}});
 children.add(child);
 let log='';let timedOut=false;const timer=setTimeout(()=>{timedOut=true;signalChild(child,'SIGKILL');},90000);
 for(const stream of [child.stdout,child.stderr])stream.on('data',c=>{log=(log+c).slice(-4096);});
 child.once('error',e=>{children.delete(child);clearTimeout(timer);reject(e);});
 child.once('close',code=>{
  if(code!==0)console.error('Renderer failed:',log);children.delete(child);clearTimeout(timer);
  if(code===0&&!timedOut)return resolve();
  const error=new Error(timedOut?'Renderer timed out':`Renderer failed (${code}); see the local suite log`);
  if(timedOut)error.code='RENDERER_TIMEOUT';
  reject(error);
 });
});}
function convert(source,destination,format='pdf',options={}){
 if(stopping)return Promise.reject(new Error('Renderer is stopping'));
 const conversion=convertPrivate(source,destination,format,options).finally(()=>conversions.delete(conversion));
 conversions.add(conversion);return conversion;
}
async function convertPrivate(source,destination,format,options){
 if(!['pdf','png'].includes(format))throw new Error('Renderer format must be pdf or png');
 const info=detectRenderer();
 const stage=fs.mkdtempSync(path.join(path.dirname(destination),'.slides-render-'));
 try{
  // A private copy and profile prevent locking a live deck or attaching to another Office process.
  const original=path.join(stage,'source.pptx');fs.copyFileSync(source,original);
  const digest=crypto.createHash('sha256');
  for await(const chunk of fs.createReadStream(original))digest.update(chunk);
  const input=path.join(stage,'deck.pptx');
  await require('./python-jobs').run(()=>run(require('./prerequisites').python(),[path.join(__dirname,'..','python','static_render_copy.py'),original,input,digest.digest('hex'),...(options.cacheDirectory?[options.cacheDirectory]:[])]));
  const pdf=path.join(stage,'deck.pdf');
  if(info.renderer==='powerpoint'){
   await run('powershell',['-NoProfile','-NonInteractive','-File',path.join(__dirname,'..','..','scripts','windows',format==='png'?'export_thumbs.ps1':'export_pdf.ps1'),'-Path',input,...(format==='png'?['-OutDir',stage]:['-OutPath',pdf])]);
  }else{
   await run(info.soffice,[`-env:UserInstallation=${pathToFileURL(path.join(stage,'profile')).href}`,'--headless','--convert-to','pdf:impress_pdf_Export','--outdir',stage,input]);
   if(format==='png'){
    if(!info.png)throw new Error('PNG thumbnails unavailable: pypdfium2 is missing. Install with the configured Python: python -m pip install --require-hashes -r requirements.txt. PDF/PPTX remain available.');
    await run(info.raster,[path.join(__dirname,'..','python','rasterize.py'),pdf,stage]);
   }
  }
  if(format==='pdf'){
   if(fs.readFileSync(pdf).subarray(0,5).toString()!=='%PDF-')throw new Error('Renderer did not produce a valid PDF');
   fs.copyFileSync(pdf,destination);return {renderer:info.renderer,files:[destination]};
  }
  fs.mkdirSync(destination,{recursive:true,mode:0o700});
  const files=fs.readdirSync(stage).filter(n=>/^slide-\d+\.png$/i.test(n)).sort((a,b)=>Number(a.match(/\d+/)[0])-Number(b.match(/\d+/)[0]));
  if(!files.length)throw new Error('Renderer produced no PNG pages');
  const out=files.map((name,i)=>{const dest=path.join(destination,`slide-${i+1}.png`);fs.copyFileSync(path.join(stage,name),dest);return dest;});
  return {renderer:info.renderer,files:out};
 }finally{fs.rmSync(stage,{recursive:true,force:true});}
}
module.exports={detectRenderer,convert,stop};
