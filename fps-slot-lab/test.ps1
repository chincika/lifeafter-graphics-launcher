$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$testBin = Join-Path $projectRoot 'test-bin'
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $csc)) {
    $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
if (-not (Test-Path -LiteralPath $csc)) {
    throw 'C# compiler was not found.'
}

New-Item -ItemType Directory -Force -Path $testBin,(Join-Path $testBin 'patches') | Out-Null
Get-ChildItem -LiteralPath (Join-Path $projectRoot 'patches') -Filter '*.bin' -File |
    Copy-Item -Destination (Join-Path $testBin 'patches') -Force

$output = Join-Path $testBin 'FpsSlotLab.Tests.exe'
$env:FPS_SLOT_LAB_UI_SNAPSHOT = Join-Path $projectRoot 'test-artifacts\ui-snapshot.png'
& $csc /nologo /target:exe /platform:anycpu /optimize+ `
    /main:FpsSlotLabTests `
    /out:$output `
    /reference:System.dll `
    /reference:System.Core.dll `
    /reference:System.Drawing.dll `
    /reference:System.Security.dll `
    /reference:System.Windows.Forms.dll `
    (Join-Path $projectRoot 'FpsSlotLab.cs') `
    (Join-Path $projectRoot 'FpsSlotLab.Tests.cs')
if ($LASTEXITCODE -ne 0) {
    throw "Test compilation failed with exit code $LASTEXITCODE"
}

& $output
$env:FPS_SLOT_LAB_UI_SNAPSHOT = $null
if ($LASTEXITCODE -ne 0) {
    throw "Tests failed with exit code $LASTEXITCODE"
}
