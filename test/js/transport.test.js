'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');
const {spawn}=require('node:child_process');
async function transport(input){
 const child=spawn(process.execPath,[path.resolve(__dirname,'../..','src/mcp-ppt.js')],{env:{...process.env,SLIDES_MCP:'1'},stdio:['pipe','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);
 const exited=new Promise(r=>child.once('exit',r));const timer=setTimeout(()=>child.kill('SIGKILL'),3000);
 child.stdin.on('error',()=>{});child.stdin.end(input);await exited;clearTimeout(timer);return {stdout,stderr};
}
test('MCP queue rejects an unbounded burst before retaining it',async()=>{
 const input=Array.from({length:1000},(_,id)=>JSON.stringify({jsonrpc:'2.0',id,method:'ping'})+'\n').join('');
 const r=await transport(input);assert.match(r.stderr,/queue limit/i);
});
test('malformed long method or id cannot generate an unbounded reply',async()=>{
 const r=await transport(JSON.stringify({jsonrpc:'2.0',id:'a'.repeat(100000),method:'b'.repeat(100000)})+'\n');
 assert.ok(Buffer.byteLength(r.stdout)<1000);const reply=JSON.parse(r.stdout);assert.equal(reply.error.code,-32600);assert.equal(reply.id,null);
});
