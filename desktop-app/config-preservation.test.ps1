$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$backendSource = Join-Path $PSScriptRoot 'backend\LifeAfterBackend.exe'
$qualityReference = Join-Path $repoRoot 'config-reference\20260810-old-pc-user-tuned\qualityconfig.json'

if (-not (Test-Path -LiteralPath $backendSource)) {
    throw "Backend not found: $backendSource"
}
if (-not (Test-Path -LiteralPath $qualityReference)) {
    throw "Quality reference not found: $qualityReference"
}

function Read-Json([string]$Path) {
    return (Get-Content -LiteralPath $Path -Raw -Encoding UTF8) | ConvertFrom-Json
}

function Get-PropertyNames($Value) {
    return @($Value.PSObject.Properties.Name)
}

function Assert-Equal([string]$Label, $Expected, $Actual) {
    $expectedJson = $Expected | ConvertTo-Json -Compress -Depth 30
    $actualJson = $Actual | ConvertTo-Json -Compress -Depth 30
    if ($expectedJson -ne $actualJson) {
        throw "$Label mismatch: expected $expectedJson, got $actualJson"
    }
}

function Assert-Preserved($Original, $Actual, [string[]]$ManagedKeys, [string]$Label) {
    $originalKeys = Get-PropertyNames $Original
    $actualKeys = Get-PropertyNames $Actual
    Assert-Equal "$Label schema" ($originalKeys | Sort-Object) ($actualKeys | Sort-Object)
    foreach ($key in $originalKeys) {
        if ($key -notin $ManagedKeys) {
            Assert-Equal "$Label.$key" $Original.$key $Actual.$key
        }
    }
}

$testBase = Join-Path ([System.IO.Path]::GetTempPath()) ("lifeafter-config-preservation-" + [Guid]::NewGuid().ToString('N'))
$runtimeDir = Join-Path $testBase 'runtime'
$gameRoot = Join-Path $testBase 'LifeAfter'
$configDir = Join-Path $gameRoot 'Documents\configs'
$testBackend = Join-Path $runtimeDir 'LifeAfterBackend.exe'
$pcPath = Join-Path $configDir 'pcconfig'
$qualityPath = Join-Path $configDir 'qualityconfig'

try {
    New-Item -ItemType Directory -Path $runtimeDir, $configDir -Force | Out-Null
    Copy-Item -LiteralPath $backendSource -Destination $testBackend -Force
    New-Item -ItemType File -Path (Join-Path $gameRoot 'lifeafter.exe') -Force | Out-Null

    $pcFixture = @'
{"resolution":[2560,1440],"full_screen":false,"vsync":0,"keymap":{"MOVE_RUN":[87,1],"OPEN_FASHION":[81,1]},"half_infected_keymap":{"HANDBRAKE":[0,0],"DRONE_CAST_SKILL":[88,0]},"future_pc_setting":{"mode":"system-default"}}
'@
    $qualityFixture = (Get-Content -LiteralPath $qualityReference -Raw -Encoding UTF8).Trim()
    $qualityFixture = $qualityFixture.Substring(0, $qualityFixture.Length - 1) + ',"future_graphics_setting":{"enabled":true,"level":7}}'
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($pcPath, $pcFixture.Trim(), $utf8NoBom)
    [System.IO.File]::WriteAllText($qualityPath, $qualityFixture, $utf8NoBom)

    $originalPc = Read-Json $pcPath
    $originalQuality = Read-Json $qualityPath

    & $testBackend --set-root $gameRoot | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to set test game root. Exit code: $LASTEXITCODE"
    }

    $cases = @(
        @{ Preset = '2K 120'; Width = 2560; Height = 1440; Frame = 4 },
        @{ Preset = '540p 25'; Width = 960; Height = 540; Frame = 0 },
        @{ Preset = '540p 60'; Width = 960; Height = 540; Frame = 2 },
        @{ Preset = '900p 60'; Width = 1600; Height = 900; Frame = 2 }
    )

    foreach ($case in $cases) {
        & $testBackend --apply $case.Preset | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "Apply failed for $($case.Preset). Exit code: $LASTEXITCODE"
        }

        $actualPc = Read-Json $pcPath
        $actualQuality = Read-Json $qualityPath
        Assert-Preserved $originalPc $actualPc @('resolution') "pcconfig after $($case.Preset)"
        Assert-Preserved $originalQuality $actualQuality @('frame') "qualityconfig after $($case.Preset)"
        Assert-Equal "$($case.Preset) resolution" @($case.Width, $case.Height) $actualPc.resolution
        Assert-Equal "$($case.Preset) frame" $case.Frame $actualQuality.frame
    }

    $summary = (& $testBackend --read-summary) -join "`n"
    if ($summary -notmatch '900p 60') {
        throw "Preset detection did not use resolution/frame-only semantics: $summary"
    }

    Write-Host 'Config preservation regression test: PASS'
}
finally {
    if (Test-Path -LiteralPath $testBase) {
        $resolvedBase = [System.IO.Path]::GetFullPath($testBase)
        $resolvedTemp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
        if (-not $resolvedBase.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase) -or
            $resolvedBase -eq $resolvedTemp) {
            throw "Refusing to remove unsafe test path: $resolvedBase"
        }
        Remove-Item -LiteralPath $resolvedBase -Recurse -Force
    }
}
