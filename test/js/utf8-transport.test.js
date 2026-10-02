'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const {EventEmitter}=require('node:events');const http=require('node:http');const path=require('node:path');
const root=path.resolve(__dirname,'../..');
function section(file,start,end,context){const s=fs.readFileSync(path.join(root,file),'utf8');return vm.runInNewContext(s.slice(s.indexOf(start),s.indexOf(end,s.indexOf(start)))+'\n'+context.result,context);}
test('server preserves split UTF-8 in a >64 KiB edit body',async()=>{
 const read=section('src/server.js','function readBody(req)','function requireControlJson',{result:'readBody',Buffer,setTimeout,clearTimeout,MAX_BODY_BYTES:2**21,REQUEST_BODY_TIMEOUT_MS:1000,RequestError:Error});
 const req=new EventEmitter();req.headers={};req.resume=()=>{};const value='界🙂é'.repeat(16000);const bytes=Buffer.from(JSON.stringify({text:value}));const p=read(req);
 for(let i=0;i<bytes.length;i+=65537)req.emit('data',bytes.subarray(i,i+65537));req.emit('end');assert.equal((await p).text,value);
});
for(const [file,start,end,result,invoke] of [
 ['src/mcp-ppt.js','function api(',"const text =",'api',fn=>fn('GET','/')],
 ['src/lib/bootstrap.js','function request(','async function stopChild','request', (fn,port)=>fn(port,'/')],
 ['src/ppt.js','function api(','function die(', 'api',fn=>fn('GET','/')],
])test(file+' preserves multibyte HTTP replies',async()=>{
 const value=file.includes('bootstrap')?'🙂界'.repeat(100):'🙂界é'.repeat(9000);const bytes=Buffer.from(JSON.stringify({value}));
 const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.write(bytes.subarray(0,11));setImmediate(()=>{res.write(bytes.subarray(11,65539));setImmediate(()=>res.end(bytes.subarray(65539)));});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
 try{const fn=section(file,start,end,{result,http,INSTANCE_ID:undefined,identityLost:false,PORT:port,HOST:'127.0.0.1',process,Buffer,setTimeout,clearTimeout});const r=await invoke(fn,port);assert.equal((r.body||r).value,value);}finally{await new Promise(r=>server.close(r));}
});
