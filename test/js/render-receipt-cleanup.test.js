'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),crypto=require('node:crypto');
const source=fs.readFileSync(path.resolve(__dirname,'../../src/server.js'),'utf8');
function extract(start,end){return source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));}
test('snapshot receipt is removed after successful and failed PDF export',async()=>{
 for(const fail of [false,true]){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'slides-receipt-'));
  const context={fs,path,crypto,process:{pid:123,env:{}},Buffer,console:{error(){}},DATA:root,HERE:root,PY:'python',RENDER_PY:'render',PDF_PS1:'pdf',PDF_PATH:path.join(root,'final.pdf'),
   pdfRunning:false,thumbsRunning:false,thumbsAgain:false,pdfVer:0,state:{pdfRev:0},copyState:()=>({}),persistState:()=>true,broadcast(){},sleepMs(){},
   runCapturedProcess:async(command,args)=>{
    if(command==='python'){
     fs.writeFileSync(args[2],'PK deck');fs.writeFileSync(args[2]+'.slides-validation.json','{}');
     return {ok:!fail,error:fail?'injected failure':null};
    }
    fs.writeFileSync(args[args.indexOf('-OutPath')+1],'%PDF-1.4');return {ok:true};
   }};
  vm.createContext(context);
  vm.runInContext(extract('async function exportPdfSnapshot(', '\nfunction runPdfExport('),context);
  try{const result=await context.exportPdfSnapshot('{}',1);assert.equal(result.ok,!fail);assert.deepEqual(fs.readdirSync(root).filter(n=>n.startsWith('.pdf-')),[]);}
  finally{fs.rmSync(root,{recursive:true,force:true});}
 }
});
test('startup sweeps abandoned render and IO stages and receipts, preserving imports and ordinary files',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'slides-sweep-'));const data=path.join(root,'state');fs.mkdirSync(data);
 const stale=['.pdf-source-123-1-deadbeef00.pptx','.pdf-source-123-1-deadbeef00.pptx.slides-validation.json','.pdf-output-123-1-deadbeef00.pdf'];
 for(const name of stale)fs.writeFileSync(path.join(data,name),'stale');
 for(const name of ['.slides-render-ABC123','.io-DEF456']){fs.mkdirSync(path.join(data,name));fs.writeFileSync(path.join(data,name,'deck.pptx.slides-validation.json'),'{}');}
 const retained=['import-deadbeef.pptx.slides-validation.json','model.json','.pdf-source-personal.txt'];for(const name of retained)fs.writeFileSync(path.join(data,name),'keep');
 const context={fs,path,DATA:data,ROOT:root,console:{log(){}}};vm.createContext(context);
 vm.runInContext(extract('function sweepStaleTmpFiles()', '\nfunction sleepMs('),context);
 try{context.sweepStaleTmpFiles();assert.deepEqual(fs.readdirSync(data).sort(),retained.sort());}
 finally{fs.rmSync(root,{recursive:true,force:true});}
});
