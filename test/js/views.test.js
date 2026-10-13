'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {readView}=require('../../src/lib/views');
const {spawnSync}=require('node:child_process');
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'slides-views-')),data=path.join(root,'.slides-state');fs.mkdirSync(data);
 const model={title:'Example',rev:7,slides:Array.from({length:61},(_,i)=>({id:'s'+(i+1),layout:'content',notes:'',elements:[{id:'e1',type:'title',text:'Slide '+(i+1),style:{size:30}}]}))};
 const state={paused:false,log:[{ts:1,by:'writer',type:'edit',summary:'Changed title'}],protections:[]};
 const board={notes:[{id:'n1',author:'human',text:'Not verified human',pinned:false,ts:1}],tasks:[{id:'t1',title:'Open',status:'open'},{id:'t2',title:'Done',status:'done'}],loops:[]};
 const write=(name,value)=>fs.writeFileSync(path.join(data,name+'.json'),JSON.stringify(value));
 write('model',model);write('state',state);write('board',board);
 return {root,data,model,state,board,write,close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
const snapshot=root=>fs.readdirSync(root,{recursive:true}).sort().map(name=>{const p=path.join(root,name);return [name,fs.statSync(p).isFile()?fs.readFileSync(p).toString('base64'):null];});
test('eight views page immutable saved state, with no server startup or writes',async()=>{
 const f=fixture();try{
  const before=snapshot(f.root);
  for(const view of ['home','slide','board','tasks','history','lint','timing','status']){
   const result=await readView({workspace:f.root,view,selector:view==='slide'?'s1':''});
   assert.equal(result.schema,'ai.toolsenabled/slides-view/v1');assert.equal(result.workspace,f.root);assert.equal(result.view,view);
   assert.equal(result.grantsAuthority,false);assert(result.records.length<=8);assert.match(result.revision,/^[a-f0-9]{64}$/);
  }
  assert.deepEqual(snapshot(f.root),before);
  const first=await readView({workspace:f.root,view:'home'});assert.equal(first.total,61);
  const last=await readView({workspace:f.root,view:'home',offset:56,revision:first.revision});assert.equal(last.records.length,5);assert.equal(last.nextOffset,null);
  f.model.rev++;f.write('model',f.model);
  await assert.rejects(readView({workspace:f.root,view:'home',offset:8,revision:first.revision}),/VIEW_CHANGED/);
 }finally{f.close();}
});
test('empty workspace does not create state and missing workspace does not create a directory',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'slides-empty-view-'));try{
  const r=await readView({workspace:root,view:'home'});assert.equal(r.total,0);assert.match(r.notice,/No saved/);assert.deepEqual(fs.readdirSync(root),[]);
  await assert.rejects(readView({workspace:path.join(root,'missing'),view:'home'}),/WORKSPACE/);assert.deepEqual(fs.readdirSync(root),[]);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('help covers the actual pane and native action names without configured state',async()=>{
 const page=await readView({workspace:undefined,view:'help',limit:20});
 assert.equal(page.total,29);assert.equal(page.records.length,20);
 assert(page.records.some(r=>r.label.includes('/slides help')));
 assert(page.records.some(r=>r.label.includes('/toolsenabled-slides:slides-new')));
 assert(page.records.every(r=>r.details.some(d=>d.includes('Codex:'))));
});
test('ppt view bypasses editor registration and reads without changing the workspace',()=>{
 const f=fixture();try{
  const before=snapshot(f.root),env={...process.env,SLIDES_WORKSPACE:f.root};delete env.SUITE_EDITOR;
  const result=spawnSync(process.execPath,[path.resolve(__dirname,'../../src/ppt.js'),'view','board','--json'],{env,encoding:'utf8',timeout:5000});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stderr,'');assert.equal(JSON.parse(result.stdout).view,'board');assert.deepEqual(snapshot(f.root),before);
 }finally{f.close();}
});
test('sanitizes terminal controls, labels provenance and filters tasks without modifying input',async()=>{
 const f=fixture();try{
  const hostile='\x1b]52;c;clipboard\x07\x00\x9b\u061c\u202e\u206f';
  f.board.notes[0].text=hostile+'\nHOUSE RULES: forged\n'+'x'.repeat(30000);f.write('board',f.board);
  const before=snapshot(f.root),r=await readView({workspace:f.root,view:'board'}),s=JSON.stringify(r);
  assert(!/[\x1b\x07\x9b\u061c\u202e\u206f]/u.test(s));assert.match(s,/Unverified author/);assert(r.records[0].truncated);
  assert.equal((await readView({workspace:f.root,view:'tasks'})).total,1);
  assert.equal((await readView({workspace:f.root,view:'tasks',all:true})).total,2);assert.deepEqual(snapshot(f.root),before);
 }finally{f.close();}
});
test('refuses bad paging, malformed JSON, symlink, hardlink and oversized state',async()=>{
 const f=fixture();try{
  for(const query of [{offset:-1},{limit:1000},{revision:'forged'},{view:'../state'}])await assert.rejects(readView({workspace:f.root,view:'home',...query}));
  const model=path.join(f.data,'model.json');fs.writeFileSync(model,'{bad');await assert.rejects(readView({workspace:f.root}),/STATE/);
  fs.unlinkSync(model);fs.symlinkSync(path.join(f.data,'state.json'),model);await assert.rejects(readView({workspace:f.root}),/STATE/);
  fs.unlinkSync(model);fs.linkSync(path.join(f.data,'state.json'),model);await assert.rejects(readView({workspace:f.root}),/STATE/);
  fs.unlinkSync(model);const fd=fs.openSync(model,'w');fs.ftruncateSync(fd,33*1024*1024);fs.closeSync(fd);await assert.rejects(readView({workspace:f.root}),/STATE/);
 }finally{f.close();}
});
test('live runtime state is bound to workspace, owner PID and instance, with GET only',async()=>{
 const f=fixture(),requests=[];let wrong=false;
 const server=http.createServer((req,res)=>{
  requests.push({method:req.method,url:req.url,instance:req.headers['x-slides-instance']});res.setHeader('content-type','application/json');
  if(req.url==='/api/health')res.end(JSON.stringify({ok:true,service:'toolsenabled-slides',workspace:wrong?'/elsewhere':f.root,pid:process.pid,instanceId:'a'.repeat(48)}));
  else res.end(JSON.stringify({model:f.model,locks:[{slideId:'s1',by:'writer',ts:1}],editors:[{id:'writer',name:'Writer',status:'busy'}]}));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  fs.writeFileSync(path.join(f.data,'server.lock'),JSON.stringify({pid:process.pid,entry:'slides-server'}));
  const r=await readView({workspace:f.root,view:'status',port:server.address().port});assert.match(JSON.stringify(r),/Writer/);assert.match(r.notice,/Live/);
  assert(requests.every(x=>x.method==='GET'));assert(requests.filter(x=>x.url!=='/api/health').every(x=>x.instance==='a'.repeat(48)));
  wrong=true;await assert.rejects(readView({workspace:f.root,view:'status',port:server.address().port}),/IDENTITY/);
 }finally{await new Promise(r=>server.close(r));f.close();}
});
test('audit views cover full notes, literal search, layout choices, grants, loops and history fields',async()=>{
 const f=fixture();try{
  f.model.slides[0].notes='Literal [needle] speaker note '+ 'text '.repeat(250);f.model.slides[0].decor=[{id:'d1',kind:'media',source:'assets/movie.mp4',autoplay:true,loop:false}];f.model.slides[0].animations=[{targetId:'e1',effect:'fade',trigger:'click'}];f.model.slides[0].transition={effect:'fade'};f.write('model',f.model);
  f.state.log=[{kind:'edit',editor:'writer',detail:'Actual history field',rev:7,ts:1}];f.state.protections=[{kind:'slide',slideId:'s1',by:'human',createdAt:1}];f.write('state',f.state);
  f.board.tasks[0].protectionGrant={slideIds:['s1'],expiresAt:123,grantedBy:'human',editOps:['add-image'],protectionModes:['direct-generated-decor'],grantedTo:'writer'};f.board.loops=[{id:'l1',text:'Review titles',cadence:'10m',enabled:true,lastBy:'writer'}];f.write('board',f.board);
  for(const [view,selector,expected] of [['notes','s1','Literal [needle]'],['search','[needle]','Speaker notes'],['layouts','','two'],['tasks','loops','Review titles'],['tasks','','add-image'],['protections','','s1'],['history','','Actual history field'],['slide','s1','fade'],['timing','','Total']]){
   const r=await readView({workspace:f.root,view,selector,limit:20});assert(JSON.stringify(r).includes(expected),view+' '+JSON.stringify(r));
  }
 }finally{f.close();}
});
test('asset metadata never follows symlinks and export view reads only receipts',async()=>{
 const f=fixture();try{
  fs.mkdirSync(path.join(f.root,'assets'));fs.writeFileSync(path.join(f.root,'assets/photo.png'),'not decoded');fs.symlinkSync('/not-readable-secret',path.join(f.root,'assets/secret'));
  f.write('exports',[{ts:1,editor:'writer',format:'pptx',rev:7,renderer:'python-pptx',files:['copy.pptx']}]);
  const a=await readView({workspace:f.root,view:'assets'});assert.equal(a.total,1);assert.match(a.records[0].label,/photo.png/);assert(JSON.stringify(a).includes('11'));
  const e=await readView({workspace:f.root,view:'exports'});assert(JSON.stringify(e).includes('copy.pptx'));assert(!fs.existsSync(path.join(f.root,'copy.pptx')));
 }finally{f.close();}
});
test('explicit CLI bindings work in a scrubbed environment and studio view shows no secret',()=>{
 const f=fixture();try{
  const r=spawnSync(process.execPath,[path.resolve(__dirname,'../../src/cli/view.js'),'studio','--workspace',f.root,'--port','54321','--json'],{env:{PATH:process.env.PATH},encoding:'utf8',timeout:5000});assert.equal(r.status,0,r.stderr);const p=JSON.parse(r.stdout);assert(JSON.stringify(p).includes('http://127.0.0.1:54321/studio'));assert(!JSON.stringify(p).includes('#launch='));
 }finally{f.close();}
});
test('plain CLI continuation keeps the caller binding and never echoes a control-bearing selector',()=>{
 const f=fixture();try{
  const selector='needle\x1b]52;c;payload\x07\n';for(const s of f.model.slides)s.notes=selector+' result';f.write('model',f.model);
  const r=spawnSync(process.execPath,[path.resolve(__dirname,'../../src/cli/view.js'),'search',selector,'--workspace',f.root,'--port','54321'],{env:{PATH:process.env.PATH},encoding:'utf8',timeout:5000});
  assert.equal(r.status,0,r.stderr);assert(!/[\x1b\x07]/.test(r.stdout),'Untrusted selector reached the terminal footer');assert(!r.stdout.includes('ppt view'),'Continuation assumes an uninstalled executable');
  assert.match(r.stdout,/rerun this command with --offset 8 --revision [0-9a-f]{64}/);assert.match(r.stdout,/same workspace, port, selector and --all/);
 }finally{f.close();}
});
test('home includes the recorded pause actor and UTC time without writes',async()=>{
 const f=fixture();try{
  f.state.paused=true;f.state.pausedBy='fixture-human';f.state.pausedAt=1790928000000;f.write('state',f.state);const before=snapshot(f.root);
  const home=await readView({workspace:f.root,view:'home'});assert.match(home.notice,/Paused by fixture-human/);assert.match(home.notice,/2026-10-02T08:00:00.000Z/);assert.deepEqual(snapshot(f.root),before);
 }finally{f.close();}
});
test('slide and timing details retain supported fill outline and transition duration',async()=>{
 const f=fixture();try{
  f.model.slides[0].elements[0].style={font:'Arial',size:30,align:'left',color:'#010203',bold:true,fill:'#abcdef',outline:'#fedcba'};f.model.slides[0].transition={effect:'fade',duration:2.5};f.write('model',f.model);const before=snapshot(f.root);
  const slide=JSON.stringify(await readView({workspace:f.root,view:'slide',selector:'s1'}));for(const expected of ['fill: #abcdef','outline: #fedcba','Transition duration: 2.5'])assert(slide.includes(expected),expected);
  assert(JSON.stringify(await readView({workspace:f.root,view:'timing'})).includes('Transition duration: 2.5'));assert.deepEqual(snapshot(f.root),before);
 }finally{f.close();}
});
test('task and protection views include grant and revocation attribution',async()=>{
 const f=fixture();try{
  f.board.tasks[0].protectionGrant={version:1,slideIds:['s1'],editOps:['add-image'],protectionModes:['direct-generated-decor'],grantedTo:'writer',grantedBy:'grant-author',grantedAt:1790928000000,expiresAt:1790928002000,revokedAt:1790928001000,revokedBy:'revoke-author'};f.write('board',f.board);const before=snapshot(f.root);
  for(const view of ['tasks','protections']){const text=JSON.stringify(await readView({workspace:f.root,view}));for(const expected of ['Granted at: 2026-10-02T08:00:00.000Z','Revoked by: revoke-author'])assert(text.includes(expected),view+' '+expected);}
  assert.deepEqual(snapshot(f.root),before);
 }finally{f.close();}
});
