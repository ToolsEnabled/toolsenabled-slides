$ErrorActionPreference='Stop'
$sourceRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $sourceRoot 'install.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Installer does not parse'}
foreach($name in @('Assert-PlainLocalInput','Full-LocalPath','Assert-AccountAccess','Assert-DirectPath','New-PrivateFolder')){
 $definition=$ast.Find({param($part)$part-is[Management.Automation.Language.FunctionDefinitionAst]-and$part.Name-eq$name},$true)
 if(-not$definition){throw ('Missing real installer function: '+$name)};Invoke-Expression $definition.Extent.Text
}
$accountSid=[Security.Principal.WindowsIdentity]::GetCurrent().User;$trustedSids=@($accountSid.Value,'S-1-5-18','S-1-5-32-544')
$trustedOwners=$trustedSids+@('S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')
$everyone=New-Object Security.Principal.SecurityIdentifier('S-1-1-0')
$root=Join-Path ([IO.Path]::GetTempPath()) ('te-native-filesystem-'+[guid]::NewGuid().ToString('N'));$passed=0
function Refuse([scriptblock]$Action){$denied=$false;try{&$Action}catch{$denied=$true};if(-not$denied){throw 'Unsafe actual filesystem fixture accepted'};$script:passed++}
New-PrivateFolder $root;$passed++
if((Full-LocalPath $root)-ne$root){throw 'Native local NTFS volume spelling changed'};$passed++
# Exercise the actual compiled volume-root predicate, including substituted
# subdirectory spellings; the actual junction negative remains below.
$physical='\Device\HarddiskVolume3\';$volumeCases=0
foreach($candidate in @($physical,'\Device\HarddiskVolume0\')){if(-not[TEInstallVolume]::IsPhysicalRoot($candidate)){throw 'Physical volume root rejected'};$volumeCases++}
foreach($candidate in @($null,'',$physical.TrimEnd('\'),($physical+'sub\'),($physical+"`n"),'\Device\Mup\','\??\C:\','C:\','\\?\C:\','\Device\HarddiskVolume3suffix\','Device\HarddiskVolume3\','\Device\HarddiskVolume-3\')){if([TEInstallVolume]::IsPhysicalRoot($candidate)){throw 'Aliased or malformed physical root accepted'};$volumeCases++}
Write-Output ('VOLUME_ROOT_POLICY_PASS '+$volumeCases)

# Restrict fixture mutations to owner + DACL. Set-Acl can request SACL
# privileges even for this ordinary-user fixture; no audit section is needed.
$fixtureSections=[Security.AccessControl.AccessControlSections]([int][Security.AccessControl.AccessControlSections]::Access-bor[int][Security.AccessControl.AccessControlSections]::Owner)
function Read-FixtureAcl { return [IO.Directory]::GetAccessControl($root,$fixtureSections) }
function Write-FixtureAcl([Security.AccessControl.DirectorySecurity]$Value) {
 $copy=New-Object Security.AccessControl.DirectorySecurity
 $copy.SetSecurityDescriptorBinaryForm($Value.GetSecurityDescriptorBinaryForm(),$fixtureSections)
 [IO.Directory]::SetAccessControl($root,$copy)
}
$original=Read-FixtureAcl
if($original.GetOwner([Security.Principal.SecurityIdentifier]).Value-ne$accountSid.Value-or-not$original.AreAccessRulesProtected){throw 'Created directory is not protected and current-SID owned'};$passed++
try{
 $acl=Read-FixtureAcl;$rule=New-Object Security.AccessControl.FileSystemAccessRule($everyone,[Security.AccessControl.FileSystemRights]::Read,[Security.AccessControl.AccessControlType]::Allow);$null=$acl.AddAccessRule($rule);Write-FixtureAcl $acl
 Refuse {Assert-AccountAccess $root $true}
}finally{Write-FixtureAcl $original}
foreach($rights in @([Security.AccessControl.FileSystemRights]0x40,[Security.AccessControl.FileSystemRights]::Delete,[Security.AccessControl.FileSystemRights]::WriteAttributes,[Security.AccessControl.FileSystemRights]::ChangePermissions)){
 try{
  $acl=Read-FixtureAcl;$rule=New-Object Security.AccessControl.FileSystemAccessRule($everyone,$rights,[Security.AccessControl.AccessControlType]::Allow);$null=$acl.AddAccessRule($rule);Write-FixtureAcl $acl
  Refuse {Assert-DirectPath (Join-Path $root 'new-child')}
 }finally{Write-FixtureAcl $original}
}
try{
 $acl=New-Object Security.AccessControl.DirectorySecurity;$acl.SetSecurityDescriptorSddlForm(('O:'+$accountSid.Value+'D:NO_ACCESS_CONTROL'),$fixtureSections);Write-FixtureAcl $acl
 Refuse {Assert-AccountAccess $root $true}
}finally{Write-FixtureAcl $original}
$target=Join-Path $root 'target';New-PrivateFolder $target;$junction=Join-Path $root 'junction';New-Item -ItemType Junction -Path $junction -Target $target|Out-Null
Refuse {Assert-DirectPath (Join-Path $junction 'new-child')}
Refuse {New-PrivateFolder $root}
if([IO.Directory]::GetFiles($target).Count-ne0-or[IO.Directory]::GetDirectories($target).Count-ne0){throw 'Refusal modified junction target'}
@{pass=$true;cases=$passed;root=$root;owner=$accountSid.Value;volume='native fixed local NTFS';ordinaryAccount=[Security.Principal.WindowsIdentity]::GetCurrent().Name}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $root 'result.json') -Encoding UTF8
Write-Output ('NATIVE_INSTALL_FILESYSTEM_PASS '+$passed+' '+$root)
