'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),net=require('node:net');
const {Client}=require('../helpers/mcp-client');const root=path.resolve(__dirname,'../..');
function snapshot(folder){const out={};for(const item of fs.readdirSync(folder,{recursive:true,withFileTypes:true})){if(item.isFile()){const file=path.join(item.parentPath,item.name);out[path.relative(folder,file)]=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}}return out;}
test('the Claude plugin launch, the Python launcher and render helpers never write into the installed plugin',async()=>{
 const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'slides-readonly-'));const plugin=path.join(scratch,'plugin');
 fs.cpSync(root,plugin,{recursive:true,filter:p=>!['.git','.venv','node_modules','data','__pycache__','.slides-state'].includes(path.basename(p))});
 const freePort=async()=>{const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));return port;};
 const before=snapshot(plugin);const python=require('../../src/lib/prerequisites').python();
 // Claude Code: .mcp.json with the plugin root and the configured options substituted. Desktop manifest: the Python launcher.
 const claude=JSON.parse(fs.readFileSync(path.join(plugin,'.mcp.json'),'utf8')).mcpServers.slides;
 const launches=[port=>{const values={workspace_directory:path.join(scratch,'claude deck'),python_executable:python,port,renderer:'auto',libreoffice_executable:''};
   const fill=text=>text.replaceAll('${CLAUDE_PLUGIN_ROOT}',plugin).replace(/\$\{user_config\.([a-z_]+)\}/g,(whole,key)=>String(values[key]));
   return {command:claude.command,args:claude.args.map(fill),env:Object.fromEntries(Object.entries(claude.env).map(([key,value])=>[key,fill(value)]))};},
  port=>({command:python,args:['-I',path.join(plugin,'src/python/mcp_launcher.py'),'--node',process.execPath,'--workspace',path.join(scratch,'deck'),'--port',String(port)],env:{}})];
 try{
  for(const launch of launches){
   const {command,args,env}=launch(await freePort());
   const client=new Client({PATH:process.env.PATH,...env},{command,args,cwd:plugin,inheritEnv:false});
   try{await client.request('initialize',{});await client.tool('ppt_lock',{slide_ids:['s1']});await client.tool('ppt_add_slide',{title:'Read-only plugin'});await client.tool('ppt_lint',{});}finally{await client.close();}
  }
  assert.deepEqual(snapshot(plugin),before);
 }finally{fs.rmSync(scratch,{recursive:true,force:true});}
});
