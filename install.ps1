[CmdletBinding()]
param(
    [string]$Prefix,
    [Parameter(Mandatory=$true)][string]$Workspace,
    [string]$RuntimeDirectory,
    [Parameter(Mandatory=$true)][string]$WheelsDirectory,
    [string]$NodeExecutable,
    [string]$BasePython,
    [string]$PythonArchive,
    [string]$Soffice
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$sourceRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$version = (Get-Content -Raw -LiteralPath (Join-Path $sourceRoot 'package.json') | ConvertFrom-Json).version
$accountSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$trustedSids = @($accountSid.Value, 'S-1-5-18', 'S-1-5-32-544')
# Measured C: owner only. This does not authorize its grants or private terminal ownership.
$trustedInstallerOwner = 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'
$trustedOwners = $trustedSids + @($trustedInstallerOwner)
$accountProfile = [Environment]::GetFolderPath('UserProfile')
if (-not $Prefix) { $Prefix = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) ('ToolsEnabled\Slides\' + $version) }
if (-not $RuntimeDirectory) { $RuntimeDirectory = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) ('ToolsEnabled\Slides Runtime\' + $version) }
function Assert-PlainLocalInput([string]$Value) {
    if (-not $Value -or $Value -notmatch '^[A-Za-z]:[\\/]' -or $Value.Substring(2).Contains(':')) { throw 'Use an absolute ordinary local drive path.' }
    foreach ($part in $Value.Replace('/', '\').Substring(3).Split('\')) {
        if (-not $part) { continue }
        if ($part -in @('.', '..') -or $part -match '[<>"|?*\x00-\x1f]' -or $part -match '[. ]$' -or $part -match '^(?i:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)') { throw 'Ambiguous, device or stream path spelling is refused.' }
    }
}
function Full-LocalPath([string]$Value) {
    Assert-PlainLocalInput $Value
    $result = [IO.Path]::GetFullPath($Value)
    $root = [IO.Path]::GetPathRoot($result)
    if (-not ('TEInstallVolume' -as [type])) { Add-Type -Path (Join-Path $sourceRoot 'tools\windows-volume.cs') }
    [TEInstallVolume]::Check($root)
    if ($result -ne $root) { $result = $result.TrimEnd('\') }
    return $result
}
function Inside([string]$Parent, [string]$Child) {
    return $Child.Equals($Parent, [StringComparison]::OrdinalIgnoreCase) -or $Child.StartsWith($Parent.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)
}
function Assert-DirectPath([string]$Value) {
    $cursor = [IO.Path]::GetPathRoot($Value)
    Assert-AccountAccess $cursor $false
    foreach ($part in $Value.Substring($cursor.Length).Split('\')) {
        if (-not $part) { continue }
        $cursor = Join-Path $cursor $part
        if (-not (Test-Path -LiteralPath $cursor)) { break }
        $item = Get-Item -Force -LiteralPath $cursor
        if (([int]$item.Attributes -band [int][IO.FileAttributes]::ReparsePoint) -ne 0 -or -not $item.PSIsContainer) { throw ('Path crosses a reparse point or file: ' + $cursor) }
        Assert-AccountAccess $cursor $false
    }
}
function Assert-AccountAccess([string]$Value, [bool]$Private) {
    $acl = Get-Acl -LiteralPath $Value
    $ownerSid = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
    if (($Private -and $ownerSid -ne $accountSid.Value) -or (-not $Private -and $trustedOwners -notcontains $ownerSid)) { throw ('Folder has a different owner: ' + $Value) }
    $raw = [Security.AccessControl.RawSecurityDescriptor]::new($acl.GetSecurityDescriptorBinaryForm(), 0)
    if ($null -eq $raw.DiscretionaryAcl) { throw ('Folder has a null DACL: ' + $Value) }
    foreach ($ace in $raw.DiscretionaryAcl) {
        if ($ace.AceType -ne [Security.AccessControl.AceType]::AccessAllowed -and $ace.AceType -ne [Security.AccessControl.AceType]::AccessDenied) { throw ('Folder has an unrecognized ACL entry: ' + $Value) }
    }
    # Existing ancestors may allow sibling creation. They must not let another
    # account replace/delete an existing path or change its attributes, owner or DACL.
    $dangerous = [int]0x500D0140
    foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
        $appliesHere = ([int]$rule.PropagationFlags -band [int][Security.AccessControl.PropagationFlags]::InheritOnly) -eq 0
        if ($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and $trustedSids -notcontains $rule.IdentityReference.Value -and ($Private -or ($appliesHere -and (([int]$rule.FileSystemRights -band [int]$dangerous) -ne 0)))) {
            throw ('Folder grants another account access incompatible with this install: ' + $Value)
        }
    }
}
function New-PrivateFolder([string]$Value) {
    if (Test-Path -LiteralPath $Value) { throw ('Refusing to overwrite an existing install or data folder: ' + $Value) }
    $parent = Split-Path -Parent $Value
    if (-not (Test-Path -LiteralPath $parent)) { New-PrivateFolder $parent }
    Assert-DirectPath $parent
    Assert-AccountAccess $parent $false
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetOwner($accountSid)
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($sidText in @($accountSid.Value, 'S-1-5-18')) {
        $sid = New-Object Security.Principal.SecurityIdentifier($sidText)
        $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, [Security.AccessControl.FileSystemRights]::FullControl, [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit', [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow)
        $acl.AddAccessRule($rule)
    }
    [IO.Directory]::CreateDirectory($Value, $acl) | Out-Null
    Assert-AccountAccess $Value $true
}
$Prefix = Full-LocalPath $Prefix
$RuntimeDirectory = Full-LocalPath $RuntimeDirectory
$Workspace = Full-LocalPath $Workspace
$WheelsDirectory = Full-LocalPath $WheelsDirectory
$accountProfile = Full-LocalPath $accountProfile
foreach ($folder in @($Prefix, $RuntimeDirectory)) {
    if (-not (Inside $accountProfile $folder) -or $folder -eq $accountProfile) { throw 'Install and runtime folders must be below your own Windows profile.' }
    Assert-DirectPath $folder
    if (Test-Path -LiteralPath $folder) { throw ('Choose a new path; this installer never replaces existing folders: ' + $folder) }
}
if (-not (Test-Path -LiteralPath $Workspace -PathType Container)) { throw 'Choose an existing private workspace folder.' }
Assert-DirectPath $Workspace
Assert-AccountAccess $Workspace $true
Assert-DirectPath $WheelsDirectory
foreach ($pair in @(@($Prefix, $RuntimeDirectory), @($Prefix, $Workspace), @($RuntimeDirectory, $Workspace), @($sourceRoot, $Prefix), @($sourceRoot, $RuntimeDirectory), @($sourceRoot, $Workspace))) {
    if ((Inside $pair[0] $pair[1]) -or (Inside $pair[1] $pair[0])) { throw 'Source, install, runtime and workspace folders must not overlap.' }
}
if (-not $NodeExecutable) { $NodeExecutable = (Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source }
$NodeExecutable = [IO.Path]::GetFullPath($NodeExecutable)
$nodeVersion = (& $NodeExecutable --version).Trim()
if ($LASTEXITCODE -ne 0 -or ([version]$nodeVersion.TrimStart('v')).Major -lt 22) { throw 'Node.js 22 or newer is required.' }
if (Inside $Workspace $NodeExecutable) { throw 'Node must be outside the workspace.' }
if ($Soffice) {
    $Soffice = [IO.Path]::GetFullPath($Soffice)
    if (-not (Test-Path -LiteralPath $Soffice -PathType Leaf) -or (Inside $Workspace $Soffice)) { throw 'Select an installed LibreOffice executable outside the workspace.' }
}
& $NodeExecutable (Join-Path $sourceRoot 'tools\verify-source.mjs') $sourceRoot
if ($LASTEXITCODE -ne 0) { throw 'Source payload verification failed; nothing installed.' }
$pythonBaseDirectory = $RuntimeDirectory + '-base'
$installTemp = $RuntimeDirectory + '-install-temp'
foreach ($auxiliary in @($pythonBaseDirectory, $installTemp)) {
    Assert-DirectPath $auxiliary
    if (Test-Path -LiteralPath $auxiliary) { throw 'Choose a new runtime path; its base/temp folders must also be new.' }
    foreach ($other in @($sourceRoot, $Prefix, $Workspace, $WheelsDirectory)) {
        if ((Inside $auxiliary $other) -or (Inside $other $auxiliary)) { throw 'Portable Python and installer temp must not overlap source, install, workspace or wheels.' }
    }
}
if ($BasePython -and -not [IO.Path]::IsPathRooted($BasePython)) { throw 'Use an absolute full CPython 3.12 executable path.' }
if (-not $BasePython) {
    if (-not $PythonArchive) { throw 'Provide an existing full CPython 3.12 executable or the pinned portable Python archive.' }
    Assert-DirectPath $pythonBaseDirectory
    if (Test-Path -LiteralPath $pythonBaseDirectory) { throw 'The portable Python destination already exists; choose a new runtime path.' }
    $pin = Get-Content -Raw -LiteralPath (Join-Path $sourceRoot 'tools\windows-runtime.json') | ConvertFrom-Json
    if ((Get-Item -LiteralPath $PythonArchive).Length -ne $pin.bytes -or (Get-FileHash -LiteralPath $PythonArchive -Algorithm SHA256).Hash -ne $pin.sha256) { throw 'Portable Python archive checksum mismatch; nothing installed.' }
    if (-not (Test-Path -LiteralPath (Join-Path ([Environment]::GetFolderPath('Windows')) 'System32\tar.exe') -PathType Leaf)) { throw 'Native Windows tar.exe is required for the portable Python archive.' }
}
New-PrivateFolder $Prefix
$runtimeParent = Split-Path -Parent $RuntimeDirectory
if (-not (Test-Path -LiteralPath $runtimeParent)) { New-PrivateFolder $runtimeParent }
Assert-DirectPath $runtimeParent
Assert-AccountAccess $runtimeParent $true
$manifest = Get-Content -Raw -LiteralPath (Join-Path $sourceRoot 'tools\source-hashes.json') | ConvertFrom-Json
$files = @($manifest.files | ForEach-Object { $_.path }) + @('tools/source-hashes.json')
foreach ($relative in $files) {
    $destination = Join-Path $Prefix $relative
    $parent = Split-Path -Parent $destination
    if (-not (Test-Path -LiteralPath $parent)) { [IO.Directory]::CreateDirectory($parent) | Out-Null }
    Copy-Item -LiteralPath (Join-Path $sourceRoot $relative) -Destination $destination
}
& $NodeExecutable (Join-Path $Prefix 'tools\verify-source.mjs') $Prefix
if ($LASTEXITCODE -ne 0) { throw 'Installed source payload verification failed; retain the new folder for review.' }
if (-not $BasePython) {
    New-PrivateFolder $pythonBaseDirectory
    & (Join-Path ([Environment]::GetFolderPath('Windows')) 'System32\tar.exe') -xf $PythonArchive -C $pythonBaseDirectory
    if ($LASTEXITCODE -ne 0) { throw 'Portable Python extraction failed; retain the new folders for review.' }
    $BasePython = Join-Path $pythonBaseDirectory $pin.entry
}
$BasePython = [IO.Path]::GetFullPath($BasePython)
if (Inside $Workspace $BasePython) { throw 'Python must be outside the workspace.' }
$previousTemp = $env:TEMP
$previousTmp = $env:TMP
try {
    $env:TEMP = $installTemp
    New-PrivateFolder $installTemp
    $env:TMP = $env:TEMP
    $pip = Get-Content -Raw -LiteralPath (Join-Path $Prefix 'tools\pip-bootstrap.json') | ConvertFrom-Json
    & $BasePython -I -B (Join-Path $Prefix 'tools\setup-runtime.py') --runtime $RuntimeDirectory --wheels $WheelsDirectory --pip-wheel (Join-Path $WheelsDirectory $pip.filename)
    if ($LASTEXITCODE -ne 0) { throw 'Offline runtime setup failed; retain the install folders and choose a new runtime path for another attempt.' }
} finally { $env:TEMP = $previousTemp; $env:TMP = $previousTmp }
# The install temp is kept outside the immutable payload for later inspection.
$python = Join-Path $RuntimeDirectory 'Scripts\python.exe'
Assert-DirectPath $RuntimeDirectory
Assert-AccountAccess $RuntimeDirectory $true
$config = [ordered]@{mcpServers=[ordered]@{slides=[ordered]@{command=$NodeExecutable;args=@((Join-Path $Prefix 'slides-mcp.js'));env=[ordered]@{SLIDES_PLUGIN_MODE='1';SUITE_PYTHON=$python;SLIDES_WORKSPACE=$Workspace;SUITE_PORT='4599';SLIDES_RENDERER='libreoffice';SLIDES_SOFFICE=$Soffice}}}}
Write-Output 'Offline runtime prepared. Copy this entry into your chosen MCP host; no host settings were changed:'
$config | ConvertTo-Json -Depth 8
if (-not $Soffice) { Write-Output 'PDF/PNG require LibreOffice. Configure its absolute soffice.com/soffice.exe path before renderer qualification.' }
