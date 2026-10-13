#!/usr/bin/env node
'use strict';
const {readView}=require('../lib/views'),{clean}=require('../lib/terminal-text');
function query(args){
 const value={view:args.shift()||'home'},numbers=new Set(['offset','limit','port']);let json=false;
 if(['slide','notes','search','history','tasks'].includes(value.view)){const parts=[];while(args[0]&&!args[0].startsWith('--'))parts.push(args.shift());value.selector=parts.join(' ');}
 while(args.length){const flag=args.shift();if(flag==='--json')json=true;else if(flag==='--all')value.all=true;else if(['--offset','--limit','--revision','--workspace','--port'].includes(flag)&&args.length){const v=args.shift();if(numbers.has(flag.slice(2))&&!/^\d+$/.test(v))throw new Error('VIEW_QUERY: Page must be an integer');value[flag.slice(2)]=numbers.has(flag.slice(2))?Number(v):v;}else throw new Error('VIEW_QUERY: Unknown view argument');}
 return {value,json};
}
function jsonPage(page){
 for(const key of ['selector','workspace']){
  const value=page[key],controlsOnly=value.replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu,c=>c==='\n'||c==='\t'?c:'\ufffd');
  if(clean(value,value.length).text!==controlsOnly)throw Object.assign(new Error('VIEW_QUERY: Selector or workspace contains session secrets; JSON view unavailable'),{code:'VIEW_QUERY'});
 }
 // Preserve the exact pane binding while preventing terminal control bytes.
 return JSON.stringify(page).replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu,c=>c.split('').map(unit=>'\\u'+unit.charCodeAt(0).toString(16).padStart(4,'0')).join(''));
}
async function main(args=process.argv.slice(2)){
 try{
  const {value,json}=query([...args]),page=await readView(value);
  if(json)process.stdout.write(jsonPage(page)+'\n');
  else{console.log(`${JSON.stringify(page.title)} · ${page.view} · revision ${page.modelRev??'none'}`);console.log(page.notice);for(const r of page.records){console.log('\n'+JSON.stringify(r.label));for(const d of r.details)console.log('  '+JSON.stringify(clean(d).text));if(r.truncated)console.log('  [truncated]');}console.log(`\n${page.records.length?page.offset+1:0}–${page.offset+page.records.length} of ${page.total}`);if(page.nextOffset!==null)console.log(`Next page: rerun this command with --offset ${page.nextOffset} --revision ${page.revision}; keep the same workspace, port, selector and --all setting.`);}
 }catch(e){console.error(clean(e.code?.startsWith('VIEW_')?e.message:'VIEW_STATE: Saved view unavailable',400,true).text);process.exitCode=1;}
}
module.exports={main,query,jsonPage};
if(require.main===module)void main();
