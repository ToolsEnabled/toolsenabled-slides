'use strict';
const fs=require('node:fs');
const path=require('node:path');
const childProcess=require('node:child_process');
const INSTALL=path.resolve(__dirname,'../..');
process.env.NoDefaultCurrentDirectoryInExePath='1';
function absolutePath(value,platform=process.platform){
 if(typeof value!=='string'||!value||value.startsWith('~'))return false;
 return platform==='win32'?path.win32.isAbsolute(value)&&(/^[A-Za-z]:[\\/]/.test(value)||/^\\\\[^\\/]+[\\/][^\\/]+/.test(value)):path.posix.isAbsolute(value);
}
function inside(root,value){const fold=s=>['win32','darwin'].includes(process.platform)?s.toLowerCase():s;return fold(value)===fold(root)||fold(value).startsWith(fold(root)+path.sep);}
function systemHelper(name){
 const suffix={attrib:'attrib.exe',taskkill:'taskkill.exe',powershell:'WindowsPowerShell/v1.0/powershell.exe',cmd:'cmd.exe'}[name];
 if(!suffix)throw new Error('Unknown system helper');
 const systemRoot=process.env.SystemRoot||'C:\\Windows';
 if(!path.isAbsolute(systemRoot))throw new Error('SystemRoot must be absolute');
 return path.join(systemRoot,'System32',suffix);
}
function canonicalFuture(value){
 const absolute=path.resolve(value);let ancestor=absolute;
 while(!fs.existsSync(ancestor)){const parent=path.dirname(ancestor);if(parent===ancestor)throw new Error('Cannot resolve path');ancestor=parent;}
 return path.resolve(fs.realpathSync.native(ancestor),path.relative(ancestor,absolute));
}
function resolveExecutable(command){
 const workspace=process.env.SLIDES_WORKSPACE;
 const allowed=file=>{
  try{
   const real=fs.realpathSync.native(file);
   if(workspace&&inside(canonicalFuture(workspace),real))return false;
   if(!fs.statSync(file).isFile())return false;
   fs.accessSync(file,process.platform==='win32'?fs.constants.F_OK:fs.constants.X_OK);return true;
  }catch{return false;}
 };
 if(absolutePath(command)){if(allowed(command))return path.normalize(command);throw new Error('Configured executable is missing or inside the workspace');}
 if(command.includes('/')||command.includes('\\'))throw new Error('Configured executable must use an absolute path');
 for(const directory of (process.env.PATH||'').split(path.delimiter)){
  if(!directory||!path.isAbsolute(directory)||path.resolve(directory)===process.cwd())continue;
  for(const suffix of process.platform==='win32'?['.exe','.com']:['']){
   const file=path.join(directory,command+suffix);if(allowed(file))return file;
  }
 }
 throw new Error('No trusted executable found for '+command+'; configure an absolute path outside the workspace');
}
function executable(command){
 if(process.platform==='win32'&&['attrib','powershell','taskkill','cmd'].includes(command))return systemHelper(command);
 return resolveExecutable(command);
}
function options(value){return {...value,cwd:value?.cwd||INSTALL,env:{...(value?.env||process.env),NoDefaultCurrentDirectoryInExePath:'1',PYTHONDONTWRITEBYTECODE:'1'}};}
function childArgs(command,args){return command===process.env.SUITE_PYTHON||/^python(?:[0-9.]+)?(?:\.exe)?$/i.test(path.basename(command))?['-B',...args]:args;}
function spawn(command,args,opts){return childProcess.spawn(executable(command),childArgs(command,args),options(opts));}
function spawnSync(command,args,opts){return childProcess.spawnSync(executable(command),childArgs(command,args),options(opts));}
function execFile(command,args,opts,callback){if(typeof opts==='function'){callback=opts;opts={};}return childProcess.execFile(executable(command),childArgs(command,args),options(opts),callback);}
module.exports={inside,absolutePath,INSTALL,systemHelper,resolveExecutable,executable,spawn,spawnSync,execFile};
