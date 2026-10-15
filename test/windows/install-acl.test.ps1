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
$accountSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$trustedSids = @($accountSid.Value, 'S-1-5-18', 'S-1-5-32-544')
$own = $accountSid.Value
$script:descriptor = $null
function Get-Acl { param([string]$LiteralPath) return $script:descriptor }
function Descriptor([string]$Sddl) { $value=New-Object Security.AccessControl.DirectorySecurity; $value.SetSecurityDescriptorSddlForm($Sddl); return $value }
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
Accept ('O:SYD:(A;;FR;;;WD)(A;;AD;;;AU)') $false
Accept ('O:BAD:(A;OIIO;FA;;;CO)') $false
Refuse ('O:BUD:(A;;FA;;;'+$own+')') $false
Refuse ('O:SYD:(A;;FA;;;'+$own+')') $true
Refuse ('O:'+$own+'D:NO_ACCESS_CONTROL') $true
Refuse ('O:'+$own+'D:(A;;DC;;;WD)') $false
Refuse ('O:'+$own+'D:(A;;WD;;;AU)') $false
Refuse ('O:'+$own+'D:(A;;FR;;;WD)') $true
# Exercise a foreign owner several levels above the intended leaf, without touching a filesystem.
function Test-Path { param([string]$LiteralPath) return $true }
function Get-Item { param([switch]$Force,[string]$LiteralPath) return [pscustomobject]@{Attributes=[IO.FileAttributes]::Directory;PSIsContainer=$true} }
function Get-Acl { param([string]$LiteralPath) if ($LiteralPath -eq 'C:\synthetic') { return (Descriptor ('O:BUD:(A;;FR;;;WD)')) }; return (Descriptor ('O:'+$own+'D:(A;;FA;;;'+$own+')')) }
$refused=$false
try { Assert-DirectPath 'C:\synthetic\parent\new-install' } catch { $refused=$true }
if (-not $refused) { throw 'Foreign-owned ancestor was accepted' }
$passed++
Write-Output ('WINDOWS_INSTALL_ACL_CASES_PASS ' + $passed)
