'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const net=require('node:net');const http=require('node:http');const {spawn}=require('node:child_process');
const {Client}=require('../helpers/mcp-client');const {python}=require('../../src/lib/prerequisites');
const {openTarget,evalJs}=require('../helpers/cdp');
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const n=s.address().port;await new Promise(r=>s.close(r));return n;}
async function until(fn){const end=Date.now()+10000;while(Date.now()<end){try{if(await fn())return;}catch{}await new Promise(r=>setTimeout(r,50));}throw new Error('Browser session did not reach expected state');}
test('real browser redeems the fragment, controls the deck and isolates another port',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'slides-browser-session-'));
 const p=await port(),debug=await port();const origin=`http://127.0.0.1:${p}`;
 const client=new Client({SLIDES_WORKSPACE:path.join(root,'deck'),SUITE_PORT:String(p),SUITE_PYTHON:python()});
 let browser,target,otherTarget,leakedCookie='';
 const other=http.createServer((req,res)=>{leakedCookie=req.headers.cookie||'';res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Other local app</title>');});
 await new Promise(r=>other.listen(0,'127.0.0.1',r));
 try{
  await client.request('initialize',{});
  const launch=client.stderr.match(/http:\/\/[^\s]+\/studio#launch=[a-f0-9]{64}/)[0];
  const binary=[process.env.SLIDES_TEST_BROWSER,'/usr/bin/chromium','/usr/bin/google-chrome','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',path.join(process.env.ProgramFiles||'C:\\Program Files','Google/Chrome/Application/chrome.exe')].find(x=>x&&fs.existsSync(x));
  assert.ok(binary,'Set SLIDES_TEST_BROWSER to an installed Chromium browser');
  browser=spawn(binary,['--headless=new',...(process.env.SLIDES_TEST_BROWSER?['--no-sandbox','--no-zygote','--disable-dev-shm-usage']:[]),'--disable-background-networking','--disable-component-update','--no-first-run','--no-default-browser-check',`--remote-debugging-port=${debug}`,'--remote-debugging-address=127.0.0.1',`--user-data-dir=${path.join(root,'profile')}`,'about:blank'],{stdio:'ignore'});
  await until(async()=>(await fetch(`http://127.0.0.1:${debug}/json/version`)).ok);
  target=await openTarget(debug,'about:blank',0);
  await target.send('Page.navigate',{url:launch});
  await until(()=>evalJs(target,"Boolean(sessionStorage.getItem('slidesDashboardSession')) && location.hash === '' && Boolean(document.getElementById('pauseBtn'))"));
  assert.equal(await evalJs(target,"document.cookie.includes('slides_dashboard_')"),false,'cookie is HttpOnly');
  await evalJs(target,"document.getElementById('pauseBtn').click()");
  await until(async()=>(await (await fetch(origin+'/api/state')).json()).paused===true);
  await target.send('Page.reload');
  await until(()=>evalJs(target,"Boolean(sessionStorage.getItem('slidesDashboardSession')) && document.getElementById('pauseBtn').textContent.includes('Resume')"));
  await evalJs(target,"document.getElementById('pauseBtn').click()");
  await until(async()=>(await (await fetch(origin+'/api/state')).json()).paused===false);
  otherTarget=await openTarget(debug,`http://127.0.0.1:${other.address().port}`,300);
  assert.equal(await evalJs(otherTarget,"sessionStorage.getItem('slidesDashboardSession')"),null,'sessionStorage includes the port in its origin');
  assert.match(leakedCookie,/slides_dashboard_/,'a second local port receives the cookie');
  const stolen=await fetch(origin+'/api/pause',{method:'POST',headers:{Origin:origin,Cookie:leakedCookie,'Content-Type':'application/json'},body:'{"by":"human"}'});
  assert.equal(stolen.status,403,'replaying the observed cookie does not authorize a control');
  assert.equal((await (await fetch(origin+'/api/state')).json()).paused,false);
  await client.close();
 }finally{
  if(target)await target.send('Browser.close').catch(()=>{});
  target?.close();otherTarget?.close();
  if(browser&&browser.exitCode===null){await Promise.race([new Promise(r=>browser.once('exit',r)),new Promise(r=>setTimeout(r,2000))]);if(browser.exitCode===null)browser.kill('SIGKILL');}
  if(client.child.exitCode===null){client.child.kill('SIGTERM');await client.exited;}
  other.closeAllConnections();await new Promise(r=>other.close(r));
  fs.rmSync(root,{recursive:true,force:true});
 }
});
