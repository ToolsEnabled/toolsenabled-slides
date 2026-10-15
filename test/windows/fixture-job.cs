using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class SlidesFixtureJob {
 static IntPtr retained;
 [StructLayout(LayoutKind.Sequential)] struct Basic {public long a,b;public uint flags;public UIntPtr c,d;public uint e;public UIntPtr f;public uint g,h;}
 [StructLayout(LayoutKind.Sequential)] struct Io {public ulong a,b,c,d,e,f;}
 [StructLayout(LayoutKind.Sequential)] struct Extended {public Basic basic;public Io io;public UIntPtr a,b,c,d;}
 [StructLayout(LayoutKind.Sequential)] struct Accounting {public long a,b,c,d;public uint faults,total,active,terminated;}
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObjectW(IntPtr attributes,string name);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,ref Extended info,uint bytes);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
 [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int kind,out Accounting info,uint bytes,IntPtr returned);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool IsProcessInJob(IntPtr process,IntPtr job,out bool member);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern uint WaitForSingleObject(IntPtr process,uint milliseconds);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool GetProcessTimes(IntPtr process,out long created,out long exited,out long kernel,out long user);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool TerminateProcess(IntPtr process,uint code);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 public static IntPtr Retain() {
  if(retained!=IntPtr.Zero)return retained;
  IntPtr job=CreateJobObjectW(IntPtr.Zero,null);var limits=new Extended();limits.basic.flags=0x2000;
  if(job==IntPtr.Zero||!SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(Extended)))||!AssignProcessToJobObject(job,GetCurrentProcess())){int e=Marshal.GetLastWin32Error();if(job!=IntPtr.Zero)CloseHandle(job);throw new Win32Exception(e);}
  retained=job;return job;
 }
 public static uint Active(IntPtr job){Accounting info;if(!QueryInformationJobObject(job,1,out info,(uint)Marshal.SizeOf(typeof(Accounting)),IntPtr.Zero))throw new Win32Exception(Marshal.GetLastWin32Error());return info.active;}
}
