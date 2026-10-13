'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net');
const {spawnSync}=require('node:child_process');
const {Client}=require('../helpers/mcp-client');
const {childEnv}=require('../helpers/child-env');
const root=path.resolve(__dirname,'../..');
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
test('Claude runs the bundled Node entry with plain arguments; Codex resolves its relative Node entry from the plugin cwd',()=>{
 const code=read('.claude-plugin/plugin.json'),desktop=read('manifest.json'),config=read('.mcp.json').mcpServers.slides;
 const codex=read('.codex-plugin/plugin.json');for(const key of ['name','author','homepage','repository','license'])assert.deepEqual(codex[key],code[key]);assert.equal(codex.interface.privacyPolicyURL,'https://toolsenabled.ai/legal/privacy/');assert.equal(code.name,'toolsenabled-slides');assert.equal(desktop.name,code.name);
 // The directory reads the whole command: the program by name and one plugin file. No setting is in command or argv.
 assert.equal(config.command,'node');assert.deepEqual(config.args,['${CLAUDE_PLUGIN_ROOT}/slides-mcp.js']);assert.equal(desktop.server.type,'python');
 const requiredEnv={SLIDES_WORKSPACE:'${user_config.workspace_directory}',SUITE_PYTHON:'${user_config.python_executable}',SUITE_PORT:'${user_config.port}',SLIDES_RENDERER:'${user_config.renderer}',SLIDES_SOFFICE:'${user_config.libreoffice_executable}',SUITE_ALLOWED_ORIGINS:'',SUITE_HEADERS_TIMEOUT_MS:'10000',SUITE_REQUEST_BODY_TIMEOUT_MS:'15000',SUITE_MCP_HTTP_TIMEOUT_MS:''};
 // Claude Code maps each setting into the environment and selects the same strict plugin mode as Codex; the
 // unpublished Desktop manifest keeps its Python launcher.
 assert.deepEqual(config.env,{SLIDES_PLUGIN_MODE:'1',...requiredEnv});assert.deepEqual(desktop.server.mcp_config.env,requiredEnv);
 assert.deepEqual(Object.keys(requiredEnv),read('.codex-plugin/plugin.json').mcpServers.slides.env_vars);
 assert.deepEqual(read('.codex-plugin/plugin.json').mcpServers.slides,{command:'node',args:['./slides-mcp.js'],cwd:'./',env:{SLIDES_PLUGIN_MODE:'1'},env_vars:['SLIDES_WORKSPACE','SUITE_PYTHON','SUITE_PORT','SLIDES_RENDERER','SLIDES_SOFFICE','SUITE_ALLOWED_ORIGINS','SUITE_HEADERS_TIMEOUT_MS','SUITE_REQUEST_BODY_TIMEOUT_MS','SUITE_MCP_HTTP_TIMEOUT_MS']});
 assert(!JSON.stringify(read('.codex-plugin/plugin.json')).includes('user_config'));
 for(const key of ['python_executable','node_executable','workspace_directory','libreoffice_executable'])assert.match(code.userConfig[key].description,/Absolute path/);
 assert.equal(code.userConfig.renderer.default,'auto');assert.equal(code.userConfig.libreoffice_executable.default,'');
 assert(!JSON.stringify([config.command,config.args]).includes('user_config'));assert(!config.args.some(arg=>arg.includes('"')||arg==='-c'));
});

// The launch Claude Code performs: .mcp.json with ${CLAUDE_PLUGIN_ROOT} and each configured ${user_config.KEY} substituted.
function claudeLaunch(values){
 const config=read('.mcp.json').mcpServers.slides;
 const fill=text=>text.replaceAll('${CLAUDE_PLUGIN_ROOT}',root).replace(/\$\{user_config\.([a-z_]+)\}/g,(whole,key)=>key in values?String(values[key]):whole);
 const host=childEnv(),env={PATH:host.PATH,...(host.HOME?{HOME:host.HOME}:{}),...(host.SystemRoot?{SystemRoot:host.SystemRoot}:{})};
 for(const [key,value] of Object.entries(config.env))env[key]=fill(value);
 return new Client(env,{command:config.command,args:config.args.map(fill),inheritEnv:false});
}
test('the Claude plugin launch verifies the prepared runtime and refuses missing settings before creating state',async()=>{
 const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'slides-claude-launch-'));
 const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const values={python_executable:require('../../src/lib/prerequisites').python(),workspace_directory:path.join(scratch,'Project Update'),port,renderer:'auto',libreoffice_executable:''};
 try{
  const client=claudeLaunch(values);
  try{
   await client.request('initialize',{});
   assert.match(client.stderr,new RegExp('Slides runtime verified: '+require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(root,'requirements.txt'))).digest('hex')));
   assert.equal((await (await fetch(`http://127.0.0.1:${port}/api/health`)).json()).workspace,fs.realpathSync(values.workspace_directory));
   assert.equal((await client.request('tools/list',{})).tools.length,read('test/fixtures/tools-list.json').tools.length);
  }finally{await client.close();}
  assert.equal(fs.existsSync(path.join(values.workspace_directory,'.slides-state','server.lock')),false);
  // An unset option stays an unexpanded ${user_config.KEY}. Every refusal comes before any workspace state exists.
  const unused=path.join(scratch,'refused'),inside=path.join(root,'decks');
  for(const [change,reason] of [[{python_executable:undefined},/SUITE_PYTHON.*absolute.*setup-runtime/],[{python_executable:''},/SUITE_PYTHON.*absolute.*setup-runtime/],
   [{workspace_directory:undefined},/absolute external workspace/],[{workspace_directory:inside},/absolute external workspace/]]){
   const settings={...values,workspace_directory:unused,...change};for(const key of Object.keys(settings))if(settings[key]===undefined)delete settings[key];
   const refused=claudeLaunch(settings);
   await assert.rejects(refused.request('initialize',{}),reason);assert.equal(await refused.exited,1);
   assert(!fs.existsSync(unused)&&!fs.existsSync(inside),'Refusal must precede workspace creation');
  }
 }finally{fs.rmSync(scratch,{recursive:true,force:true});}
});

test('Codex plugin startup requires an absolute external workspace before creating state',()=>{
 const {pluginWorkspace}=require('../../src/lib/bootstrap');
 for(const value of [undefined,'','relative','~','~/deck','C:deck',root,path.dirname(root),path.join(root,'.slides-workspace')])assert.throws(()=>pluginWorkspace(value),/absolute external workspace/);
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'slides-plugin-path-'));
 try{
  fs.symlinkSync(root,path.join(folder,'alias'),process.platform==='win32'?'junction':'dir');
  assert.throws(()=>pluginWorkspace(path.join(folder,'alias','new-workspace')),/absolute external workspace/);
  assert.equal(pluginWorkspace(path.join(folder,'deck space')),path.join(folder,'deck space'));
  assert(!fs.existsSync(path.join(folder,'deck space')));
 }finally{fs.rmSync(folder,{recursive:true,force:true});}
});
test('launcher refuses relative and tilde paths before creating workspace state',()=>{
 const python=require('../../src/lib/prerequisites').python();
 const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'slides-launch-refusal-'));
 try{
  for(const value of ['', 'relative','~/deck','~','C:deck'])for(const option of ['node','workspace']){
   const values={node:process.execPath,workspace:path.join(scratch,'unused'),[option]:value};
   const result=spawnSync(python,['-I',path.join(root,'src/python/mcp_launcher.py'),'--node',values.node,'--workspace',values.workspace],{encoding:'utf8',cwd:scratch});
   assert.notEqual(result.status,0);assert.match(result.stderr,/must be absolute/);
   assert.deepEqual(fs.readdirSync(scratch),[],'Refusal must precede all state creation');
  }
 }finally{fs.rmSync(scratch,{recursive:true,force:true});}
});

test('an optional LibreOffice path is absolute before any host process is started',()=>{
 const python=require('../../src/lib/prerequisites').python();
 const script=`import sys, pathlib; sys.path.insert(0, ${JSON.stringify(path.join(root,'src/python'))}); import mcp_launcher as m; m.subprocess.check_output=lambda *a,**k:'v22.19.0'; m.os.execve=lambda *a:(_ for _ in ()).throw(AssertionError('Host process reached')); m.launch(pathlib.Path(${JSON.stringify(process.execPath)}), pathlib.Path(${JSON.stringify(os.tmpdir())}) / 'slides-unused-path', 4599)`;
 for(const value of ['relative','~/app','~','C:app']){
  const result=spawnSync(python,['-I','-c',script],{encoding:'utf8',env:childEnv({SLIDES_SOFFICE:value})});
  assert.notEqual(result.status,0);assert.match(result.stderr,/LibreOffice path must be absolute/);
 }
});
test('real MCP instructions and workflow skill agree about tools and human controls',async()=>{
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'slides-skill-'));const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const config=read('.codex-plugin/plugin.json').mcpServers.slides;
 const parent={SLIDES_WORKSPACE:workspace,SUITE_PYTHON:require('../../src/lib/prerequisites').python(),SUITE_PORT:String(port)};
 const host=childEnv(),filtered={PATH:host.PATH,...(host.SystemRoot?{SystemRoot:host.SystemRoot}:{}),...config.env};
 for(const key of config.env_vars||[])if(parent[key]!==undefined)filtered[key]=parent[key];
 const client=new Client(filtered,{...config,cwd:path.resolve(root,config.cwd||'.'),inheritEnv:false});
 try{
  const init=await client.request('initialize',{});assert.match(client.stderr,new RegExp('Slides runtime verified: '+require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(root,'requirements.txt'))).digest('hex')));assert.equal((await (await fetch(`http://127.0.0.1:${port}/api/health`)).json()).workspace,fs.realpathSync(workspace));const listed=await client.request('tools/list',{});const names=new Set(listed.tools.map(t=>t.name));
  const skill=fs.readFileSync(path.join(root,'skills/toolsenabled-slides/SKILL.md'),'utf8');
  function checkContract(text){
   assert.equal(typeof text,'string');for(const tool of text.match(/ppt_[a-z_]+/g)||[])assert(names.has(tool),tool);
   assert.match(text,/not MCP tools/);assert.match(text,/human dashboard/);assert.match(text,/host (rules|rules\.)/);
  }
  for(const text of [init.instructions,skill])checkContract(text);
  assert.throws(()=>checkContract(init.instructions.replace('not MCP tools','MCP tools')));
  assert.throws(()=>checkContract(init.instructions+' Use ppt_pause for human pause.'));
  for(const name of ['ppt_pause','ppt_undo','ppt_protect'])assert(!names.has(name));
 }finally{await client.close();fs.rmSync(workspace,{recursive:true,force:true});}
});
