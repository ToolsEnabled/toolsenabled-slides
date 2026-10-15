'use strict';
// Real-child environment isolation for the Slides pane launches.
// `claude plugin test` has no process implementation ("no implementation for process.run"), so this
// drives the hook's own launch builders from hooks/view-contract.mjs and starts each launch the way
// Claude Code 2.1.287 starts $.process.run: the init env is set over the client's own environment
// (additive, strace-confirmed). The children are real Node processes that report variable NAMES only.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process'),{pathToFileURL}=require('node:url');
const ROOT=path.resolve(__dirname,'../..');
const contract=()=>import(pathToFileURL(path.join(ROOT,'hooks/view-contract.mjs')).href);
// Synthetic client credentials, loader hooks and host-only settings a pane child must never inherit.
const INHERITED={ANTHROPIC_API_KEY:'synthetic-not-a-key',CLAUDE_CODE_MESSAGING_TOKEN:'synthetic-not-a-token',CLAUDE_CODE_OAUTH_TOKEN:'synthetic-not-a-token',
 GITHUB_TOKEN:'synthetic-not-a-token',NODE_OPTIONS:'--no-warnings',SLIDES_ENV_CANARY:'synthetic-marker',SystemRoot:'C:\\Windows',SSL_CERT_FILE:'/synthetic/ca.pem',TERM:'xterm-256color'};
const READER=['HOME','LANG','PATH','SLIDES_RENDERER','SLIDES_SOFFICE','SLIDES_WORKSPACE','SUITE_PORT','SUITE_PYTHON'];
const PROBE=['HOME','LANG','PATH','SLIDES_PLUGIN_MODE','SLIDES_RENDERER','SLIDES_SOFFICE','SLIDES_WORKSPACE','SUITE_PYTHON'];
if(process.platform==='win32'){READER.push('SystemRoot');PROBE.push('SystemRoot');}
const RECORDER="process.stdout.write(JSON.stringify({names:Object.keys(process.env).sort()}))\n";
function scratch(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'slides-pane-env-')),plugin=path.join(dir,'plugin'),home=path.join(dir,'home');
 fs.mkdirSync(path.join(plugin,'src/cli'),{recursive:true});fs.mkdirSync(home);
 fs.mkdirSync(path.join(plugin,'src/python'),{recursive:true});
 for(const name of ['node_child.py','windows_lifetime.py'])fs.copyFileSync(path.join(ROOT,'src/python',name),path.join(plugin,'src/python',name));
 // The recorder sits at the reader and probe paths; argv, cwd and launcher are the hook's own.
 for(const name of ['view.js','doctor.js'])fs.writeFileSync(path.join(plugin,'src/cli',name),RECORDER);
 const preload=path.join(dir,'must-not-load.cjs'),marker=path.join(dir,'loader-ran');
 fs.writeFileSync(preload,`require('node:fs').writeFileSync(${JSON.stringify(marker)},'unexpected loader');throw new Error('inherited Node startup hook ran');`);
 const client={PATH:process.env.PATH||'/usr/bin:/bin',HOME:home,LANG:'C.UTF-8',...INHERITED,NODE_OPTIONS:'--require "'+preload.replaceAll('\\','/')+'"'};
 return {dir,plugin,client,close:()=>{assert(!fs.existsSync(marker),'inherited startup hook executed');fs.rmSync(dir,{recursive:true,force:true});}};
}
const options=dir=>({node_executable:process.execPath,workspace_directory:path.join(dir,'workspace with spaces'),python_executable:process.env.SUITE_PYTHON||'/usr/bin/python3',port:4599,renderer:'auto',libreoffice_executable:''});
// What the 2.1.287 client does with a $.process.run call: argv[0] and the rest, cwd, init env over its own env.
function run(launch,client){return spawnSync(launch.argv[0],launch.argv.slice(1),{cwd:launch.init.cwd,env:{...client,...(launch.init.env||{})},encoding:'utf8',timeout:launch.init.timeoutMs||30000});}
function names(result){assert.equal(result.status,0,'recorder child failed');return JSON.parse(result.stdout).names;}
test('pane reader child receives only its allowlisted variable names',async t=>{
 const {readerLaunch}=await contract(),s=scratch();try{
  for(const query of [{view:'home'},{view:'slide',selector:'s1 $(literal)',offset:8,revision:'a'.repeat(64)},{view:'tasks',all:true},{view:'help',limit:2}]){
   const launch=readerLaunch({root:s.plugin,options:options(s.dir),host:s.client,...query}),seen=names(run(launch,s.client));
   t.diagnostic(`reader ${query.view}: ${seen.join(',')}`);
   assert.deepEqual(seen,READER);
  }
 }finally{s.close();}
});
test('renderer probe child receives only its allowlisted variable names',async t=>{
 const {probeLaunch}=await contract(),s=scratch();try{
  const seen=names(run(probeLaunch({root:s.plugin,options:options(s.dir),host:s.client}),s.client));
  t.diagnostic(`probe: ${seen.join(',')}`);
  assert.deepEqual(seen,PROBE);
 }finally{s.close();}
});
test('a client without HOME or LANG passes neither, and nothing else replaces them',async()=>{
 const {readerLaunch}=await contract(),s=scratch();try{
  const client={...s.client};delete client.HOME;delete client.LANG;
  const seen=names(run(readerLaunch({root:s.plugin,options:options(s.dir),host:client,view:'home'}),client));
  assert.deepEqual(seen,READER.filter(n=>!['HOME','LANG'].includes(n)));
 }finally{s.close();}
});
test('launch builders refuse executables the cleared launch cannot start literally',async()=>{
 const {readerLaunch,probeLaunch}=await contract(),s=scratch();try{
  for(const node of ['node','./node','/opt/a=b/node','/usr/bin/node\nX=1']){
   const o={...options(s.dir),node_executable:node};
   assert.throws(()=>readerLaunch({root:s.plugin,options:o,host:s.client,view:'home'}),undefined,JSON.stringify(node));
   assert.throws(()=>probeLaunch({root:s.plugin,options:o,host:s.client}),undefined,JSON.stringify(node));
  }
 }finally{s.close();}
});
test('the real reader still answers through the cleared launch',async()=>{
 const {readerLaunch}=await contract(),s=scratch();try{
  const data=path.join(s.dir,'workspace with spaces','.slides-state');fs.mkdirSync(data,{recursive:true});
  const write=(name,value)=>fs.writeFileSync(path.join(data,name+'.json'),JSON.stringify(value));
  write('model',{title:'Example',rev:3,slides:[{id:'s1',layout:'content',notes:'',elements:[{id:'e1',type:'title',text:'One',style:{size:30}}]}]});
  write('state',{paused:false,log:[],protections:[]});write('board',{notes:[],tasks:[{id:'t1',title:'Open',status:'open'}],loops:[]});
  for(const [view,limit] of [['help',2],['tasks',8]]){
   const result=run(readerLaunch({root:ROOT,options:options(s.dir),host:s.client,view,limit}),s.client);
   assert.equal(result.status,0,`${view}: ${String(result.stderr).split(':')[0]}`);
   const page=JSON.parse(result.stdout);assert.equal(page.schema,'ai.toolsenabled/slides-view/v1');assert.equal(page.view,view);
   if(view==='tasks'){assert.equal(page.workspace,path.join(s.dir,'workspace with spaces'));assert.equal(page.total,1);}
  }
 }finally{s.close();}
});
test('the real renderer probe still reports through the cleared launch',async()=>{
 const {probeLaunch}=await contract(),s=scratch();try{
  const result=run(probeLaunch({root:ROOT,options:options(s.dir),host:s.client}),s.client);
  const value=JSON.parse(result.stdout);assert.equal(value.rasterizer,'pypdfium2');assert.equal(typeof value.rasterizerAvailable,'boolean');
 }finally{s.close();}
});

test('Windows pane launches use isolated Python and preserve only the declared child environment',async()=>{
 const {readerLaunch}=await contract();
 const launch=readerLaunch({root:'C:\\Program Files\\Slides',options:{node_executable:'C:\\Node\\node.exe',python_executable:'C:\\Runtime\\Scripts\\python.exe',workspace_directory:'C:\\Decks\\Project'},host:{PATH:'C:\\Node',SystemRoot:'C:\\Windows',ANTHROPIC_API_KEY:'synthetic-not-a-key'},view:'home'});
 assert.equal(launch.argv[0],'C:\\Runtime\\Scripts\\python.exe');
 assert.deepEqual(launch.argv.slice(1,4),['-I','-S','-B']);
 const env=JSON.parse(launch.argv[launch.argv.indexOf('--environment')+1]);
 assert.equal(env.SystemRoot,'C:\\Windows');
 assert(!Object.hasOwn(env,'ANTHROPIC_API_KEY'));
 assert.equal(launch.init.env,undefined);
});
