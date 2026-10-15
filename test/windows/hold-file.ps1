param([Parameter(Mandatory=$true)][string]$Path)
$ErrorActionPreference='Stop'
$stream=[IO.File]::Open($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
try{[Console]::WriteLine('OWNED_SHARING_HOLD_READY');[Console]::Out.Flush();$null=[Console]::In.ReadLine()}finally{$stream.Dispose()}
