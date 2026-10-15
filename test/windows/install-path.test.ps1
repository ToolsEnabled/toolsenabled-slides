$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '..\..\install.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Installer does not parse'}
$definition=$ast.Find({param($part)$part -is [Management.Automation.Language.FunctionDefinitionAst] -and $part.Name -eq 'Assert-PlainLocalInput'},$true)
Invoke-Expression $definition.Extent.Text
$count=0
foreach($path in @('C:\Users\normal user\data','D:/Unicode résumé/notes','C:\')){Assert-PlainLocalInput $path;$count++}
foreach($path in @('C:relative','\root-relative','\\server\share\data','\\?\C:\data','C:\safe\..\other','C:\safe\.\other','C:\safe.\child','C:\safe \child','C:\data:stream','C:\NUL.txt','C:\COM1\child','C:\bad?\child',('C:\bad'+[char]1+'\child'))){
 $refused=$false;try{Assert-PlainLocalInput $path}catch{$refused=$true}
 if(-not $refused){throw ('Unsafe raw spelling accepted: '+$path)};$count++
}
Write-Output ('RAW_WINDOWS_PATH_CASES_PASS '+$count)
