import type {Register} from 'claude-code'
import {VIEWS,LIMIT,absolute,launchable,command,parsePage,detailLines,safeText,readerLaunch,probeLaunch} from './view-contract.mjs'
const PANE='slides-view'
let serial=0,loading=false,error='',view='home',selector='',all=false,page:any=null,detail:any=null,detailOffset=0,diagnostic='',probing=false,hint='',detailTotal=0
function reset(){serial++;loading=false;error='';page=null;detail=null;detailOffset=0;diagnostic='';probing=false;hint='';detailTotal=0}
function redraw($:any){$.ui.invalidate('ui.render')}
// Every key the pane advertises in any state. A key no Button holds is not consumed by the pane: it falls
// into the prompt composer, which then keeps the keyboard (so a following q is typed, not obeyed). Each of
// these is therefore held in every state, acting where it applies and otherwise showing a short hint.
// q (and Esc, through closeOnEscape) always close.
const KEYS=['q','p','n','b','r','h','k','a','l','u','d','v','1','2','3','4','5','6','7','8','9','0']
const VIEW_KEYS:any={tasks:['a','l'],history:['u','d','a'],status:['v']}
const rows=()=>!loading&&page&&!detail&&view!=='help'?page.records.length:0
// Why a key does nothing in the current state; '' when it acts.
function idle(key:string):string{
 if(key==='q')return ''
 if(loading)return 'Loading… press q to close.'
 if(/^[0-9]$/.test(key)){
  if(detail)return 'Press b to return to the list first.'
  if(view==='help')return 'Help has no numbered rows.'
  return (key==='0'?10:Number(key))<=rows()?'':rows()?`No row ${key} on this page.`:'No rows to open.'
 }
 if(key==='p')return detail?(detailOffset>0?'':'Already at the top of this detail.'):page&&page.offset>0?'':page?'Already on the first page.':'No page to go back to.'
 if(key==='n')return detail?(detailOffset+8<detailTotal?'':'End of this detail.'):page&&page.nextOffset!==null?'':page?'Already on the last page.':'No more pages.'
 if(key==='b')return detail?'':'b returns from a detail view.'
 if(['r','h','k'].includes(key))return ''
 if(!(VIEW_KEYS[view]||[]).includes(key))return `${key} does nothing in this view.`
 if(detail)return 'Press b to return to the list first.'
 return key==='v'&&probing?'Renderer probe already running.':''
}
// The footer names only the keys that act now.
function footer(){
 if(loading)return 'Loading · Esc/q close'
 const live=(k:string)=>!idle(k),n=rows(),parts=['Read-only','Esc/q close']
 if(n)parts.push(n===1?'1 open':`1–${n} open`)
 for(const [k,label] of [['b','back'],['p','previous'],['n','next']])if(live(k))parts.push(`${k} ${label}`)
 const labels:any={a:view==='tasks'?(all?'open tasks':'all tasks'):'activity',l:selector==='loops'?'tasks':'loops',u:'undo history',d:'redo history',v:'probe renderer'}
 for(const k of VIEW_KEYS[view]||[])if(live(k))parts.push(`${k} ${labels[k]}`)
 return [...parts,'r reload','h home','k help'].join(' · ')
}
// Every press, by hotkey, click or Enter, passes here: an idle key only shows why; a live one acts.
function pressKey($:any,k:string,action:()=>any){hint=idle(k);if(hint){redraw($);return}return action()}
// The only client variables a pane child may see; the launch builders clear everything else.
async function host($:any){return {PATH:await $.env.get('PATH'),HOME:await $.env.get('HOME'),LANG:await $.env.get('LANG')}}
async function load($:any,options:any,offset=0,revision?:string){
 const mine=++serial,selected=view,selectedId=selector,filter=all,pageLimit=view==='help'?2:LIMIT
 loading=true;error='';page=null;detail=null;detailOffset=0;diagnostic='';probing=false;hint='';redraw($)
 try{
  if(!launchable(options.node_executable)||selected!=='help'&&!absolute(options.workspace_directory)){
   error='Configure Node.js and an absolute workspace in /plugin configure toolsenabled-slides.';return
  }
  const workspace=typeof options.workspace_directory==='string'?options.workspace_directory:''
  const launch=readerLaunch({root:$.plugin.root,options,host:await host($),view:selected,selector:selectedId,offset,limit:pageLimit,all:filter,revision})
  const result=await $.process.run(launch.argv,launch.init)
  if(mine!==serial)return
  if(result.exitCode!==0||result.isStdoutTruncated||result.isStderrTruncated){
   const code=String(result.stderr).split(':')[0]
   error=code==='VIEW_CHANGED'?'The presentation changed. Reload from the first page.':code==='VIEW_WORKSPACE'?'Configure an existing external workspace in /plugin configure toolsenabled-slides.':code==='VIEW_IDENTITY'?'Another runtime owns the configured port. Check plugin configuration.':code==='VIEW_SLIDE'?'Select an existing slide number or ID.':'Slides view unavailable. Check configuration and access, then Reload.';return
  }
  if(typeof result.stdout!=='string'||result.stdout.length>300000)throw Error('Page too large')
  page=parsePage(JSON.parse(result.stdout),{workspace,view:selected,selector:selectedId,all:filter,offset,revision,limit:pageLimit})
 }catch{if(mine===serial)error='Slides view unavailable. Check configuration and access, then Reload.'}
 finally{if(mine===serial){loading=false;redraw($)}}
}
export const register:Register=(on,options)=>{
 on('session.start',async($,e,next)=>{reset();await $.command.register({name:'slides',description:'View the presentation, board, tasks, history and help locally',argumentHint:'[home|slide|notes|search|board|tasks|history|lint|timing|status|protections|assets|layouts|exports|studio|help]',immediate:true});return next(e)})
 on('session.end',async($,e,next)=>{reset();return next(e)})
 on('ui.close',{id:PANE},async($,e,next)=>{reset();return next(e)})
 on('command.run',{command:'slides'},async($,e)=>{
  const selection=command(e.args);if(!selection)return {text:'Use /slides help for views and native action commands.'}
  reset();view=selection.view;selector=selection.selector;all=false
  await $.ui.open({id:PANE,title:'Slides',focus:true,closeOnEscape:true,rows:24,columns:100})
  await load($,options||{});return {} // Never put workspace content into the transcript or model context.
 })
 on('ui.render',{component:'Pane',requestId:PANE},async($,e)=>{
  const {Box,Text,Button}=$.ui.resolve(e),current=page,selected=detail
  const width=Math.max(20,Math.min(80,Number(e.props?.bodyColumns)||80)-4),lines=selected?detailLines(selected,width):[]
  detailTotal=lines.length
  const live=(k:string)=>!idle(k),drawn=new Set(['p','n','r','h','k','q'])
  const probe=async()=>{
   if(!launchable(options.node_executable)){diagnostic='Configure Node.js in /plugin configure toolsenabled-slides.';redraw($);return}
   const mine=serial;probing=true;diagnostic='Checking configured renderer…';redraw($)
   try{
    const launch=probeLaunch({root:$.plugin.root,options,host:await host($)}),r=await $.process.run(launch.argv,launch.init)
    if(mine!==serial)return;if(r.isStdoutTruncated||r.isStderrTruncated||r.stdout.length>32000)throw Error('Invalid diagnostics');const value=JSON.parse(r.stdout)
    diagnostic=['renderer','version','png','rasterizerAvailable','rasterizerVersion','pythonError','rendererError'].filter(k=>value[k]!==undefined).map(k=>k+': '+safeText(String(value[k]),300)).join(' · ')||'Renderer status unavailable.'
   }catch{if(mine===serial)diagnostic='Renderer probe unavailable. Check the prepared runtime and configuration.'}finally{if(mine===serial){probing=false;redraw($)}}
  }
  const viewButtons:any={
   tasks:[['filter','a',all?'Show open':'Show all',async()=>{all=!all;await load($,options)}],['loops','l',selector==='loops'?'Tasks':'Loops',async()=>{selector=selector==='loops'?'':'loops';all=false;await load($,options)}]],
   history:[['undo','u','Undo history',async()=>{selector='undo';await load($,options)}],['redo','d','Redo history',async()=>{selector='redo';await load($,options)}],['activity','a','Activity',async()=>{selector='';await load($,options)}]],
   status:[['probe','v','Probe renderer',probe]]}[view]||[]
  const listed=current&&!selected&&view!=='help'?current.records:[]
  if(selected)drawn.add('b');for(const [,k] of viewButtons)drawn.add(k);listed.forEach((_:any,i:number)=>drawn.add(String(i+1)))
  return <Box flexDirection="column">
   <Text bold>Slides · {view}{current?` · ${safeText(current.title,40)} · revision ${current.modelRev??'none'}${current.paused?' · PAUSED':''}`:''}</Text>
   {loading?<Text>Loading local view…</Text>:error?<Text>{error}</Text>:null}
   {current&&!selected?<Text dimColor>{current.notice}</Text>:null}
   {current?<Text dimColor>Snapshot {current.revision.slice(0,12)}</Text>:null}
   {diagnostic?<Text>{diagnostic}</Text>:null}
   {selected?<Box flexDirection="column"><Text bold>Detail · {selected.label}</Text>{lines.slice(detailOffset,detailOffset+8).map((line:any,i:number)=><Text key={`line-${i}`}>{line||' '}</Text>)}<Text dimColor>Detail {lines.length?detailOffset+1:0}–{Math.min(lines.length,detailOffset+8)} of {lines.length} lines</Text></Box>:null}
   {listed.map((r:any,i:number)=><Button key={`row-${r.key}`} hotkey={String(i+1)} onPress={()=>pressKey($,String(i+1),()=>{if(page===current){detail=r;detailOffset=0;redraw($)}})}>{safeText(r.label,width-5)}</Button>)}
   {current&&!selected&&view==='help'?current.records.map((r:any)=><Box key={`help-${r.key}`} flexDirection="column"><Text bold>{r.label}</Text>{detailLines(r,width).map((line:any,i:number)=><Text key={`help-${r.key}-${i}`}>{line||' '}</Text>)}</Box>):null}
   {current&&!selected?<Text dimColor>{current.records.length?current.offset+1:0}–{current.offset+current.records.length} of {current.total}{current.total===0?' · No entries.':''}</Text>:null}
   <Box flexWrap="wrap">
    {selected?<Button key="detail-prev" hotkey="p" dimColor={!live('p')} onPress={()=>pressKey($,'p',()=>{detailOffset=Math.max(0,detailOffset-8);redraw($)})}>Previous detail</Button>
     :<Button key="prev" hotkey="p" dimColor={!live('p')} onPress={()=>pressKey($,'p',async()=>{if(page===current)await load($,options,Math.max(0,current.offset-current.limit),current.revision)})}>Previous</Button>}
    {selected?<Button key="detail-next" hotkey="n" dimColor={!live('n')} onPress={()=>pressKey($,'n',()=>{detailOffset+=8;redraw($)})}>Next detail</Button>
     :<Button key="next" hotkey="n" dimColor={!live('n')} onPress={()=>pressKey($,'n',async()=>{if(page===current)await load($,options,current.nextOffset,current.revision)})}>Next</Button>}
    {selected?<Button key="back" hotkey="b" onPress={()=>pressKey($,'b',()=>{detail=null;detailOffset=0;redraw($)})}>Back</Button>:null}
    {viewButtons.map(([id,k,label,action]:any)=><Button key={id} hotkey={k} dimColor={!live(k)} onPress={()=>pressKey($,k,action)}>{label}</Button>)}
    <Button key="reload" hotkey="r" dimColor={!live('r')} onPress={()=>pressKey($,'r',()=>load($,options))}>Reload</Button>
    <Button key="home" hotkey="h" dimColor={!live('h')} onPress={()=>pressKey($,'h',async()=>{view='home';selector='';all=false;await load($,options)})}>Home</Button>
    <Button key="help" hotkey="k" dimColor={!live('k')} onPress={()=>pressKey($,'k',async()=>{view='help';selector='';all=false;await load($,options)})}>Help</Button>
    <Button key="close" hotkey="q" onPress={()=>pressKey($,'q',async()=>{reset();await $.ui.close({id:PANE})})}>Close</Button>
   </Box>
   {hint?<Box key="hint"><Text>{hint}</Text></Box>:null}
   <Text dimColor>{footer()}</Text>
   {/* Holds each remaining advertised key so it never reaches the composer. Not painted; Claude Code 2.1.287
       binds hotkeys (and Tab stops) from the whole drawn description, display included. */}
   <Box display="none">{KEYS.filter(k=>!drawn.has(k)).map(k=><Button key={`key-${k}`} hotkey={k} onPress={()=>pressKey($,k,()=>redraw($))}>{`Key ${k}`}</Button>)}</Box>
  </Box>
 })
}
