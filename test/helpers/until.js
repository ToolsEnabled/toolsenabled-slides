'use strict';
// Polls an asynchronous condition until it holds. The browser smoke test waits on a real Chromium start, page
// loads and server state through this; on a loaded machine (concurrent LibreOffice exports, installs, other
// suites) each of those can take well over the 10 s the test once allowed, so each wait gets 30 s by default.
// SLIDES_TEST_WAIT_MS overrides the deadline. A wait that never holds fails with its name and the deadline.
const DEFAULT_WAIT_MS=30000;
function waitMs(){const value=Number(process.env.SLIDES_TEST_WAIT_MS);return Number.isInteger(value)&&value>0?value:DEFAULT_WAIT_MS;}
async function until(condition,what,{deadline=waitMs(),interval=50}={}){
 const end=Date.now()+deadline;
 for(;;){
  try{if(await condition())return;}catch{}
  if(Date.now()>=end)break;
  await new Promise(r=>setTimeout(r,interval));
 }
 throw new Error(`Browser session did not reach expected state within ${deadline} ms: ${what}`);
}
module.exports={until,waitMs,DEFAULT_WAIT_MS};
