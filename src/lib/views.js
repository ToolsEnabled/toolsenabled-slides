'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),http=require('node:http');
const {clean}=require('./terminal-text');
const VIEWS=['home','slide','board','tasks','history','lint','timing','status','notes','search','protections','assets','layouts','exports','studio','help'];
const SCHEMA='ai.toolsenabled/slides-view/v1';
const fail=(code,message)=>{throw Object.assign(new Error(code+': '+message),{code});};
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
function directory(file){
 const s=fs.lstatSync(file);if(!s.isDirectory()||s.isSymbolicLink())fail('VIEW_STATE','State must be a local directory');
 return `${s.dev}:${s.ino}`;
}
function readFile(file,max=32*1024*1024){
 let fd;
 try{
  const original=fs.lstatSync(file);
  if(!original.isFile()||original.isSymbolicLink())fail('VIEW_STATE','State must be a regular file');
  fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  const s=fs.fstatSync(fd);
  if(!s.isFile()||s.nlink!==1||s.size>max||s.dev!==original.dev||s.ino!==original.ino)fail('VIEW_STATE','Unsafe or oversized state file');
  const data=Buffer.alloc(s.size+1),size=fs.readSync(fd,data,0,data.length,0),after=fs.fstatSync(fd);
  if(size!==s.size||after.size!==s.size||after.mtimeMs!==s.mtimeMs||after.ctimeMs!==s.ctimeMs)fail('VIEW_CHANGED','State changed. Reload the view.');
  return data.subarray(0,size);
 }catch(e){if(e.code==='ENOENT')return null;if(e.code?.startsWith('VIEW_'))throw e;fail('VIEW_STATE','State is inaccessible or unsafe');}
 finally{if(fd!==undefined)fs.closeSync(fd);}
}
function parse(data){
 if(data===null)return null;
 let value;try{value=JSON.parse(data.toString('utf8'));}catch{fail('VIEW_STATE','Malformed saved state');}
 const todo=[[value,0]];let count=0;
 while(todo.length){const [v,depth]=todo.pop();if(++count>500000||depth>64)fail('VIEW_STATE','Saved state exceeds view limits');if(v&&typeof v==='object')for(const child of Object.values(v))todo.push([child,depth+1]);}
 return value;
}
function capture(root,view,selector){
 const dir=path.join(root,'.slides-state');let binding;
 try{binding=directory(dir);}catch(e){if(e.code==='ENOENT')return {hash:'empty',model:null,state:{},board:{},lease:null};throw e;}
 const hash=crypto.createHash('sha256'),values={};
 for(const name of ['model','state','board','server',...(['status'].includes(view)?['render-state']:[]),...(view==='exports'?['exports']:[]),...(view==='history'&&selector&&!['undo','redo'].includes(selector)?['element-history']:[])]){
  const bytes=readFile(path.join(dir,name==='server'?'server.lock':name+'.json'),name==='server'?8192:32*1024*1024);
  hash.update(name+'\0');hash.update(bytes||Buffer.from('missing'));values[name]=parse(bytes);
 }
 if(directory(dir)!==binding)fail('VIEW_CHANGED','State directory changed. Reload the view.');
 if(values.model!==null&&(!object(values.model)||!Array.isArray(values.model.slides)||values.model.slides.length>10000||!Number.isSafeInteger(values.model.rev)))fail('VIEW_STATE','Invalid saved deck');
 for(const slide of values.model?.slides||[])if(!object(slide)||typeof slide.id!=='string'||!Array.isArray(slide.elements)||slide.elements.some(e=>!object(e))||(slide.decor!==undefined&&(!Array.isArray(slide.decor)||slide.decor.some(e=>!object(e)))))fail('VIEW_STATE','Invalid saved slide');
 if(values.state!==null&&(!object(values.state)||typeof values.state.paused!=='boolean'||['log','protections'].some(k=>values.state[k]!==undefined&&(!Array.isArray(values.state[k])||values.state[k].some(v=>!object(v))))))fail('VIEW_STATE','Invalid saved status');
 if(values.board!==null&&(!object(values.board)||['notes','tasks','loops'].some(k=>values.board[k]!==undefined&&(!Array.isArray(values.board[k])||values.board[k].some(v=>!object(v))))))fail('VIEW_STATE','Invalid saved board');
 return {hash:hash.update(binding).digest('hex'),model:values.model,state:values.state||{},board:values.board||{},lease:values.server,render:values['render-state'],exports:values.exports,objectHistory:values['element-history']};
}
function assetMetadata(root){
 const start=path.join(root,'assets');let stat;try{stat=fs.lstatSync(start);}catch(e){if(e.code==='ENOENT')return [];throw e;}
 if(!stat.isDirectory()||stat.isSymbolicLink())fail('VIEW_STATE','Assets must be a local directory');
 const pending=[[start,'assets',0]],out=[];let count=0;
 while(pending.length){const [dir,relative,depth]=pending.pop();const info=fs.lstatSync(dir);if(info.isSymbolicLink()||!info.isDirectory())fail('VIEW_CHANGED','Assets changed. Reload.');
  const cursor=fs.opendirSync(dir);try{let entry;while((entry=cursor.readSync())){
   if(++count>2500)fail('VIEW_STATE','Assets exceed the 2500-entry metadata limit');if(entry.name.startsWith('.'))continue;
   const file=path.join(dir,entry.name),name=relative+'/'+entry.name,item=fs.lstatSync(file);if(item.isSymbolicLink())continue;
   if(item.isDirectory()){if(depth>=8)fail('VIEW_STATE','Assets exceed the directory-depth limit');pending.push([file,name,depth+1]);}
   else if(item.isFile())out.push({name,bytes:item.size,type:path.extname(entry.name).slice(1)||'file',mtime:item.mtimeMs});
  }}finally{cursor.closeSync();}
 }return out.sort((a,b)=>a.name.localeCompare(b.name));
}
function get(port,url,instance){
 return new Promise((resolve,reject)=>{
  const req=http.get({host:'127.0.0.1',port,path:url,agent:false,headers:instance?{'X-Slides-Instance':instance}:{}},res=>{
   let size=0,parts=[];res.on('data',b=>{size+=b.length;if(size>32*1024*1024)req.destroy(new Error('too large'));else parts.push(b);});
   res.on('error',reject);res.on('end',()=>{try{if(res.statusCode!==200)throw new Error('unavailable');resolve(JSON.parse(Buffer.concat(parts).toString('utf8')));}catch(e){reject(e);}});
  });
  const timer=setTimeout(()=>req.destroy(new Error('timeout')),1500);req.on('error',reject);req.on('close',()=>clearTimeout(timer));
 });
}
async function liveState(root,port,saved,view){
 if(!saved.lease)return {live:null,notice:'Saved state · Slides is stopped; live locks and editors are unavailable.'};
 if(!object(saved.lease)||saved.lease.entry!=='slides-server'||!Number.isSafeInteger(saved.lease.pid)||saved.lease.pid<1)fail('VIEW_STATE','Invalid runtime lease');
 let first;try{first=await get(port,'/api/health');}catch{return {live:null,notice:'Saved state · Runtime is unreachable; its recorded lease remains. Live locks and editors are unavailable.'};}
 const matches=h=>h?.ok===true&&h.service==='toolsenabled-slides'&&h.workspace===root&&h.pid===saved.lease.pid&&typeof h.instanceId==='string'&&/^[a-f0-9]{48}$/.test(h.instanceId);
 if(!matches(first))fail('VIEW_IDENTITY','The selected port belongs to another runtime');
 let value,last;try{value=await get(port,'/api/state?board=omit',first.instanceId);if(view==='history')value.history=await get(port,'/api/history',first.instanceId);if(view==='lint')value.cachedLint=await get(port,'/api/lint?cached=1',first.instanceId);last=await get(port,'/api/health',first.instanceId);}catch{fail('VIEW_CHANGED','Live runtime changed or became unavailable. Reload the view.');}
 if(!matches(last)||last.instanceId!==first.instanceId)fail('VIEW_IDENTITY','Runtime identity changed');
 if(!object(value)||JSON.stringify(value.model)!==JSON.stringify(saved.model)||!Array.isArray(value.locks)||!Array.isArray(value.editors))fail('VIEW_CHANGED','Live deck differs from saved state. Reload the view.');
 return {live:value,notice:'Live runtime verified · Views never edit the deck.'};
}
const {project:rowsFor,record,when}=require('./view-projection');
async function readView({workspace=process.env.SLIDES_WORKSPACE,view='home',selector='',offset=0,limit=8,revision,all=false,port=Number(process.env.SUITE_PORT||4599)}={}){
 if(!VIEWS.includes(view)||typeof selector!=='string'||selector.length>600||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>20||typeof all!=='boolean'||revision!==undefined&&!/^[a-f0-9]{64}$/.test(revision)||!Number.isInteger(port)||port<1024||port>65535)fail('VIEW_QUERY','Invalid view or page');
 if(view==='help'){
  const rows=require('./view-help.json').map((c,i)=>record(i,c.command,[c.description,'Codex: '+c.codex]));
  const current=crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  if(revision!==undefined&&revision!==current)fail('VIEW_CHANGED','Help changed. Reload.');
  const records=rows.slice(offset,offset+limit),end=offset+records.length;
  return {schema:SCHEMA,grantsAuthority:false,workspace:workspace||'',view,selector,all,revision:current,offset,limit,total:rows.length,nextOffset:end<rows.length?end:null,title:'Slides commands',modelRev:null,paused:null,notice:'Views read locally. Actions start model work with normal tool permissions. Codex uses the CLI or skill; it has no plugin slash commands.',records};
 }
 if(view==='tasks'&&selector&&!['loops'].includes(selector)||view==='history'&&selector&&!['undo','redo'].includes(selector)&&!/^\S+ (element|decor) \S+$/.test(selector)||view==='search'&&!selector||!['notes','slide','tasks','history','search'].includes(view)&&selector)fail('VIEW_QUERY','Invalid selector');
 try{require('./bootstrap').pluginWorkspace(workspace);}catch{fail('VIEW_WORKSPACE','Set an absolute external SLIDES_WORKSPACE');}
 let root;try{root=fs.realpathSync(workspace);directory(root);}catch{fail('VIEW_WORKSPACE','The configured workspace does not exist');}
 const identity=directory(root),saved=capture(root,view,selector);
 const assets=view==='assets'?assetMetadata(root):[];
 const runtime=['home','slide','status','studio','history','lint'].includes(view)?await liveState(root,port,saved,view):{live:null,notice:'Saved workspace state · Read-only'};
 if(capture(root,view,selector).hash!==saved.hash||view==='assets'&&JSON.stringify(assetMetadata(root))!==JSON.stringify(assets)||directory(root)!==identity)fail('VIEW_CHANGED','Saved state changed. Reload the view.');
 const settings={all,port,workspace,assets,python:process.env.SUITE_PYTHON,renderer:process.env.SLIDES_RENDERER,soffice:process.env.SLIDES_SOFFICE};
 let rows;try{rows=rowsFor(view,selector,saved,runtime.live,settings);}catch(e){if(/^VIEW_[A-Z]+:/.test(e.message))fail(e.message.split(':')[0],e.message.split(':').slice(1).join(':').trim());fail('VIEW_STATE','Saved view is malformed');}
 const current=crypto.createHash('sha256').update(JSON.stringify([root,identity,saved.hash,view,selector,all,rows])).digest('hex');
 if(revision!==undefined&&revision!==current)fail('VIEW_CHANGED','The view changed. Reload from the first page.');
 const records=rows.slice(offset,offset+limit),end=offset+records.length;
 let notice=!saved.model?'No saved presentation. Use /toolsenabled-slides:slides-new to create one.':view==='lint'&&runtime.live?.cachedLint?.cached!==true?'Model quality checks only. Exported/inherited font checks require ppt_lint; this pane is not a full lint pass.':runtime.notice;
 if(view==='home')notice+=` · ${saved.model?.slides?.length||0} slides · ${(saved.board.tasks||[]).filter(t=>t.status!=='done').length} open tasks · ${saved.state.paused?'Paused by '+String(saved.state.pausedBy||'unknown')+' · at '+when(saved.state.pausedAt):'Not paused'} · http://127.0.0.1:${port}/studio`;
 if(view==='history')notice+=' · Undo, redo and restore are human dashboard controls.';
 if(view==='history'&&['undo','redo'].includes(selector)&&!runtime.live)notice='Undo/redo history is unavailable while stopped. Use the human dashboard for changes.';
 if(view==='lint'&&runtime.live?.cachedLint?.cached)notice='Cached full lint at this revision and rendered artifact; no lint job started.';
 notice=clean(notice,800,true).text;
 return {schema:SCHEMA,grantsAuthority:false,workspace,view,selector,all,revision:current,offset,limit,total:rows.length,nextOffset:end<rows.length?end:null,title:clean(saved.model?.title||'Slides',240,true).text,modelRev:saved.model?.rev??null,paused:saved.state.paused??null,notice,records};
}
module.exports={readView,VIEWS,SCHEMA};
