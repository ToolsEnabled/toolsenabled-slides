param([string]$NodeExecutable='C:\Program Files\nodejs\node.exe')
$ErrorActionPreference='Stop'
Add-Type -Path (Join-Path $PSScriptRoot 'fixture-job.cs')
$ownedJob=[SlidesFixtureJob]::Retain()
$root=Join-Path ([IO.Path]::GetTempPath()) ("slides renderer's r$([char]0xe9)sum$([char]0xe9) "+[guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($root)|Out-Null
$records=Join-Path $root 'processes';[IO.Directory]::CreateDirectory($records)|Out-Null
$exe=Join-Path $root 'office-double.exe'
Add-Type -Path (Join-Path $PSScriptRoot 'renderer-double.cs') -OutputAssembly $exe -OutputType ConsoleApplication
$scriptPath=Join-Path $PSScriptRoot 'renderer-timeout.mjs'
# ProcessStartInfo on Framework lacks ArgumentList; only fixed file paths are quoted here.
$start=New-Object Diagnostics.ProcessStartInfo
$start.FileName=$NodeExecutable;$start.Arguments='"'+$scriptPath+'" "'+$root+'" "'+$exe+'"'
$start.UseShellExecute=$false;$start.CreateNoWindow=$true;$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
$child=$null;$handles=@();$seen=@{}
try{
 $child=[Diagnostics.Process]::Start($start);$out=$child.StandardOutput.ReadToEndAsync();$err=$child.StandardError.ReadToEndAsync();$until=[DateTime]::UtcNow.AddSeconds(90)
 while(-not$child.HasExited-and[DateTime]::UtcNow-lt$until){
  foreach($file in [IO.Directory]::GetFiles($records,'*.json')){
   if($seen.ContainsKey($file)){continue}
   $record=Get-Content -Raw -LiteralPath $file|ConvertFrom-Json
   foreach($name in @('root','descendant')){
    $expected=$record.$name;$process=[Diagnostics.Process]::GetProcessById([int]$expected.pid);$handle=$process.Handle
    $member=$false;$created=[long]0;$ended=[long]0;$kernel=[long]0;$user=[long]0
    if(-not[SlidesFixtureJob]::IsProcessInJob($handle,$ownedJob,[ref]$member)-or-not$member-or-not[SlidesFixtureJob]::GetProcessTimes($handle,[ref]$created,[ref]$ended,[ref]$kernel,[ref]$user)-or$created-ne[long]$expected.created){$process.Dispose();throw 'Native renderer identity or owned-job membership mismatch'}
    $handles+=@{process=$process;handle=$handle;kind=$name;created=$created;pid=$expected.pid}
   };$seen[$file]=$true;[IO.File]::WriteAllText(($file+'.retained'),'verified process creation identity and fixture job membership')
  };Start-Sleep -Milliseconds 25
 }
 if(-not$child.WaitForExit(1000)){throw 'Native timeout client exceeded its bounded deadline'}
 [IO.File]::WriteAllText((Join-Path $root 'stdout.log'),$out.GetAwaiter().GetResult());[IO.File]::WriteAllText((Join-Path $root 'stderr.log'),$err.GetAwaiter().GetResult())
 if($child.ExitCode-ne0){throw ('Native timeout client failed; evidence: '+$root)}
 if($seen.Count-ne4-or$handles.Count-ne8){throw 'Deadline and in-flight EOF/owner-death native identities must all be retained'}
 foreach($entry in $handles){if([SlidesFixtureJob]::WaitForSingleObject($entry.handle,5000)-ne0){throw 'Owned native renderer survived its deadline'}}
 if([SlidesFixtureJob]::Active($ownedJob)-ne1){throw 'Native renderer job did not become quiescent'}
 @{pass=$true;cases=4;handles=@($handles|ForEach-Object{@{kind=$_.kind;created=$_.created;pid=$_.pid}})}|ConvertTo-Json -Depth 6|Set-Content -LiteralPath (Join-Path $root 'result.json') -Encoding UTF8
 Write-Output ('NATIVE_RENDERER_CUSTODY_PASS 4 '+$root)
}finally{
 if($child-and-not$child.HasExited){$child.Kill();$null=$child.WaitForExit(5000)}
 foreach($entry in $handles){if([SlidesFixtureJob]::WaitForSingleObject($entry.handle,0)-eq258){$null=[SlidesFixtureJob]::TerminateProcess($entry.handle,1)};$entry.process.Dispose()}
 if($child){if($out.IsCompleted){[IO.File]::WriteAllText((Join-Path $root 'stdout.log'),$out.GetAwaiter().GetResult())};if($err.IsCompleted){[IO.File]::WriteAllText((Join-Path $root 'stderr.log'),$err.GetAwaiter().GetResult())}}
 if($child){$child.Dispose()}
}
