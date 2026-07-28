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
    throw 'The .NET Framework C# compiler was not found.'
}

if ($Clean -and (Test-Path -LiteralPath $dist)) {
    $resolvedProject = [IO.Path]::GetFullPath($projectRoot)
    $resolvedDist = [IO.Path]::GetFullPath($dist)
    if (-not $resolvedDist.StartsWith(
        $resolvedProject + [IO.Path]::DirectorySeparatorChar,
        [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to clean a path outside the project: $resolvedDist"
    }
    Remove-Item -LiteralPath $resolvedDist -Recurse -Force
}

& python (Join-Path $projectRoot 'build_patches.py')
if ($LASTEXITCODE -ne 0) {
    throw "Patch generation failed with exit code $LASTEXITCODE"
}

New-Item -ItemType Directory -Force -Path $dist,(Join-Path $dist 'patches') | Out-Null
$output = Join-Path $dist 'LifeAfter-FPS-Unlock-180-240.exe'
$manifest = Join-Path $projectRoot 'app.manifest'

& $csc /nologo /target:exe /platform:anycpu /optimize+ /codepage:65001 `
    /out:$output `
    /win32manifest:$manifest `
    /reference:System.dll `
    /reference:System.Core.dll `
    /reference:System.Security.dll `
    (Join-Path $projectRoot 'FpsUnlocker.cs')

if ($LASTEXITCODE -ne 0) {
    throw "C# compilation failed with exit code $LASTEXITCODE"
}

foreach ($patch in @('patch_original.bin', 'patch_180.bin', 'patch_240.bin')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot "patches\$patch") `
        -Destination (Join-Path $dist "patches\$patch") -Force
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'README.md') -Destination $dist -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'PATCH-ANALYSIS.zh-CN.md') -Destination $dist -Force

$hashLines = Get-ChildItem -LiteralPath $dist -Recurse -File |
    Where-Object { $_.Name -ne 'SHA256SUMS.txt' } |
    Sort-Object FullName |
    ForEach-Object {
        $relative = $_.FullName.Substring($dist.Length + 1)
        '{0} *{1}' -f (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash, $relative
    }
$hashLines | Set-Content -LiteralPath (Join-Path $dist 'SHA256SUMS.txt') -Encoding ASCII

Write-Host "Build complete: $output"
Get-Item -LiteralPath $output | Select-Object FullName,Length
Get-FileHash -LiteralPath $output -Algorithm SHA256
