'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),net=require('node:net');
const {Client}=require('../helpers/mcp-client');const root=path.resolve(__dirname,'../..');
function snapshot(folder){const out={};for(const item of fs.readdirSync(folder,{recursive:true,withFileTypes:true})){if(item.isFile()){const file=path.join(item.parentPath,item.name);out[path.relative(folder,file)]=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}}return out;}
test('Python launcher and render helpers never write into the installed plugin',async()=>{
 const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'slides-readonly-'));const plugin=path.join(scratch,'plugin');
 fs.cpSync(root,plugin,{recursive:true,filter:p=>!['.git','.venv','node_modules','data','__pycache__','.slides-state'].includes(path.basename(p))});
 const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const before=snapshot(plugin);const python=require('../../src/lib/prerequisites').python();
 const client=new Client({PATH:process.env.PATH},{command:python,args:['-I',path.join(plugin,'src/python/mcp_launcher.py'),'--node',process.execPath,'--workspace',path.join(scratch,'deck'),'--port',String(port)],cwd:plugin,inheritEnv:false});
 try{await client.request('initialize',{});await client.tool('ppt_lock',{slide_ids:['s1']});await client.tool('ppt_add_slide',{title:'Read-only plugin'});await client.tool('ppt_lint',{});}finally{await client.close();}
 try{assert.deepEqual(snapshot(plugin),before);}finally{fs.rmSync(scratch,{recursive:true,force:true});}
});
