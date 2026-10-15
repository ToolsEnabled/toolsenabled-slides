using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
public static class TEInstallVolume {
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern uint GetDriveTypeW(string root);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern uint QueryDosDeviceW(string drive,StringBuilder target,uint capacity);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool GetVolumeInformationW(string root,IntPtr volume,uint volumeCapacity,IntPtr serial,IntPtr maxComponent,IntPtr flags,StringBuilder fileSystem,uint capacity);
 public static void Check(string root){
  if(!Regex.IsMatch(root,@"^[A-Za-z]:\\$"))throw new InvalidOperationException("Ordinary drive root required");
  var target=new StringBuilder(8192);var fs=new StringBuilder(32);
  if(GetDriveTypeW(root)!=3||QueryDosDeviceW(root.Substring(0,2),target,(uint)target.Capacity)==0||!Regex.IsMatch(target.ToString(),@"^\\Device\\HarddiskVolume[0-9]+$",RegexOptions.IgnoreCase)||!GetVolumeInformationW(root,IntPtr.Zero,0,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,fs,(uint)fs.Capacity)||!String.Equals(fs.ToString(),"NTFS",StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("Fixed local NTFS volume required; mapped and SUBST drives are refused");
 }
}
