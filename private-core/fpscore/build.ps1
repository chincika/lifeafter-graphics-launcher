$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$toolsRoot = 'C:\Users\Admin\Documents\lifeafter-private-build-tools'
$goExe = Join-Path $toolsRoot 'go\bin\go.exe'
$garbleExe = Join-Path $toolsRoot 'bin\garble.exe'

if (-not (Test-Path -LiteralPath $goExe)) {
    throw "Portable Go toolchain not found: $goExe"
}
if (-not (Test-Path -LiteralPath $garbleExe)) {
    throw "Garble not found: $garbleExe"
}

node (Join-Path $PSScriptRoot 'encode-assets.js')

$env:GOROOT = Join-Path $toolsRoot 'go'
$env:GOTOOLDIR = Join-Path $env:GOROOT 'pkg\tool\windows_amd64'
$env:PATH = (Join-Path $env:GOROOT 'bin') + ';' + (Join-Path $toolsRoot 'bin') + ';' + $env:PATH
$env:GOOS = 'windows'
$env:GOARCH = 'amd64'
$env:CGO_ENABLED = '0'

Push-Location $PSScriptRoot
try {
    & $goExe test ./...
    if ($LASTEXITCODE -ne 0) { throw "Frame core tests failed." }

    $output = Join-Path $repoRoot 'desktop-app\backend\LifeAfterFrameCore.exe'
    & $garbleExe -literals -tiny -seed=random build -trimpath `
        -ldflags '-s -w -buildid=' -o $output .
    if ($LASTEXITCODE -ne 0) { throw "Garble build failed." }
    if (-not (Test-Path -LiteralPath $output)) { throw "Frame core was not produced." }
    $integrityPath = Join-Path $repoRoot 'desktop-app\frame-core-integrity.json'
    @{
        sha256 = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash
    } | ConvertTo-Json | Set-Content -LiteralPath $integrityPath -Encoding utf8
    Write-Host "Built hardened frame core: $output"
}
finally {
    Pop-Location
}
