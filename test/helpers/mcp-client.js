'use strict';
const {spawn}=require('node:child_process');const path=require('node:path');
class Client{
 constructor(env,launch){
  this.child=spawn(launch?.command||process.execPath,launch?.args||[path.resolve(__dirname,'..','..','slides-mcp.js')],{cwd:launch?.cwd,env:{...(launch?.inheritEnv===false?{}:process.env),...env},stdio:['pipe','pipe','pipe']});
  this.next=1;this.pending=new Map();this.buffer='';this.stderr='';
  this.child.stderr.on('data',c=>{this.stderr=(this.stderr+c).slice(-16000);});
  this.child.stdout.setEncoding('utf8');this.child.stdout.on('data',c=>{this.buffer+=c;let i;while((i=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,i);this.buffer=this.buffer.slice(i+1);try{const msg=JSON.parse(line);const p=this.pending.get(msg.id);if(p){clearTimeout(p.timer);this.pending.delete(msg.id);msg.error?p.reject(new Error(JSON.stringify(msg.error))):p.resolve(msg.result);}}catch(e){this.fail(e);}}});
  this.child.on('error',e=>this.fail(e));this.exited=new Promise(resolve=>this.child.once('exit',(code,signal)=>{this.fail(new Error(`MCP exited ${code}/${signal}: ${this.stderr}`));resolve(code);}));
 }
 fail(e){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(e);}this.pending.clear();}
 request(method,params){return new Promise((resolve,reject)=>{const id=this.next++;const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`Timeout ${method}: ${this.stderr}`));},180000);this.pending.set(id,{resolve,reject,timer});this.child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});}
 async tool(name,args={}){const r=await this.request('tools/call',{name,arguments:args});if(r.isError)throw new Error(r.content[0].text);return r.content[0].text;}
 async close(){this.child.stdin.end();const timer=setTimeout(()=>this.child.kill('SIGKILL'),20000);const code=await this.exited;clearTimeout(timer);if(code!==0)throw new Error('MCP did not shut down cleanly: '+this.stderr);}
}
async function assertProcessExited(pid, timeoutMs=5000) {
 const deadline=Date.now()+timeoutMs;
 while(Date.now()<deadline){
  try{process.kill(pid,0);}catch(error){if(error.code==='ESRCH')return;throw error;}
  await new Promise(resolve=>setTimeout(resolve,25));
 }
 throw new Error('Owned suite process did not exit: '+pid);
}
module.exports={Client,assertProcessExited};
