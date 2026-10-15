using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Win32.SafeHandles;
public static class TEInstallVolume {
 [StructLayout(LayoutKind.Sequential)] private struct FileInformation {
  public uint Attributes;
  public System.Runtime.InteropServices.ComTypes.FILETIME Created,Accessed,Written;
  public uint Volume,SizeHigh,SizeLow,Links,IndexHigh,IndexLow;
 }
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern uint GetDriveTypeW(string root);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafeFileHandle CreateFileW(string path,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
 [DllImport("kernel32.dll",SetLastError=true)] static extern uint GetFileType(SafeFileHandle handle);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle handle,out FileInformation information);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern uint GetFinalPathNameByHandleW(SafeFileHandle handle,StringBuilder path,uint size,uint flags);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool GetVolumeInformationByHandleW(SafeFileHandle handle,StringBuilder name,uint nameSize,out uint serial,out uint maximum,out uint flags,StringBuilder fileSystem,uint size);
 public static bool IsPhysicalRoot(string value){return value!=null&&Regex.IsMatch(value,@"\A\\Device\\HarddiskVolume[0-9]+\\\z");}
 public static void Check(string root){
  if(root==null||!Regex.IsMatch(root,@"\A[A-Za-z]:\\\z"))throw new InvalidOperationException("Ordinary drive root required");
  if(GetDriveTypeW(root)!=3)throw new InvalidOperationException("Fixed local drive required");
  // The same root handle supplies DOS, native physical path and filesystem
  // identity, and stays open without FILE_SHARE_DELETE through all checks.
  using(SafeFileHandle handle=CreateFileW(root,0x20080,3,IntPtr.Zero,3,0x02200000,IntPtr.Zero)){
   FileInformation information;
   if(handle.IsInvalid||GetFileType(handle)!=1||!GetFileInformationByHandle(handle,out information)||(information.Attributes&0x410)!=0x10)throw new InvalidOperationException("Ordinary retained disk directory required");
   var dos=new StringBuilder(32768);uint count=GetFinalPathNameByHandleW(handle,dos,(uint)dos.Capacity,0);
   if(count==0||count>=dos.Capacity||!String.Equals(dos.ToString(),@"\\?\"+root,StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("Retained root DOS path differs");
   var physical=new StringBuilder(32768);count=GetFinalPathNameByHandleW(handle,physical,(uint)physical.Capacity,2);
   if(count==0||count>=physical.Capacity||!IsPhysicalRoot(physical.ToString()))throw new InvalidOperationException("Physical volume root required; mapped and substituted directory roots are refused");
   var fs=new StringBuilder(64);uint serial,maximum,flags;
   if(!GetVolumeInformationByHandleW(handle,null,0,out serial,out maximum,out flags,fs,(uint)fs.Capacity)||!String.Equals(fs.ToString(),"NTFS",StringComparison.OrdinalIgnoreCase)||(flags&8)==0||serial!=information.Volume)throw new InvalidOperationException("Retained persistent-ACL NTFS identity required");
  }
 }
}
