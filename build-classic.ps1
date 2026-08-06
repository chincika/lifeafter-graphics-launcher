$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $csc)) {
    $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
if (-not (Test-Path -LiteralPath $csc)) {
    throw 'The .NET Framework C# compiler was not found.'
}

$patchDirectory = 'fps-unlock-integration\patches'
$patchNames = @(
    'patch_original.bin',
    'patch_180.bin',
    'patch_240.bin',
    'patch_300.bin',
    'patch_20260806_original.bin',
    'patch_20260806_180.bin',
    'patch_20260806_240.bin',
    'patch_20260806_300.bin'
)

$outputName = [Text.Encoding]::UTF8.GetString(
    [Convert]::FromBase64String('5piO5pel5LmL5ZCO55S76LSo5ZCv5Yqo5ZmoLmV4ZQ=='))
$output = Join-Path $root $outputName
Push-Location $root
try {
    $arguments = @(
        '/nologo',
        '/target:winexe',
        '/platform:anycpu',
        '/optimize+',
        '/codepage:65001',
        "/out:$outputName",
        '/win32icon:assets\app.ico',
        '/resource:assets\cover.png,cover.png',
        '/reference:System.Windows.Forms.dll',
        '/reference:System.Drawing.dll'
    )

    foreach ($name in $patchNames) {
        $path = Join-Path $patchDirectory $name
        if (-not (Test-Path -LiteralPath $path)) {
            throw "Missing patch resource: $path"
        }
        $arguments += "/resource:$path,fps-patches/$name"
    }
    $arguments += 'LifeAfterPresetLauncher.cs'

    & $csc @arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Classic build failed with exit code $LASTEXITCODE"
    }
}
finally {
    Pop-Location
}

Write-Host "Classic launcher generated: $output"
Get-Item -LiteralPath $output | Select-Object FullName,Length
Get-FileHash -Algorithm SHA256 -LiteralPath $output
