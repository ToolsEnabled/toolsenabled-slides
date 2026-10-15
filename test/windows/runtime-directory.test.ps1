param([Parameter(Mandatory=$true)][string]$Python)
$ErrorActionPreference='Stop';Set-StrictMode -Version 2.0
$sourceRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$installer=Join-Path $sourceRoot 'install.ps1'
$ast=[Management.Automation.Language.Parser]::ParseFile($installer,[ref]$null,[ref]$null)
foreach($name in @('Assert-AccountAccess','Assert-DirectPath','New-PrivateFolder')){
 $definition=$ast.Find({param($node)$node-is[Management.Automation.Language.FunctionDefinitionAst]-and$node.Name-eq$name},$true)
 if(!$definition){throw 'Missing actual installer function'};Invoke-Expression $definition.Extent.Text
}
$accountSid=[Security.Principal.WindowsIdentity]::GetCurrent().User
$trustedSids=@($accountSid.Value,'S-1-5-18','S-1-5-32-544')
$trustedOwners=$trustedSids+@('S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')
$scope=Join-Path $env:TEMP ('slides-runtime-directory-'+[Guid]::NewGuid().ToString('N'))
New-PrivateFolder $scope
$target=Join-Path $scope "runtime's résumé 中文 🚀";$setup=Join-Path $sourceRoot 'tools/setup-runtime.py'
$code="import runpy,sys; from pathlib import Path; runpy.run_path(sys.argv[1])['create_runtime_directory'](Path(sys.argv[2]))"
function Invoke-FixturePython([string]$Script,[string[]]$Values,[bool]$Accept){
 $previous=$ErrorActionPreference
 try{$ErrorActionPreference='Continue';$global:LASTEXITCODE=$null;$output=& $Python -I -B -c $Script @Values 2>&1;$exit=$LASTEXITCODE}
 finally{$ErrorActionPreference=$previous}
 if($null-eq$exit-or(($exit-eq0)-ne$Accept)){throw ('Native runtime-directory result mismatch: '+($output|Out-String))}
}
Invoke-FixturePython $code @($setup,$target) $true
Assert-AccountAccess $target $true
$acl=Get-Acl -LiteralPath $target
if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value-cne$accountSid.Value-or!$acl.AreAccessRulesProtected){throw 'New runtime owner or protected DACL differs'}
$before=$acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]'Owner,Access')
[IO.File]::WriteAllText((Join-Path $target 'keep'),'synthetic marker')
Invoke-FixturePython $code @($setup,$target) $false
if((Get-Content -LiteralPath (Join-Path $target 'keep') -Raw)-cne'synthetic marker'-or(Get-Acl -LiteralPath $target).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]'Owner,Access')-cne$before){throw 'Existing runtime changed'}
$file=Join-Path $scope 'existing-file';[IO.File]::WriteAllText($file,'preserve file')
$fileAcl=(Get-Acl -LiteralPath $file).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]'Owner,Access')
Invoke-FixturePython $code @($setup,$file) $false
if([IO.File]::ReadAllText($file)-cne'preserve file'-or(Get-Acl -LiteralPath $file).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]'Owner,Access')-cne$fileAcl){throw 'Existing file or ACL was overwritten'}
# The original mkdir(0700) path must still be refused; the guard is not widened.
$legacy=Join-Path $scope 'legacy-runtime'
Invoke-FixturePython 'import sys; from pathlib import Path; Path(sys.argv[1]).mkdir(mode=0o700)' @($legacy) $true
$refused=$false;try{Assert-AccountAccess $legacy $true}catch{$refused=$true}
if(!$refused){throw 'Legacy OWNER_RIGHTS/default-owner creation unexpectedly passed'}
Write-Output 'NATIVE_RUNTIME_CREATE_NEW_PASS 4'
