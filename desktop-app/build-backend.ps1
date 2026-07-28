$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $csc)) {
    $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
if (-not (Test-Path -LiteralPath $csc)) {
    throw 'The .NET Framework C# compiler was not found.'
}

$output = Join-Path $PSScriptRoot 'backend\LifeAfterBackend.exe'
& $csc /nologo /target:exe /platform:anycpu /optimize+ /codepage:65001 `
    /out:$output `
    /reference:System.Windows.Forms.dll `
    /reference:System.Drawing.dll `
    (Join-Path $root 'LifeAfterPresetLauncher.cs')
if ($LASTEXITCODE -ne 0) {
    throw "Backend compilation failed with exit code $LASTEXITCODE"
}

Write-Host "Backend generated: $output"
