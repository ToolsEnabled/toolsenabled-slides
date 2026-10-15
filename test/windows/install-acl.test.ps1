$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $PSScriptRoot '..\..\install.ps1'
$parseTokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$parseTokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'Installer does not parse' }
foreach ($name in @('Assert-AccountAccess', 'Assert-DirectPath')) {
    $definition = $ast.Find({param($part) $part -is [Management.Automation.Language.FunctionDefinitionAst] -and $part.Name -eq $name}, $true)
    if (-not $definition) { throw ('Function missing: ' + $name) }
    Invoke-Expression $definition.Extent.Text
}
# Execute the production assessor's raw-mask expression, not a second policy.
$maskAssignment = $ast.Find({param($part) $part -is [Management.Automation.Language.AssignmentStatementAst] -and $part.Left.Extent.Text -eq '$dangerous'}, $true)
if (-not $maskAssignment) { throw 'Production ancestor mask assignment is missing' }
$actualMask = Invoke-Expression $maskAssignment.Right.Extent.Text
$maskCases = @(
    @(0x40,$true), @(0x100,$true), @(0x10000,$true), @(0x40000,$true),
    @(0x80000,$true), @(0x10000000,$true), @(0x40000000,$true),
    @(0,$false), @(1,$false), @(2,$false), @(4,$false), @(0x10,$false),
    @(0x20,$false), @(0x80,$false), @(0x20000,$false)
)
foreach ($case in $maskCases) {
    if ((([int]$case[0] -band $actualMask) -ne 0) -ne [bool]$case[1]) { throw 'Production ancestor raw-mask policy changed' }
}
Write-Output ('WINDOWS_INSTALL_MASK_CASES_PASS ' + $maskCases.Count)
# Native owner and raw descriptor tests follow.
$accountSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$trustedSids = @($accountSid.Value, 'S-1-5-18', 'S-1-5-32-544')
$trustedInstallerOwner = 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'
$trustedOwners = $trustedSids + @($trustedInstallerOwner)
$own = $accountSid.Value
$script:descriptor = $null
function Get-Acl { param([string]$LiteralPath) return $script:descriptor }
function Descriptor([string]$Sddl) { $value=New-Object Security.AccessControl.DirectorySecurity; $value.SetSecurityDescriptorSddlForm($Sddl); return $value }
# File-specific rights are numeric: SDDL directory-service mnemonics have different masks.
foreach($mask in @(0x2,0x4,0x20,0x40)){
 $sddl='O:'+$own+'D:(A;;0x'+$mask.ToString('x8')+';;;WD)'
 $raw=[Security.AccessControl.RawSecurityDescriptor]::new($sddl)
 if($raw.DiscretionaryAcl[0].AccessMask-ne$mask){throw 'Authored SDDL file-right mask changed while parsing'}
}
$passed=0
function Accept([string]$Sddl, [bool]$Private) { $script:descriptor=Descriptor $Sddl; Assert-AccountAccess 'C:\synthetic' $Private; $script:passed++ }
function Refuse([string]$Sddl, [bool]$Private) {
    $script:descriptor=Descriptor $Sddl
    $refused=$false
    try { Assert-AccountAccess 'C:\synthetic' $Private } catch { $refused=$true }
    if (-not $refused) { throw 'An unsafe authored descriptor was accepted' }
    $script:passed++
}
Accept ('O:'+$own+'D:P(A;OICI;FA;;;'+$own+')(A;OICI;FA;;;SY)') $true
Accept ('O:SYD:(A;;FR;;;WD)(A;;0x00000004;;;AU)') $false
Accept ('O:BAD:(A;OIIO;FA;;;CO)') $false
Refuse ('O:BUD:(A;;FA;;;'+$own+')') $false
Refuse ('O:SYD:(A;;FA;;;'+$own+')') $true
Refuse ('O:'+$own+'D:NO_ACCESS_CONTROL') $true
Refuse ('O:'+$own+'D:(A;;0x00000040;;;WD)') $false
Refuse ('O:'+$own+'D:(A;;WD;;;AU)') $false
Refuse ('O:'+$own+'D:(A;;FR;;;WD)') $true
# TrustedInstaller is trusted only as an ancestor owner, never a writer or final owner.
Accept ('O:'+$trustedInstallerOwner+'D:(A;;FA;;;'+$own+')') $false
Refuse ('O:'+$trustedInstallerOwner+'D:(A;;FA;;;'+$own+')') $true
Refuse ('O:'+$own+'D:(A;;FA;;;'+$trustedInstallerOwner+')') $false
# Exercise a foreign owner several levels above the intended leaf, without touching a filesystem.
function Test-Path { param([string]$LiteralPath) return $true }
function Get-Item { param([switch]$Force,[string]$LiteralPath) return [pscustomobject]@{Attributes=[IO.FileAttributes]::Directory;PSIsContainer=$true} }
function Get-Acl { param([string]$LiteralPath) if ($LiteralPath -eq 'C:\synthetic') { return (Descriptor ('O:BUD:(A;;FR;;;WD)')) }; return (Descriptor ('O:'+$own+'D:(A;;FA;;;'+$own+')')) }
$refused=$false
try { Assert-DirectPath 'C:\synthetic\parent\new-install' } catch { $refused=$true }
if (-not $refused) { throw 'Foreign-owned ancestor was accepted' }
$passed++
Write-Output ('WINDOWS_INSTALL_ACL_CASES_PASS ' + $passed)
