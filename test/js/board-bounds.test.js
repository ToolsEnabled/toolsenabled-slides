'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const os=require('node:os');const net=require('node:net');const {Client}=require('../helpers/mcp-client');
const source=fs.readFileSync(path.resolve(__dirname,'../../src/server.js'),'utf8');
test('notes refuse control floods and bound per-author storage',()=>{
 const from=source.indexOf('function addNoteTo(');let id=0;const add=vm.runInNewContext(source.slice(from,source.indexOf('function addNote(',from))+'\naddNoteTo',{shortId:()=>String(++id),Buffer});const target={notes:[]};assert.throws(()=>add(target,{text:'\u0001'.repeat(4000),author:'agent'}),/control/i);
 for(let i=0;i<105;i++) {for(const n of target.notes)n.ts=0;add(target,{text:'ordinary '+i,author:'agent'});}assert(target.notes.length<=100);
});
test('legacy oversized board does not disable MCP read tools after restart',async()=>{
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'slides-board-'));const data=path.join(workspace,'.slides-state');fs.mkdirSync(data);fs.writeFileSync(path.join(data,'board.json'),JSON.stringify({notes:Array.from({length:190},(_,i)=>({id:'n'+i,text:'\u0001'.repeat(4000),author:'old-agent',pinned:false,ts:1+i})),tasks:[],loops:[]}));
 const sock=net.createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));const client=new Client({SLIDES_WORKSPACE:workspace,SUITE_PORT:String(port)});
 try{for(const name of ['ppt_show','ppt_board','ppt_search'])await client.tool(name,name==='ppt_search'?{query:'welcome'}:{});const res=await fetch(`http://127.0.0.1:${port}/api/board`);const body=await res.json();assert(Buffer.byteLength(JSON.stringify(body))<300000);assert(body.hasMore);assert(body.nextOffset>0);}
 finally{await client.close();fs.rmSync(workspace,{recursive:true,force:true});}
});
