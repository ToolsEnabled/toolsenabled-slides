const test=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,mkdir,writeFile,symlink}=require('node:fs/promises');
const {createHash}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {join,resolve}=require('node:path');
const {tmpdir}=require('node:os');
const verify=resolve(__dirname,'../../tools/verify-source.mjs');
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'slides-verifier-test-'));
 await mkdir(join(root,'.claude-plugin'));await mkdir(join(root,'tools'));
 const files={'.claude-plugin/plugin.json':JSON.stringify({version:'0.8.4'}),'.claude-plugin/marketplace.json':JSON.stringify({metadata:{version:'0.8.4'}}),'sample.txt':'fixture\n'};
 const manifest={plugin:'toolsenabled-slides',version:'0.8.4',files:[]};
 for(const [path,content]of Object.entries(files)){
  await writeFile(join(root,path),content);
  manifest.files.push({path,bytes:Buffer.byteLength(content),sha256:createHash('sha256').update(content).digest('hex')});
 }
 await writeFile(join(root,'tools/source-hashes.json'),JSON.stringify(manifest));
 return {root,manifest};
}
function run(root){return spawnSync(process.execPath,[verify,root],{encoding:'utf8',timeout:5000});}
test('valid manifest verifies every listed payload file',async()=>{
 const {root}=await fixture();const result=run(root);assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/Verified 3 files/);
});
test('an invalid manifest plugin is refused',async()=>{
 const {root,manifest}=await fixture();manifest.plugin='another-plugin';await writeFile(join(root,'tools/source-hashes.json'),JSON.stringify(manifest));const result=run(root);assert.equal(result.status,1);assert.match(result.stderr,/Invalid release manifest/);
});
test('changed bytes are refused; restoring bytes returns GREEN',async()=>{
 const {root}=await fixture();const path=join(root,'sample.txt');
 await writeFile(path,'mutated\n');const red=run(root);assert.equal(red.status,1);assert.match(red.stderr,/sample.txt/);
 await writeFile(path,'fixture\n');const green=run(root);assert.equal(green.status,0,green.stderr);
});
test('an unlisted file is refused',async()=>{
 const {root}=await fixture();await writeFile(join(root,'unlisted.txt'),'extra');const result=run(root);assert.equal(result.status,1);assert.match(result.stderr,/unlisted.txt/);
});
test('unsafe manifest traversal is refused',async()=>{
 const {root,manifest}=await fixture();manifest.files[0].path='../outside';await writeFile(join(root,'tools/source-hashes.json'),JSON.stringify(manifest));const result=run(root);assert.equal(result.status,1);assert.match(result.stderr,/Invalid manifest path/);
});
test('listed symbolic link is refused even if target bytes match',{skip:process.platform==='win32'?'symlink privilege is not an installer prerequisite':false},async()=>{
 const {root,manifest}=await fixture();await symlink('sample.txt',join(root,'linked.txt'));manifest.files.push({...manifest.files[2],path:'linked.txt'});await writeFile(join(root,'tools/source-hashes.json'),JSON.stringify(manifest));const result=run(root);assert.equal(result.status,1);assert.match(result.stderr,/Symbolic link refused: linked.txt/);
});
test('duplicate entries cannot inflate the verified file count',async()=>{
 const {root,manifest}=await fixture();manifest.files.push(manifest.files[2]);await writeFile(join(root,'tools/source-hashes.json'),JSON.stringify(manifest));const result=run(root);assert.equal(result.status,1);assert.match(result.stderr,/Repeated manifest file/);
});
test('matching hashes do not hide disagreeing versions',async()=>{
 const {root,manifest}=await fixture();manifest.version='0.8.5';await writeFile(join(root,'tools/source-hashes.json'),JSON.stringify(manifest));const result=run(root);assert.equal(result.status,1);assert.match(result.stderr,/versions disagree/);
});
