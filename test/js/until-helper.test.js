'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const {until,waitMs,DEFAULT_WAIT_MS}=require('../helpers/until');

test('until returns once the condition holds and keeps polling through thrown checks',async()=>{
 let calls=0;
 await until(()=>{calls++;if(calls<3)throw new Error('not yet');return calls>=4;},'four polls',{deadline:5000,interval:5});
 assert.equal(calls,4);
});

test('until fails with the wait name and the deadline when the condition never holds',async()=>{
 const started=Date.now();
 await assert.rejects(until(()=>false,'the page shows the pause button',{deadline:120,interval:10}),
  {message:'Browser session did not reach expected state within 120 ms: the page shows the pause button'});
 assert.ok(Date.now()-started>=120,'waits out the whole deadline before failing');
});

test('the default deadline is 30 s per wait and SLIDES_TEST_WAIT_MS overrides it',()=>{
 const previous=process.env.SLIDES_TEST_WAIT_MS;
 try{
  delete process.env.SLIDES_TEST_WAIT_MS;assert.equal(waitMs(),30000);assert.equal(DEFAULT_WAIT_MS,30000);
  process.env.SLIDES_TEST_WAIT_MS='90000';assert.equal(waitMs(),90000);
  for(const bad of ['0','-5','soon','1.5',''])
   {process.env.SLIDES_TEST_WAIT_MS=bad;assert.equal(waitMs(),30000,JSON.stringify(bad)+' falls back to the default');}
 }finally{if(previous===undefined)delete process.env.SLIDES_TEST_WAIT_MS;else process.env.SLIDES_TEST_WAIT_MS=previous;}
});

test('the browser smoke test waits through the shared helper, not a private 10 s loop',()=>{
 const source=fs.readFileSync(path.join(__dirname,'dashboard-browser-session.test.js'),'utf8');
 assert.match(source,/require\('\.\.\/helpers\/until'\)/);
 assert.doesNotMatch(source,/Date\.now\(\)\+10000/);
 assert.doesNotMatch(source,/async function until\(/);
 const waits=source.match(/\buntil\(/g)||[];
 assert.equal(waits.length,5,'every wait goes through the helper');
 const named=source.match(/^\s*await until\(.*,'[^']+'\);$/gm)||[];
 assert.equal(named.length,waits.length,'every wait names what it waits for');
});
