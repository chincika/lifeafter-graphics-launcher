param(
    [switch]$Clean
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$dist = Join-Path $projectRoot 'dist'
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $csc)) {
    $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
if (-not (Test-Path -LiteralPath $csc)) {
    throw '未找到 .NET Framework C# 编译器。'
}

if ($Clean -and (Test-Path -LiteralPath $dist)) {
    $resolvedProject = [IO.Path]::GetFullPath($projectRoot)
    $resolvedDist = [IO.Path]::GetFullPath($dist)
    if (-not $resolvedDist.StartsWith($resolvedProject + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "拒绝清理项目目录之外的路径：$resolvedDist"
    }
    Remove-Item -LiteralPath $dist -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $dist,(Join-Path $dist 'patches') | Out-Null

$source = Join-Path $projectRoot 'FpsSlotLab.cs'
$output = Join-Path $dist 'FPS-Slot-Lab.exe'
$manifest = Join-Path $projectRoot 'app.manifest'

& $csc /nologo /target:winexe /platform:anycpu /optimize+ `
    /out:$output `
    /win32manifest:$manifest `
    /reference:System.dll `
    /reference:System.Core.dll `
    /reference:System.Drawing.dll `
    /reference:System.Security.dll `
    /reference:System.Windows.Forms.dll `
    $source

if ($LASTEXITCODE -ne 0) {
    throw "C# 编译失败，退出码：$LASTEXITCODE"
}

$requiredPatches = @(
    'patch_120.bin',
    'patch_260.bin',
    'patch_280.bin',
    'patch_300.bin',
    'patch_360.bin'
)
foreach ($patch in $requiredPatches) {
    $sourcePatch = Join-Path (Join-Path $projectRoot 'patches') $patch
    if (-not (Test-Path -LiteralPath $sourcePatch)) {
        throw "缺少补丁：$sourcePatch"
    }
    Copy-Item -LiteralPath $sourcePatch -Destination (Join-Path $dist 'patches') -Force
}

Copy-Item -LiteralPath (Join-Path $projectRoot 'README.md') -Destination $dist -Force

$hashLines = Get-ChildItem -LiteralPath $dist -Recurse -File |
    Where-Object { $_.Name -ne 'SHA256SUMS.txt' } |
    Sort-Object FullName |
    ForEach-Object {
        $relative = $_.FullName.Substring($dist.Length + 1)
        '{0} *{1}' -f (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash, $relative
    }
$hashLines | Set-Content -LiteralPath (Join-Path $dist 'SHA256SUMS.txt') -Encoding ASCII

Write-Host "构建完成：$output"
Get-Item -LiteralPath $output | Select-Object FullName,Length
Get-FileHash -LiteralPath $output -Algorithm SHA256

