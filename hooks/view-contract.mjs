// Pure display code; no capabilities, filesystem access or document instructions.
export const VIEWS=['home','slide','board','tasks','history','lint','timing','status','notes','search','protections','assets','layouts','exports','studio','help'];
export const LIMIT=8;
export function safeText(value,limit=8000){
 if(typeof value!=='string')return '';
 value=value.replace(/#launch=[a-f0-9]{64}/gi,'#launch=[redacted]').replace(/(X-Slides-Session[\s:=]+)[a-f0-9]{64}/gi,'$1[redacted]').replace(/(slides_dashboard_\d+=)[a-f0-9]{64}/gi,'$1[redacted]').replace(/(instanceId[\s"':=]+)[a-f0-9]{48}/gi,'$1[redacted]');
 let out='',count=0;
 for(const ch of value){if(count++>=limit)return out+'…';const c=ch.codePointAt(0);
  const hidden=c<32&&c!==10&&c!==9||c>=127&&c<=159||c===173||c===1564||c===6158||c>=8203&&c<=8207||c>=8232&&c<=8238||c>=8288&&c<=8303||c===65279||c>=65529&&c<=65531||c>=78896&&c<=78943||c>=113824&&c<=113827||c>=119155&&c<=119162||c===917505||c>=917536&&c<=917631||c>=55296&&c<=57343;
  out+=hidden?'�':ch;
 }return out;
}
export function absolute(value){return typeof value==='string'&&value.length>1&&value.length<4096&&!/[\x00-\x1f\x7f]/.test(value)&&!value.includes('${')&&(value.startsWith('/')||/^[A-Za-z]:[\\/]/.test(value)||value.startsWith('\\\\'));}
export function command(args){
 if(typeof args!=='string'||args.length>800)return null;
 const trimmed=args.trim();if(!trimmed)return {view:'home',selector:''};
 const split=trimmed.indexOf(' '),view=split<0?trimmed:trimmed.slice(0,split),selector=split<0?'':trimmed.slice(split+1).trim();
 if(!VIEWS.includes(view)||selector.length>600)return null;
 if(view==='slide'&&!selector||view==='search'&&!selector)return null;
 if(view==='tasks'&&selector&&selector!=='loops')return null;
 if(view==='history'&&selector&&!['undo','redo'].includes(selector)&&!/^\S+ (element|decor) \S+$/.test(selector))return null;
 if(!['slide','notes','search','tasks','history'].includes(view)&&selector)return null;
 return {view,selector};
}
export function parsePage(p,expected){
 if(!p||p.schema!=='ai.toolsenabled/slides-view/v1'||p.grantsAuthority!==false||p.workspace!==expected.workspace||p.view!==expected.view||p.selector!==expected.selector||p.all!==expected.all||p.offset!==expected.offset||p.limit!==(expected.limit||LIMIT)||typeof p.revision!=='string'||!/^[a-f0-9]{64}$/.test(p.revision)||expected.revision!==undefined&&p.revision!==expected.revision||!Number.isSafeInteger(p.total)||p.total<0||p.total>500000||p.offset>p.total||!Array.isArray(p.records)||p.records.length!==Math.min(p.limit,p.total-p.offset)||p.nextOffset!==(p.offset+p.records.length<p.total?p.offset+p.records.length:null)||typeof p.title!=='string'||typeof p.notice!=='string'||p.paused!==null&&typeof p.paused!=='boolean'||p.modelRev!==null&&(!Number.isSafeInteger(p.modelRev)||p.modelRev<0))throw Error('Invalid page');
 const keys=new Set();
 const records=p.records.map(r=>{
  if(!r||typeof r.key!=='string'||!/^[-a-zA-Z0-9]+$/.test(r.key)||keys.has(r.key)||typeof r.label!=='string'||r.label.length>1000||!Array.isArray(r.details)||r.details.length>10000||r.details.some(d=>typeof d!=='string')||r.details.join('').length>33000||typeof r.truncated!=='boolean')throw Error('Invalid row');keys.add(r.key);
  return {...r,label:safeText(r.label,240).replace(/[\n\t]/g,' '),details:r.details.map(d=>safeText(d,8001))};
 });
 return {...p,title:safeText(p.title,240).replace(/[\n\t]/g,' '),notice:safeText(p.notice,600).replace(/[\n\t]/g,' '),records};
}
export function detailLines(record,width=80){
 const out=[];
 for(const detail of record.details)for(const line of detail.replace(/\t/g,'  ').split('\n')){
  const chars=Array.from(line);if(!chars.length)out.push('');
  for(let i=0;i<chars.length;i+=width)out.push(chars.slice(i,i+width).join(''));
 }
 if(record.truncated)out.push('[Detail truncated at the view limit.]');return out;
}
// Child launches for the pane reader and the explicit renderer probe: the argument vector and the
// $.process.run init. `host` carries the client variables the hook reads; `root` is the plugin root.
// Claude Code sets a $.process.run init env over its own environment, so a child given one still
// inherits every client variable (credentials and loader hooks included). Each child therefore
// starts through `env -i`, which clears what it inherits: only the NAME=VALUE operands listed here
// reach it, and no init env is passed. `--` ends env options; the executable is refused when it
// is not a plain absolute path, since env would read one containing '=' as another assignment.
export const CLEAR_ENV='/usr/bin/env';
export function launchable(value){return absolute(value)&&value.startsWith('/')&&!value.includes('=');}
function cleared(argv,vars,cwd,timeoutMs){
 if(!launchable(argv[0]))throw new Error('Configure an absolute Node.js executable');
 const pairs=[];
 for(const [name,value] of Object.entries(vars)){
  if(value===undefined)continue;
  if(!/^[A-Z_][A-Z0-9_]*$/.test(name)||typeof value!=='string'||value.includes('\0'))throw new Error('Invalid child variable');
  pairs.push(name+'='+value);
 }
 return {argv:[CLEAR_ENV,'-i','--',...pairs,...argv],init:{cwd,timeoutMs}};
}
// PATH (renderer discovery), HOME and LANG cross only when the client has them; nothing else does.
const baseline=host=>({PATH:host.PATH||undefined,HOME:host.HOME||undefined,LANG:host.LANG||undefined});
export function readerLaunch({root,options,host={},view,selector='',offset=0,limit=LIMIT,all=false,revision}){
 return cleared([options.node_executable,'--max-old-space-size=384',`${root}/src/cli/view.js`,view,
  ...(selector?[selector]:[]),'--json','--offset',String(offset),'--limit',String(limit),...(all?['--all']:[]),...(revision===undefined?[]:['--revision',revision])],
  {...baseline(host),SLIDES_WORKSPACE:typeof options.workspace_directory==='string'?options.workspace_directory:'',SUITE_PYTHON:String(options.python_executable||''),
   SUITE_PORT:String(options.port||4599),SLIDES_RENDERER:String(options.renderer||'auto'),SLIDES_SOFFICE:String(options.libreoffice_executable||'')},root,7000);
}
export function probeLaunch({root,options,host={}}){
 return cleared([options.node_executable,`${root}/src/cli/doctor.js`],
  {...baseline(host),SLIDES_PLUGIN_MODE:'1',SLIDES_WORKSPACE:String(options.workspace_directory||''),SUITE_PYTHON:String(options.python_executable||''),
   SLIDES_RENDERER:String(options.renderer||'auto'),SLIDES_SOFFICE:String(options.libreoffice_executable||'')},root,45000);
}
