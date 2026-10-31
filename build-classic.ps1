param([string]$OutputPath)

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
    'patch_20260806_300.bin',
    'patch_20260822_original.bin',
    'patch_20260822_180.bin',
    'patch_20260822_240.bin',
    'patch_20260822_300.bin'
)
$lz4Directory = 'third-party\lz4\net462'
$lz4Names = @(
    'K4os.Compression.LZ4.dll',
    'System.Buffers.dll',
    'System.Memory.dll',
    'System.Numerics.Vectors.dll',
    'System.Runtime.CompilerServices.Unsafe.dll'
)

$outputName = [Text.Encoding]::UTF8.GetString(
    [Convert]::FromBase64String('5piO5pel5LmL5ZCO55S76LSo5ZCv5Yqo5ZmoLmV4ZQ=='))
$output = if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    Join-Path $root $outputName
} else {
    [IO.Path]::GetFullPath($OutputPath)
}
Push-Location $root
try {
    $arguments = @(
        '/nologo',
        '/target:winexe',
        '/platform:anycpu',
        '/optimize+',
        '/codepage:65001',
        "/out:$output",
        '/win32icon:assets\app.ico',
        '/resource:assets\cover.png,cover.png',
        "/reference:$lz4Directory\K4os.Compression.LZ4.dll",
        '/reference:System.Windows.Forms.dll',
        '/reference:System.Drawing.dll',
        '/reference:System.Web.Extensions.dll'
    )

    foreach ($name in $patchNames) {
        $path = Join-Path $patchDirectory $name
        if (-not (Test-Path -LiteralPath $path)) {
            throw "Missing patch resource: $path"
        }
        $arguments += "/resource:$path,fps-patches/$name"
    }
    foreach ($name in $lz4Names) {
        $path = Join-Path $lz4Directory $name
        if (-not (Test-Path -LiteralPath $path)) {
            throw "Missing LZ4 runtime dependency: $path"
        }
        $arguments += "/resource:$path,fps-dependencies/$name"
    }
    foreach ($name in @('panel.original.bin', 'panel.v04.bin', 'manager.original.bin', 'manager.v04.bin')) {
        $path = Join-Path 'native-fps-integration\patches' $name
        if (-not (Test-Path -LiteralPath $path)) { throw "Missing native FPS resource: $path" }
        $arguments += "/resource:$path,$name"
    }
    $arguments += '/resource:native-fps-integration\adaptive-contract.json,adaptive-contract.json'
    $arguments += 'LifeAfterPresetLauncher.cs'
    $arguments += 'native-fps-integration\NativeFpsTool.cs'
    $arguments += 'native-fps-integration\NativeFpsAdaptive.cs'

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
