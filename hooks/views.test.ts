import {test,expect,mock} from 'claude-code/testing'
const PANE='slides-view',plugin='toolsenabled-slides',presentation={isFullscreen:false,columns:110}
const workspace='/tmp/slides $(literal) space'
const opts={options:{workspace_directory:workspace,node_executable:'/usr/bin/node',python_executable:'/tmp/runtime/bin/python',port:4599,renderer:'auto',libreoffice_executable:''}}
const revision='a'.repeat(64)
// Synthetic client credentials and host-only settings that must never reach a pane child.
const INHERITED={ANTHROPIC_API_KEY:'synthetic-anthropic-canary',CLAUDE_CODE_MESSAGING_TOKEN:'synthetic-messaging-canary',NODE_OPTIONS:'--require=/synthetic-loader-canary.js',SystemRoot:'C:\\Windows',SSL_CERT_FILE:'/test/ca.pem',SLIDES_WORKSPACE:'/wrong-inherited'}
function page(offset=0,view='home',selector='',all=false,total=61){const limit=view==='help'?2:8;return {schema:'ai.toolsenabled/slides-view/v1',grantsAuthority:false,workspace,view,selector,all,revision,offset,limit,total,nextOffset:offset+limit<total?offset+limit:null,title:'Example deck',modelRev:9,paused:false,notice:'Saved state',records:Array.from({length:Math.max(0,Math.min(limit,total-offset))},(_,i)=>({key:String(offset+i),label:'Slide '+(offset+i+1),details:['Detail '+(offset+i+1),'x'.repeat(1600)],truncated:false}))}}
const ok=(p:any)=>({exitCode:0,stdout:JSON.stringify(p),stderr:'',isStdoutTruncated:false,isStderrTruncated:false})
function reply(e:any){return ok(page(Number(e.argv[e.argv.indexOf('--offset')+1]),e.argv[3],e.argv[4]&&!e.argv[4].startsWith('--')?e.argv[4]:'',e.argv.includes('--all')))}
// Splits an `/usr/bin/env -i -- NAME=VALUE... child...` launch into its variables and the child argv.
function child(argv:string[]){
 if(argv[0]!=='/usr/bin/env')return {argv,vars:null}
 let i=argv.indexOf('--')+1;const vars:any={};for(;i>0&&i<argv.length&&/^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[i]);i++){const at=argv[i].indexOf('=');vars[argv[i].slice(0,at)]=argv[i].slice(at+1)}
 return {argv:argv.slice(i),vars}
}
function world(on:any,respond:(e:any)=>any=reply){
 const clock=mock.clock(on),calls:any[]=[],opened:any[]=[],closed:any[]=[],registered:any[]=[],forwarded:string[]=[]
 mock.env(on,{PATH:'/usr/bin',HOME:'/home/slides-test',LANG:'C.UTF-8',...INHERITED})
 on('process.run',async(_:any,e:any)=>{const split=child(e.argv),call={...e,launched:e.argv,argv:split.argv,vars:split.vars};calls.push(call);return {value:await respond(call)}})
 on('command.register',(_:any,e:any)=>{registered.push(e);return {value:{command:e.name}}})
 on('ui.open',(_:any,e:any)=>{opened.push(e);return {value:{isPlaced:true}}})
 on('ui.close',(_:any,e:any)=>{closed.push(e);return {value:undefined}})
 on('session.start',(_:any,e:any)=>({cwd:e.cwd}))
 for(const name of ['mcp.call','tool.call','prompt.submit','prompt.fill','session.append'])on(name,()=>{throw Error('View called '+name)})
 return {clock,calls,opened,closed,registered,forwarded}
}
const mount=($:any)=>$.ui.mount({plugin,surface:'terminal',component:'Pane',requestId:PANE,props:{title:'Slides',bodyColumns:100},viewport:{columns:110,rows:28}})
async function open($:any,args=''){const result=await $.command.run({command:'slides',args,origin:{kind:'composer'},presentation});expect(result.context).toBe(undefined);expect(result.text).toBe(undefined);return mount($)}
const press=($:any,key:string)=>$.ui.press({plugin,key,requestId:PANE,surface:'terminal'})
// A keystroke while the pane holds the keyboard, as Claude Code 2.1.287 dispatches it: every Button in the
// drawn description keyed by its hotkey (display ignored), the later one winning. A key no Button holds is
// not consumed: it lands in the prompt composer, which then holds the keyboard, so later keys (q too) follow it.
async function hotkey($:any,ui:any,w:any,key:string){
 const held=w.composer?[]:(await ui.findAll({type:'Button'})).filter((b:any)=>b.props?.hotkey===key)
 if(!held.length){w.forwarded.push(key);w.composer=true;return}
 await press($,String(held[held.length-1].props.key??held[held.length-1].key))
}
const ADVERTISED=['q','p','n','b','r','h','k','a','l','u','d','v','1','2','3','4','5','6','7','8','9','0']
const hint=async(ui:any)=>(await ui.find({key:'hint'}))?.text||''
const footer=async(ui:any)=>(await ui.find({type:'Text',text:/Esc\/q/}))?.text||''
test('startup only registers the namespaced command',opts,async($,on)=>{const w=world(on);await $.session.start({cwd:'/tmp/project'});await w.clock.advance(65000);expect(w.registered.map(c=>c.name)).toEqual(['slides']);expect(w.registered[0].immediate).toBe(true);expect(w.calls.length).toBe(0)})
test('pane reads only through configured own runtime, without prompts, polling or transcript context',opts,async($,on)=>{
 const w=world(on),ui=await open($);expect(JSON.stringify(await ui.drawn())).toContain('Slide 1');const c=w.calls[0]
 expect(c.argv.slice(0,2)).toEqual(['/usr/bin/node','--max-old-space-size=384']);expect(c.argv[2]).toMatch(/\/src\/cli\/view\.js$/);expect(c.argv.slice(3,4)).toEqual(['home'])
 expect((c.vars||c.init.env).SLIDES_WORKSPACE).toBe(workspace);expect(c.init.timeoutMs).toBe(7000)
 expect(w.opened[0].focus).toBe(true);expect(w.opened[0].closeOnEscape).toBe(true);await w.clock.advance(65000);expect(w.calls.length).toBe(1);await press($,'close');expect(w.closed.length).toBe(1)
})
test('pane reader starts through a cleared environment with only its allowlisted variables',opts,async($,on)=>{
 const w=world(on),ui=await open($);await ui.drawn();const c=w.calls[0]
 expect(c.launched.slice(0,3)).toEqual(['/usr/bin/env','-i','--']);expect(c.init.env).toBe(undefined)
 expect(Object.keys(c.vars||{}).sort()).toEqual(['HOME','LANG','PATH','SLIDES_RENDERER','SLIDES_SOFFICE','SLIDES_WORKSPACE','SUITE_PORT','SUITE_PYTHON'])
 expect(c.vars).toEqual({PATH:'/usr/bin',HOME:'/home/slides-test',LANG:'C.UTF-8',SLIDES_WORKSPACE:workspace,SUITE_PYTHON:'/tmp/runtime/bin/python',SUITE_PORT:'4599',SLIDES_RENDERER:'auto',SLIDES_SOFFICE:''})
 const text=JSON.stringify(c);for(const [name,value] of Object.entries(INHERITED))if(name!=='SLIDES_WORKSPACE'){expect(text.includes(name)).toBe(false);expect(text.includes(JSON.stringify(value).slice(1,-1))).toBe(false)}
 expect(text.includes('/wrong-inherited')).toBe(false)
})
test('pages past fifty, pins every page and shows bounded local detail',opts,async($,on)=>{
 const w=world(on),ui=await open($);for(let n=0;n<7;n++){await ui.drawn();await press($,'next')}
 expect(JSON.stringify(await ui.drawn())).toContain('Slide 61');expect(w.calls.length).toBe(8);for(const c of w.calls.slice(1))expect(c.argv.slice(-2)).toEqual(['--revision',revision])
 await press($,'row-60');expect(JSON.stringify(await ui.drawn())).toContain('Detail 61');await press($,'detail-next');expect(w.calls.length).toBe(8);await press($,'back');await ui.drawn();await press($,'prev');expect(w.calls[8].argv.slice(-2)).toEqual(['--revision',revision])
})
test('changed revision clears old rows and requires explicit reload',opts,async($,on)=>{
 let changed=false;const w=world(on,e=>changed?{...ok({}),exitCode:1,stderr:'VIEW_CHANGED'}:reply(e)),ui=await open($);await ui.drawn();changed=true;await press($,'next')
 const drawn=JSON.stringify(await ui.drawn());expect(drawn).toContain('changed');expect(drawn.includes('Slide 1')).toBe(false);await w.clock.advance(65000);expect(w.calls.length).toBe(2)
 changed=false;await press($,'reload');expect(w.calls[2].argv.includes('--revision')).toBe(false)
})
test('task filter resets revision and slide selector is passed literally',opts,async($,on)=>{
 const w=world(on),ui=await open($,'tasks');await ui.drawn();await press($,'filter');expect(w.calls[1].argv.includes('--all')).toBe(true);expect(w.calls[1].argv.includes('--revision')).toBe(false)
 await $.command.run({command:'slides',args:'slide s1',origin:{kind:'composer'},presentation});expect(w.calls[2].argv.slice(3,5)).toEqual(['slide','s1'])
})
test('malformed, wrong-binding, oversized and truncated output never appears',opts,async($,on)=>{
 let mode=0;const w=world(on,()=>mode===0?ok({...page(),workspace:'/wrong'}):mode===1?ok({...page(),offset:8}):mode===2?{...ok(page()),isStdoutTruncated:true}:{...ok(page()),stdout:'x'.repeat(300001)}),ui=await open($)
 for(mode=0;mode<4;mode++){if(mode)await press($,'reload');const d=JSON.stringify(await ui.drawn());expect(d).toContain('unavailable');expect(d.includes('Slide 1')).toBe(false)}
})
test('terminal controls are sanitized twice, including labels and details',opts,async($,on)=>{
 world(on,()=>ok({...page(),title:'Deck\u001b\u202e',records:page().records.map(r=>({...r,label:r.label+'\u001b\u2067',details:['Detail\u009b\u061c\u202e']}))}));const ui=await open($);let d=JSON.stringify(await ui.drawn());expect(d.includes('\\u001b')).toBe(false);expect(d.includes('\u202e')).toBe(false);await press($,'row-0');d=JSON.stringify(await ui.drawn());expect(d.includes('\u061c')).toBe(false)
})
test('wrong arguments never read state or hand a prompt to the model',opts,async($,on)=>{
 const w=world(on);for(const args of ['new example','home extra','export pdf','slide','tasks --all','home; echo x']){const r=await $.command.run({command:'slides',args,origin:{kind:'composer'},presentation});expect(r.text).toContain('/slides help');expect(r.context).toBe(undefined)}expect(w.calls.length).toBe(0)
})
test('missing executable refuses without falling back to PATH', {options:{...opts.options,node_executable:'node'}},async($,on)=>{const w=world(on),ui=await open($);expect(JSON.stringify(await ui.drawn())).toContain('Configure');expect(w.calls.length).toBe(0)})
test('an executable path the cleared launch would misread as a variable is refused', {options:{...opts.options,node_executable:'/opt/node=22/bin/node'}},async($,on)=>{const w=world(on),ui=await open($);expect(JSON.stringify(await ui.drawn())).toContain('Configure');expect(w.calls.length).toBe(0)})
test('help uses the read-only runtime contract and remains paged',opts,async($,on)=>{const w=world(on),ui=await open($,'help');await ui.drawn();expect(w.calls[0].argv[3]).toBe('help');await press($,'next');expect(w.calls.length).toBe(2)})
test('closing an in-flight pane drops late data and reopening reloads',opts,async($,on)=>{
 let finish:any;const pending=new Promise(r=>{finish=r}),w=world(on,()=>pending),opening=$.command.run({command:'slides',args:'',origin:{kind:'composer'},presentation})
 for(let n=0;n<40&&w.calls.length===0;n++)await Promise.resolve();const ui=await mount($);await ui.drawn();await press($,'close');finish(ok(page()));await opening;expect(w.closed.length).toBe(1);expect(JSON.stringify(await ui.drawn()).includes('Slide 1')).toBe(false)
})
test('audit navigation registers all view arguments and row hotkeys',opts,async($,on)=>{
 const w=world(on),ui=await open($);await ui.drawn();await press($,'row-0');expect(JSON.stringify(await ui.drawn())).toContain('Detail 1');await press($,'back');await ui.drawn();await press($,'help');expect(w.calls[1].argv[3]).toBe('help');await ui.drawn();await press($,'home');expect(w.calls[2].argv[3]).toBe('home')
 for(const args of ['notes s1','search words with spaces','protections','assets','layouts','exports','studio','tasks loops','history undo','history s1 element e1']){const r=await $.command.run({command:'slides',args,origin:{kind:'composer'},presentation});expect(r.text).toBe(undefined)}
})
test('status probe runs only on a button and displays filtered diagnostics',opts,async($,on)=>{
 const w=world(on,e=>e.argv.some((x:any)=>String(x).endsWith('/src/cli/doctor.js'))?ok({renderer:'libreoffice',version:'24.2',install:{linux:'NEVER_SHOW'},python:'PRIVATE_PATH',rasterizerAvailable:true,png:true}):reply(e)),ui=await open($,'status');await ui.drawn();expect(w.calls.length).toBe(1);await press($,'probe');const d=JSON.stringify(await ui.drawn());expect(d).toContain('libreoffice');expect(d.includes('NEVER_SHOW')).toBe(false);expect(d.includes('PRIVATE_PATH')).toBe(false);expect((w.calls[1].vars||w.calls[1].init.env).SLIDES_PLUGIN_MODE).toBe('1')
})
test('renderer probe starts through a cleared environment with only its allowlisted variables',opts,async($,on)=>{
 const w=world(on,e=>e.argv.some((x:any)=>String(x).endsWith('/src/cli/doctor.js'))?ok({renderer:'libreoffice'}):reply(e)),ui=await open($,'status');await ui.drawn();await press($,'probe');await ui.drawn();const c=w.calls[1]
 expect(c.argv[1]).toMatch(/\/src\/cli\/doctor\.js$/);expect(c.launched.slice(0,3)).toEqual(['/usr/bin/env','-i','--']);expect(c.init.env).toBe(undefined)
 expect(c.vars).toEqual({PATH:'/usr/bin',HOME:'/home/slides-test',LANG:'C.UTF-8',SLIDES_PLUGIN_MODE:'1',SLIDES_WORKSPACE:workspace,SUITE_PYTHON:'/tmp/runtime/bin/python',SLIDES_RENDERER:'auto',SLIDES_SOFFICE:''})
 const text=JSON.stringify(c);for(const name of ['ANTHROPIC_API_KEY','CLAUDE_CODE_MESSAGING_TOKEN','NODE_OPTIONS','SystemRoot','SSL_CERT_FILE','canary','/wrong-inherited'])expect(text.includes(name)).toBe(false)
})
test('help paints command descriptions and Codex equivalents without opening details',opts,async($,on)=>{
 world(on,e=>ok({...page(0,'help'),records:page(0,'help').records.map(r=>({...r,label:'/slides notes',details:['Speaker notes in slide order','Codex: !node <plugin>/src/cli/view.js notes']}))}));const ui=await open($,'help'),text=JSON.stringify(await ui.drawn());expect(text).toContain('Speaker notes in slide order');expect(text).toContain('Codex: !node')
})
test('reload clears a pending renderer probe and ignores its late diagnostic',opts,async($,on)=>{
 let finish:any;const pending=new Promise(r=>{finish=r}),w=world(on,e=>e.argv.some((x:any)=>String(x).endsWith('/src/cli/doctor.js'))?pending:reply(e)),ui=await open($,'status');await ui.drawn()
 const probe=press($,'probe');for(let n=0;n<40&&w.calls.length<2;n++)await Promise.resolve();await ui.drawn();await press($,'reload')
 let d=JSON.stringify(await ui.drawn());expect(d.includes('Checking configured renderer')).toBe(false)
 finish(ok({renderer:'STALE_RENDERER'}));await probe;d=JSON.stringify(await ui.drawn());expect(d.includes('STALE_RENDERER')).toBe(false)
 const retried=press($,'probe');await retried;expect(w.calls.length).toBe(4)
})
// Every pane state. `keys` are pressed one per fresh pane, each followed by q; `acts` are the keys that do
// something there (the rest are a no-op with a short hint) and `reads` the ones that start a reader child.
const STATES:any={
 'first page':{args:'',reach:async($:any,ui:any)=>ui,keys:['p','n','r','9','0'],acts:['n','r'],reads:['n','r'],
  footer:'Read-only · Esc/q close · 1–8 open · n next · r reload · h home · k help'},
 'last page':{args:'',reach:async($:any,ui:any)=>{for(let n=0;n<7;n++){await ui.drawn();await press($,'next')}return ui},keys:['p','n','r','6','9'],acts:['p','r'],reads:['p','r'],
  footer:'Read-only · Esc/q close · 1–5 open · p previous · r reload · h home · k help'},
 'help':{args:'help',reach:async($:any,ui:any)=>ui,keys:['p','n','r','1','9'],acts:['n','r'],reads:['n','r'],
  footer:'Read-only · Esc/q close · n next · r reload · h home · k help'},
 'detail':{args:'',reach:async($:any,ui:any)=>{await ui.drawn();await press($,'row-0');return ui},keys:['p','n','r','1','9'],acts:['n','r'],reads:['r'],
  footer:'Read-only · Esc/q close · b back · n next · r reload · h home · k help'},
 'empty':{args:'',respond:(e:any)=>ok(page(0,e.argv[3],'',false,0)),reach:async($:any,ui:any)=>ui,keys:['p','n','r','1','9'],acts:['r'],reads:['r'],
  footer:'Read-only · Esc/q close · r reload · h home · k help'},
 'error':{args:'',respond:()=>({...ok({}),exitCode:1,stderr:'VIEW_STATE: unavailable'}),reach:async($:any,ui:any)=>ui,keys:['p','n','r','1','9'],acts:['r'],reads:['r'],
  footer:'Read-only · Esc/q close · r reload · h home · k help'},
 'tasks':{args:'tasks',reach:async($:any,ui:any)=>ui,keys:['p','n','r','9','a','l','u','v'],acts:['n','r','a','l'],reads:['n','r','a','l'],
  footer:'Read-only · Esc/q close · 1–8 open · n next · a all tasks · l loops · r reload · h home · k help'},
}
const expected=(state:any)=>state.keys.map((key:string)=>({key,forwarded:[],closed:true,hint:!state.acts.includes(key),read:state.reads.includes(key)}))
for(const [name,state] of Object.entries(STATES) as any){
 test(`${name}: p, n, r and out-of-range digits are held, then q closes and nothing reaches the composer`,opts,async($,on)=>{
  const w:any=world(on,state.respond||reply),outcomes:any[]=[]
  for(const key of state.keys){
   const ui=await state.reach($,await open($,state.args));await ui.drawn();w.composer=false
   const calls=w.calls.length,closed=w.closed.length,forwarded=w.forwarded.length
   await hotkey($,ui,w,key);await ui.drawn();const shown=await hint(ui),read=w.calls.length>calls
   await hotkey($,ui,w,'q')
   outcomes.push({key,forwarded:w.forwarded.slice(forwarded),closed:w.closed.length===closed+1,hint:shown.length>0,read});await ui.unmount()
  }
  expect(outcomes).toEqual(expected(state))
 })
 test(`${name}: every advertised key is held and the footer lists only live keys`,opts,async($,on)=>{
  world(on,state.respond||reply);const ui=await state.reach($,await open($,state.args));await ui.drawn()
  const held=new Set((await ui.findAll({type:'Button'})).map((b:any)=>b.props?.hotkey).filter(Boolean))
  expect(ADVERTISED.filter(k=>!held.has(k))).toEqual([]);expect(await footer(ui)).toBe(state.footer)
 })
}
test('loading: every advertised key is held as a no-op with a hint, q closes and nothing reaches the composer',opts,async($,on)=>{
 let finish:any=null;const w:any=world(on,()=>new Promise(r=>{finish=r})),keys=['p','n','r','h','k','b','1','9'],outcomes:any[]=[]
 for(const key of keys){
  const opening=$.command.run({command:'slides',args:'',origin:{kind:'composer'},presentation});for(let n=0;n<40&&!finish;n++)await Promise.resolve()
  const ui=await mount($);await ui.drawn();w.composer=false
  const held=new Set((await ui.findAll({type:'Button'})).map((b:any)=>b.props?.hotkey).filter(Boolean))
  const missing=ADVERTISED.filter(k=>!held.has(k)),shownFooter=await footer(ui)
  const calls=w.calls.length,closed=w.closed.length,forwarded=w.forwarded.length
  await hotkey($,ui,w,key);await ui.drawn();const shown=await hint(ui),read=w.calls.length>calls
  await hotkey($,ui,w,'q')
  outcomes.push({key,missing,footer:shownFooter,forwarded:w.forwarded.slice(forwarded),closed:w.closed.length===closed+1,hint:shown.length>0,read})
  if(w.closed.length===closed)await press($,'close') // the person closes it by hand before the late reply
  finish(ok(page()));finish=null;await opening;expect(JSON.stringify(await ui.drawn()).includes('Slide 1')).toBe(false);await ui.unmount()
 }
 expect(outcomes).toEqual(keys.map(key=>({key,missing:[],footer:'Loading · Esc/q close',forwarded:[],closed:true,hint:true,read:false})))
})
