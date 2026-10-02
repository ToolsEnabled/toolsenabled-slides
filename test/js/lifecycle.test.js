'use strict';
const {test}=require('node:test');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {proof}=require('../prove-lifecycle');
test('stdio builds, exports and imports a real three-slide PPTX, attaches and closes',async()=>{const out=fs.mkdtempSync(path.join(os.tmpdir(),'slides-proof-'));try{await proof(out,{pptxOnly:true});}finally{fs.rmSync(out,{recursive:true,force:true});}});
let reason;try{require('../../src/lib/renderer').detectRenderer();}catch(e){reason=e.message;}
test('real LibreOffice PDF and three PNG pages through stdio',{skip:reason},async()=>{const out=fs.mkdtempSync(path.join(os.tmpdir(),'slides-lo-proof-'));try{await proof(out);}finally{fs.rmSync(out,{recursive:true,force:true});}});
