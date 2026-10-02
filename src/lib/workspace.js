'use strict';
const fs=require('node:fs');const path=require('node:path');
function inside(root,p){if(process.platform==='win32'){root=root.toLowerCase();p=p.toLowerCase();}return p===root || p.startsWith(root+path.sep);}
function confined(root,value,{write=false,directory=false}={}){
 root=fs.realpathSync.native(root);
 if(typeof value!=='string'||!value||value.includes('\0')||value.includes('\\')||path.isAbsolute(value)||value.split('/').some(s=>!s||s==='.'||s==='..'))throw new Error('Use a relative path inside the workspace');
 const dest=path.resolve(root,value);if(!inside(root,dest))throw new Error('Path escapes workspace');
 const state=path.join(root,'.slides-state');
 if(inside(state,dest)||value.split('/').some(s=>s.startsWith('.')))throw new Error('Private workspace files are not import/export destinations');
 let cursor=root;
 for(const part of value.split('/')){
  cursor=path.join(cursor,part);
  if(fs.existsSync(cursor)||(()=>{try{fs.lstatSync(cursor);return true;}catch{return false;}})()){
   const stat=fs.lstatSync(cursor);if(stat.isSymbolicLink())throw new Error('Symlinks are not allowed in import/export paths');
   const real=fs.realpathSync.native(cursor);
   if(!inside(root,real))throw new Error('Path escapes workspace');
   if(inside(state,real))throw new Error('Private workspace files are not import/export destinations');
  }else if(cursor!==dest)throw new Error('Parent directory does not exist; create it inside the workspace first');
 }
 if(!write){const st=fs.statSync(dest);if(!st.isFile()||st.size>32*1024*1024)throw new Error('Import must be a PPTX file of at most 32 MiB');}
 else if(fs.existsSync(dest))throw new Error('Output already exists; choose a new destination');
 return dest;
}
function lease(data){
 fs.mkdirSync(data,{recursive:true,mode:0o700});
 if(fs.lstatSync(data).isSymbolicLink())throw new Error('State directory must not be a symlink');
 const file=path.join(data,'server.lock');
 // Conservative crash recovery: never steal a lease automatically or probe untrusted PIDs.
 const value=JSON.stringify({pid:process.pid,entry:'slides-server',started:new Date().toISOString()});
 try{fs.writeFileSync(file,value,{flag:'wx',mode:0o600});}catch(e){throw new Error('Workspace is already leased or its state is inaccessible. Stop the other Slides server, or choose another SLIDES_WORKSPACE. After a crash, verify the recorded PID is gone before removing .slides-state/server.lock.');}
 const release=()=>{try{if(fs.readFileSync(file,'utf8')===value)fs.unlinkSync(file);}catch{}};
 process.once('exit',release);return release;
}
module.exports={confined,lease};
