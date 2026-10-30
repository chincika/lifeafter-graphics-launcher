$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $csc)) {
    $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
if (-not (Test-Path -LiteralPath $csc)) {
    throw 'The .NET Framework C# compiler was not found.'
}

$patchSource = Join-Path $root 'fps-unlock-integration\patches'
$patchTarget = Join-Path $PSScriptRoot 'backend\fps-patches'
New-Item -ItemType Directory -Force -Path $patchTarget | Out-Null
foreach ($name in @(
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
)) {
    $source = Join-Path $patchSource $name
    if (-not (Test-Path -LiteralPath $source)) {
        throw "Missing patch resource: $source"
    }
    Copy-Item -LiteralPath $source -Destination (Join-Path $patchTarget $name) -Force
}

$lz4Source = Join-Path $root 'third-party\lz4\net462'
$lz4Names = @(
    'K4os.Compression.LZ4.dll',
    'System.Buffers.dll',
    'System.Memory.dll',
    'System.Numerics.Vectors.dll',
    'System.Runtime.CompilerServices.Unsafe.dll'
)
foreach ($name in $lz4Names) {
    $source = Join-Path $lz4Source $name
    if (-not (Test-Path -LiteralPath $source)) {
        throw "Missing LZ4 runtime dependency: $source"
    }
    Copy-Item -LiteralPath $source -Destination (Join-Path $PSScriptRoot "backend\$name") -Force
}
$lz4Assembly = Join-Path $lz4Source 'K4os.Compression.LZ4.dll'

$output = Join-Path $PSScriptRoot 'backend\LifeAfterBackend.exe'
& $csc /nologo /target:exe /platform:anycpu /optimize+ /codepage:65001 `
    /out:$output `
    /reference:$lz4Assembly `
    /reference:System.Windows.Forms.dll `
    /reference:System.Drawing.dll `
    /reference:System.Web.Extensions.dll `
    "/resource:$(Join-Path $root 'native-fps-integration\patches\panel.original.bin'),panel.original.bin" `
    "/resource:$(Join-Path $root 'native-fps-integration\patches\panel.v04.bin'),panel.v04.bin" `
    "/resource:$(Join-Path $root 'native-fps-integration\patches\manager.original.bin'),manager.original.bin" `
    "/resource:$(Join-Path $root 'native-fps-integration\patches\manager.v04.bin'),manager.v04.bin" `
    (Join-Path $root 'LifeAfterPresetLauncher.cs') `
    (Join-Path $root 'native-fps-integration\NativeFpsTool.cs')
if ($LASTEXITCODE -ne 0) {
    throw "Backend compilation failed with exit code $LASTEXITCODE"
}

$manifestPath = Join-Path $PSScriptRoot 'runtime-assets-manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$backendEntry = @($manifest.assets | Where-Object { $_.name -eq 'LifeAfterBackend.exe' })
if ($backendEntry.Count -ne 1) { throw 'Backend asset manifest entry is missing or duplicated.' }
$backendEntry[0].sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $output).Hash
[IO.File]::WriteAllText($manifestPath, (($manifest | ConvertTo-Json -Depth 10) + "`n"), (New-Object Text.UTF8Encoding($false)))

Write-Host "Backend generated: $output"
