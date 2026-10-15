// An inert native Office process double. It never reads the input deck or writes an export.
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
public static class SlidesRendererDouble {
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct Startup {public uint cb;public string reserved,desktop,title;public uint x,y,xsize,ysize,xchars,ychars,fill,flags;public ushort show,reserved2;public IntPtr reserved3,input,output,error;}
 [StructLayout(LayoutKind.Sequential)] struct Info {public IntPtr process,thread;public uint pid,tid;}
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcessW(string application,StringBuilder command,IntPtr processAttributes,IntPtr threadAttributes,bool inherit,uint flags,IntPtr environment,string cwd,ref Startup startup,out Info info);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessTimes(IntPtr process,out long created,out long exited,out long kernel,out long user);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 public static int Main(string[] args) {
  if(Array.IndexOf(args,"--version")>=0){Console.WriteLine("inert native Office fixture");return 0;}
  if(Array.IndexOf(args,"--descendant")>=0){Thread.Sleep(Timeout.Infinite);return 0;}
  string root=Environment.GetEnvironmentVariable("SLIDES_TEST_RENDER_RECEIPTS");
  if(String.IsNullOrEmpty(root)||!Directory.Exists(root))return 2;
  string exe=Process.GetCurrentProcess().MainModule.FileName;var startup=new Startup();startup.cb=(uint)Marshal.SizeOf(typeof(Startup));Info child;
  // Own process group and no console; no BREAKAWAY_FROM_JOB. The product guardian must retain it.
  if(!CreateProcessW(exe,new StringBuilder("\""+exe+"\" --descendant"),IntPtr.Zero,IntPtr.Zero,false,0x208,IntPtr.Zero,root,ref startup,out child))throw new Win32Exception(Marshal.GetLastWin32Error());
  long born,end,kernel,user;
  if(!GetProcessTimes(child.process,out born,out end,out kernel,out user))throw new Win32Exception(Marshal.GetLastWin32Error());
  string record="{\"root\":{\"pid\":"+Process.GetCurrentProcess().Id+",\"created\":\""+Process.GetCurrentProcess().StartTime.ToFileTimeUtc()+"\"},\"descendant\":{\"pid\":"+child.pid+",\"created\":\""+born+"\"}}";
  string file=Path.Combine(root,Guid.NewGuid().ToString("N"));File.WriteAllText(file+".tmp",record,new UTF8Encoding(false));File.Move(file+".tmp",file+".json");
  CloseHandle(child.thread);CloseHandle(child.process);Thread.Sleep(Timeout.Infinite);return 0;
 }
}
