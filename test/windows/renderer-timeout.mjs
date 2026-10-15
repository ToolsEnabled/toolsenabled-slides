import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{Client}=require('../helpers/mcp-client.js');
const [root,exe]=process.argv.slice(2),workspace=path.join(root,"workspace's résumé");fs.mkdirSync(workspace);
const preload=path.join(root,'deadline.cjs');
// Test-only accelerator in the owning suite, exercising the unchanged real 90-second timeout branch.
fs.writeFileSync(preload,"const original=setTimeout;global.setTimeout=(fn,ms,...args)=>original(fn,ms===90000?5000:ms,...args);\n");
const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
const client=new Client({SLIDES_WORKSPACE:workspace,SUITE_PORT:String(port),SLIDES_SOFFICE:exe,SLIDES_RENDERER:'libreoffice',SLIDES_TEST_RENDER_RECEIPTS:path.join(root,'processes'),NODE_OPTIONS:'--require "'+preload.replaceAll('\\','/')+'"'});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function inFlight(mode,expected){
 const work=path.join(root,mode);fs.mkdirSync(work);const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const number=listener.address().port;await new Promise(r=>listener.close(r));
 let guardian,guardianClosed;let guardianLog='';
 if(mode==='in-flight-owner-EOF'){
  const base=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
  // The same guarded server and private stdin contract used by bootstrap/studio. This is a persistent owner,
  // separate from an attached MCP, so EOF interrupts the renderer without discarding queued MCP requests.
  guardian=spawn(require('../../src/lib/prerequisites.js').python(),['-I','-S','-B',path.join(base,'src/python/node_child.py'),'--inherit-environment','--',process.execPath,path.join(base,'src/server.js')],{env:require('../helpers/child-env.js').childEnv({SLIDES_WORKSPACE:work,SUITE_PORT:String(number),SLIDES_OWNER_STDIN:'1',SLIDES_SOFFICE:exe,SLIDES_RENDERER:'libreoffice',SLIDES_TEST_RENDER_RECEIPTS:path.join(root,'processes')}),stdio:['pipe','pipe','pipe']});
  guardian.stdout.on('data',b=>guardianLog+=b);guardian.stderr.on('data',b=>guardianLog+=b);guardian.stdin.on('error',()=>{});guardianClosed=new Promise(r=>guardian.once('close',r));
  const until=Date.now()+15000;let ready=false;while(Date.now()<until&&guardian.exitCode===null){try{ready=(await(await fetch('http://127.0.0.1:'+number+'/api/health')).json()).ok;if(ready)break;}catch{}await pause(25);}assert(ready,'guarded persistent suite did not start: '+guardianLog);
 }
 const owner=new Client({SLIDES_WORKSPACE:work,SUITE_PORT:String(number),SLIDES_SOFFICE:exe,SLIDES_RENDERER:'libreoffice',SLIDES_TEST_RENDER_RECEIPTS:path.join(root,'processes')});
 let outcome;
 try{
  await owner.tool('ppt_show');const pid=(await(await fetch('http://127.0.0.1:'+number+'/api/health')).json()).pid;
  const pending=owner.request('tools/call',{name:'ppt_export',arguments:{path:'interrupted.pdf',format:'pdf'}}).then(value=>{outcome=value;},error=>{outcome={error:String(error)};});
  const until=Date.now()+15000;
  while(Date.now()<until){const files=fs.readdirSync(path.join(root,'processes')).filter(n=>n.endsWith('.json'));if(files.length===expected){const ready=files.filter(n=>fs.existsSync(path.join(root,'processes',n+'.retained'))).length;if(ready===expected)break;}await pause(25);}
  assert.equal(fs.readdirSync(path.join(root,'processes')).filter(n=>n.endsWith('.json.retained')).length,expected,'native observer did not retain process identities before cancellation');
  if(guardian){guardian.stdin.end();assert.equal(await guardianClosed,0,guardianLog);}else{owner.child.kill('SIGKILL');await owner.exited;}
  await pending;assert(outcome?.isError||outcome?.error,'in-flight renderer returned success at owner shutdown');
  const deadline=Date.now()+10000;while(fs.existsSync(path.join(work,'.slides-state','server.lock'))&&Date.now()<deadline)await pause(25);
  assert(!fs.existsSync(path.join(work,'.slides-state','server.lock')),'in-flight shutdown left the suite lease');
  await require('../helpers/mcp-client.js').assertProcessExited(pid);
  assert(!fs.existsSync(path.join(work,'interrupted.pdf')),'shutdown published partial output');assert(!fs.readdirSync(work).some(n=>n.startsWith('.slides-render-')),'shutdown left private renderer staging');
  if(guardian)await owner.close();
 }finally{if(owner.child.exitCode===null&&owner.child.signalCode===null){owner.child.kill('SIGKILL');await owner.exited;}if(guardian&&guardian.exitCode===null&&guardian.signalCode===null){guardian.kill('SIGKILL');await guardianClosed;}fs.writeFileSync(path.join(root,mode+'-stderr.log'),owner.stderr+guardianLog);}
}
try{
 await client.tool('ppt_show');
 for(const format of ['pdf','png']){
  const output=format==='pdf'?'deadline.pdf':'deadline-pages';
  const result=await client.request('tools/call',{name:'ppt_export',arguments:{path:output,format}});
  assert(result.isError,JSON.stringify(result));assert.match(JSON.stringify(result),/renderer timed out/i);
  assert(!JSON.stringify(result).includes(root),'private native path leaked');assert(!fs.existsSync(path.join(workspace,output)),'partial output published');
  assert(!fs.readdirSync(workspace).some(name=>name.startsWith('.slides-render-')),'private staging survived timeout');
 }
 await client.close();assert(!fs.existsSync(path.join(workspace,'.slides-state','server.lock')),'EOF left the lease');
 await inFlight('in-flight-owner-EOF',3);await inFlight('in-flight-owner-death',4);
 console.log('NATIVE_RENDERER_CUSTODY_CLIENT_PASS 4');
}finally{if(client.child.exitCode===null&&client.child.signalCode===null){client.child.kill('SIGKILL');await client.exited;}fs.writeFileSync(path.join(root,'mcp-stderr.log'),client.stderr);}
