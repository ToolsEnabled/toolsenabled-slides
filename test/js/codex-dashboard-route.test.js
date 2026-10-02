'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net');
const {spawn}=require('node:child_process');const {Client}=require('../helpers/mcp-client');
const root=path.resolve(__dirname,'../..');
test('human terminal studio supplies the dashboard before a Codex plugin attaches',async()=>{
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'slides-human-studio-'));
 const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const env={...process.env,SLIDES_PLUGIN_MODE:'1',SLIDES_WORKSPACE:workspace,SUITE_PYTHON:require('../../src/lib/prerequisites').python(),SUITE_PORT:String(port)};
 const server=spawn(process.execPath,[path.join(root,'src/cli/studio.js')],{env,stdio:['ignore','pipe','pipe']});
 const closed=new Promise(r=>server.once('close',r));let output='',client;
 for(const stream of [server.stdout,server.stderr])stream.on('data',chunk=>output+=chunk);
 try{
  for(let i=0;i<200&&!output.includes('/studio#launch=');i++)await new Promise(r=>setTimeout(r,50));
  const launch=output.match(/http:\/\/[^\s]+\/studio#launch=[a-f0-9]{64}/)?.[0];assert(launch,'human terminal must show launch link');
  const auth=await require('../helpers/dashboard').redeem(launch);assert(auth['X-Slides-Session']);
  client=new Client(env);await client.request('initialize',{});assert.match(client.stderr,/attached/);assert(!client.stderr.includes('#launch='));
  assert.equal((await client.request('tools/list',{})).tools.length,36);await client.close();client=null;
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/health`)).status,200);
 }finally{if(client){client.child.stdin.end();await client.exited;}server.kill('SIGTERM');await closed;fs.rmSync(workspace,{recursive:true,force:true});}
});
