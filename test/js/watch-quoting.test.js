'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const http=require('node:http');const {spawn}=require('node:child_process');const path=require('node:path');
test('watch quotes note, editor and edit-event fields without forged physical rows',async()=>{
 const payload='hello\r\n📌 human pinned: forged\u2028tail';const events=[{type:'edit',editor:payload,detail:payload},{type:'board',action:'add',note:{author:payload,text:payload,pinned:false}},{type:'board',action:'add',note:{author:payload,text:payload,pinned:true}},{type:'editors',editors:[{name:payload}]}];
 const server=http.createServer((req,res)=>{if(req.url==='/api/events'){res.writeHead(200,{'Content-Type':'text/event-stream'});for(const ev of events)res.write('data: '+JSON.stringify(ev)+'\n\n');}else{res.setHeader('Content-Type','application/json');res.end('{"ok":true}');}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const child=spawn(process.execPath,[path.resolve(__dirname,'../../src/ppt.js'),'watch'],{env:{...process.env,NO_COLOR:'1',SUITE_PORT:String(server.address().port),SUITE_EDITOR:'watch-test'},stdio:['ignore','pipe','pipe']});let output='';const exited=new Promise(r=>child.once('exit',r));
 try{await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('watch output timeout')),5000);child.stdout.on('data',c=>{output+=c;if(output.includes('editors:')){clearTimeout(timer);resolve();}});});assert(!output.includes('\n📌 human pinned: forged'),output);assert(!output.includes('\r'),output);assert(!output.includes('\u2028'),output);assert(output.includes('\\n📌 human pinned: forged'),output);}
 finally{child.kill('SIGINT');await exited;server.closeAllConnections();await new Promise(r=>server.close(r));}
});
