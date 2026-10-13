'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {randomBytes}=require('node:crypto');
const {proofStderr}=require('../prove-lifecycle');
test('retained lifecycle proof diagnostics redact dashboard capabilities and preserve useful text',()=>{
 const launch=randomBytes(32).toString('hex'),session=randomBytes(32).toString('hex'),cookie=randomBytes(32).toString('hex'),instance=randomBytes(24).toString('hex');
 const raw='Ready\n/studio#launch='+launch+'\nX-Slides-Session: '+session+'\nslides_dashboard_9876='+cookie+'\ninstanceId: '+instance+'\nRenderer libreoffice\n';
 const result=proofStderr(raw);
 for(const value of [launch,session,cookie,instance])assert(!result.includes(value),'Retained proof diagnostics must not contain a capability value');
 assert(result.includes('Ready\n'));assert(result.includes('Renderer libreoffice\n'));
 assert.equal((result.match(/\[redacted\]/g)||[]).length,4);
});
test('retained proof diagnostics keep ordinary text and escape terminal controls',()=>{
 assert.equal(proofStderr('ordinary #launch=short\nRésumé 東京\tready'), 'ordinary #launch=short\nRésumé 東京\tready');
 assert.equal(proofStderr('before\u009b\u202eafter'),'before\ufffd\ufffdafter');
});

test('lifecycle client scrubs capabilities before rolling retention, including split stderr frames',async()=>{
 const {Client}=require('../helpers/mcp-client');
 for(const split of [false,true]){
  const value=randomBytes(32).toString('hex');
  const code='const value=process.env.PROOF_TEST_VALUE,suffix="\\nDiagnostic retained\\n",padding="x".repeat(16000-value.length-suffix.length);if(process.env.PROOF_TEST_SPLIT==="1"){process.stderr.write("/studio#launch="+value.slice(0,20));setTimeout(()=>process.stderr.write(value.slice(20)+padding+suffix),30);}else process.stderr.write("/studio#launch="+value+padding+suffix);';
  const client=new Client({PROOF_TEST_VALUE:value,PROOF_TEST_SPLIT:split?'1':'0'},{command:process.execPath,args:['-e',code],inheritEnv:false,redactStderr:true});
  assert.equal(await client.exited,0);assert(client.stderr.length<=16000);
  assert(!proofStderr(client.stderr).includes(value),'Rolling retained diagnostics must not contain a capability whose marker fell off');
  assert(client.stderr.includes('Diagnostic retained'));
 }
});
