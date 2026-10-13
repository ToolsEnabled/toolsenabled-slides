'use strict';
const fs=require('node:fs');
const MAX_BYTES=2*1024*1024,MAX_ROWS=100;
function nextReceipts(file,receipt){
 let rows=[];
 try{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>MAX_BYTES)throw Error('Unsafe export receipt file');rows=JSON.parse(fs.readFileSync(file,'utf8'));}
 catch(e){if(e.code!=='ENOENT')throw e;}
 if(!Array.isArray(rows)||rows.some(r=>!r||typeof r!=='object'||!Array.isArray(r.files)))throw Error('Invalid export receipt ledger');
 rows=rows.slice(-(MAX_ROWS-1)).concat(receipt);
 while(Buffer.byteLength(JSON.stringify(rows))>MAX_BYTES&&rows.length>1)rows.shift();
 if(Buffer.byteLength(JSON.stringify(rows))>MAX_BYTES)throw Error('Export receipt exceeds the ledger limit');
 return rows;
}
module.exports={nextReceipts};
