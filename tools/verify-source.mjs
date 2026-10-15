// Verify the complete payload without an internal source repository or dependencies.
import {readFile, readdir, lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(process.argv[2]||fileURLToPath(new URL('../',import.meta.url)));
try {
 const manifest=JSON.parse(await readFile(join(root,'tools/source-hashes.json'),'utf8'));
 if(manifest.plugin!=='toolsenabled-slides'||!Array.isArray(manifest.files))throw new Error('Invalid release manifest');
 const listed=new Set();
 for(const entry of manifest.files){
  if(typeof entry.path!=='string'||entry.path.split('/').some(part=>!part||part==='.'||part==='..')||entry.path.startsWith('/')||entry.path.includes('\\')||entry.path==='tools/source-hashes.json'||entry.path==='.git'||entry.path.startsWith('.git/'))throw new Error('Invalid manifest path');
  if(listed.has(entry.path))throw new Error(`Repeated manifest file: ${entry.path}`);
  listed.add(entry.path);
  let path=root;
  for(const part of entry.path.split('/')){path=join(path,part);if((await lstat(path)).isSymbolicLink())throw new Error(`Symbolic link refused: ${entry.path}`);}
  const bytes=await readFile(path);
  if(bytes.length!==entry.bytes||createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw new Error(`File verification failed: ${entry.path}`);
 }
 async function walk(directory,prefix=''){
  for(const item of await readdir(directory,{withFileTypes:true})){
   const name=prefix+item.name;
   if(name==='.git'||name==='tools/source-hashes.json')continue;
   if(item.isDirectory()){await walk(join(directory,item.name),name+'/');continue;}
   if(item.isFile()&&listed.has(name))continue;
   throw new Error(`Unlisted or non-regular file: ${name}`);
  }
 }
 await walk(root);
 const plugin=JSON.parse(await readFile(join(root,'.claude-plugin/plugin.json'),'utf8'));
 const marketplace=JSON.parse(await readFile(join(root,'.claude-plugin/marketplace.json'),'utf8'));
 if(plugin.version!==manifest.version||marketplace.metadata.version!==manifest.version)throw new Error('Release versions disagree');
 console.log(`Verified ${listed.size} files for ToolsEnabled Slides ${manifest.version}; tools/source-hashes.json is the checksum list and is not self-hashed.`);
}catch(error){console.error(`Verification refused: ${error.message}`);process.exitCode=1;}
