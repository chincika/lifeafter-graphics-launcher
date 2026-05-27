param(
    [string]$Profile,
    [int]$Width,
    [int]$Height,
    [string]$FullScreen,
    [Nullable[int]]$Frame,
    [Nullable[int]]$QualityLevel,
    [Nullable[int]]$Render,
    [Nullable[int]]$Render2020,
    [Nullable[int]]$Shadow,
    [Nullable[int]]$Plant,
    [Nullable[int]]$Light,
    [Nullable[int]]$LightingRendering,
    [Nullable[int]]$VolumetricCloud,
    [Nullable[int]]$AmbientOcclusion,
    [Nullable[int]]$AnisotropicFilter,
    [Nullable[int]]$AntiAliasPc,
    [Nullable[int]]$SurfaceReflection,
    [Nullable[int]]$GlobalIllumination,
    [Nullable[int]]$SceneSfx,
    [Nullable[int]]$MainPlayerSfx,
    [Nullable[int]]$OtherPlayerSfx,
    [string[]]$Set,
    [switch]$Interactive,
    [switch]$ListProfiles,
    [switch]$ShowCurrent,
    [switch]$NoLaunch,
    [int]$DelaySeconds = 8
)

$ErrorActionPreference = "Stop"

$GameRoot = "D:\Program Files (x86)\LifeAfter"
$ConfigDir = Join-Path $GameRoot "Documents\configs"
$PcConfigPath = Join-Path $ConfigDir "pcconfig"
$QualityConfigPath = Join-Path $ConfigDir "qualityconfig"
$GameExe = Join-Path $GameRoot "lifeafter.exe"

$Profiles = [ordered]@{
    "2k-120" = @{
        Description = "2560x1440 window, frame mode 4, your common high preset"
        Pc = @{ resolution = @(2560, 1440); full_screen = $false }
        Quality = @{
            quality = -1; last_quality_level = 4; render = 4; render_2020 = 2
            light = 1; shadow = 1; plant = 1; frame = 4; frame_prediction = 1
            dynamic_shadow = $false; transparent_shadow = $true; lighting_rendering = 1
            scene_sfx_performance = 2; main_player_sfx_performance = 1; other_player_sfx_performance = 2
            volumetric_cloud = 3; ambient_occlusion = 0; surface_reflection = 0
            anisotropic_filter = 2; global_illumination = 1; anti_alias_pc = 1
            z_far = 1.0; player_num = 0.9; enemy_limit_num = 35; friend_limit_num = 20
        }
    }
    "960" = @{
        Description = "960x540 window, frame mode 0, your common 960 preset"
        Pc = @{ resolution = @(960, 540); full_screen = $false }
        Quality = @{
            quality = -1; last_quality_level = 4; render = 0; render_2020 = 2
            light = 0; shadow = 0; plant = 0; frame = 0; frame_prediction = 0
            dynamic_shadow = $false; transparent_shadow = $false; lighting_rendering = 1
            scene_sfx_performance = 2; main_player_sfx_performance = 1; other_player_sfx_performance = 2
            volumetric_cloud = 3; ambient_occlusion = 0; surface_reflection = 0
            anisotropic_filter = 2; global_illumination = 1; anti_alias_pc = 1
            z_far = 1.0; player_num = 0.9; enemy_limit_num = 35; friend_limit_num = 20
        }
    }
    "960-frame3" = @{
        Description = "960x540 window, same as 960 preset but frame mode 3"
        Pc = @{ resolution = @(960, 540); full_screen = $false }
        Quality = @{
            quality = -1; last_quality_level = 4; render = 0; render_2020 = 2
            light = 0; shadow = 0; plant = 0; frame = 3; frame_prediction = 0
            dynamic_shadow = $false; transparent_shadow = $false; lighting_rendering = 1
            scene_sfx_performance = 2; main_player_sfx_performance = 1
            other_player_sfx_performance = 2; volumetric_cloud = 3; ambient_occlusion = 0
            surface_reflection = 0; anisotropic_filter = 2; global_illumination = 1; anti_alias_pc = 1
            z_far = 1.0; player_num = 0.9; enemy_limit_num = 35; friend_limit_num = 20
        }
    }
}

$FieldHelp = [ordered]@{
    frame = "Frame-rate mode. Values are game-specific; 0 is the current known default."
    last_quality_level = "Overall quality level seen in game config."
    quality = "Preset marker. Use -1 for custom, 0 for low profile."
    render = "Render quality toggle/level."
    render_2020 = "New renderer/render precision level."
    light = "Lighting quality."
    shadow = "Shadow quality."
    plant = "Vegetation quality."
    lighting_rendering = "Lighting render path/detail."
    volumetric_cloud = "Volumetric cloud level."
    ambient_occlusion = "Ambient occlusion."
    anisotropic_filter = "Texture anisotropic filtering."
    anti_alias_pc = "Anti-aliasing."
    surface_reflection = "Surface reflection."
    global_illumination = "Global illumination."
    scene_sfx_performance = "Scene effect quality/performance."
    main_player_sfx_performance = "Main player effect quality/performance."
    other_player_sfx_performance = "Other players effect quality/performance."
    z_far = "Far view distance scale."
    player_num = "Player display density/scale."
}

function Show-Profiles {
    Write-Host ""
    Write-Host "Available LifeAfter profiles:"
    $i = 1
    foreach ($name in $Profiles.Keys) {
        Write-Host ("  {0}. {1,-18} {2}" -f $i, $name, $Profiles[$name].Description)
        $i++
    }
    Write-Host ""
}

function Read-JsonObject($Path) {
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Missing config file: $Path"
    }
    return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function Set-JsonProperty($Object, [string]$Name, $Value) {
    if ($Object.PSObject.Properties.Name -contains $Name) {
        $Object.$Name = $Value
    }
    else {
        $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value
    }
}

function Write-JsonObject($Path, $Object) {
    $json = $Object | ConvertTo-Json -Compress -Depth 20
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $json, $utf8NoBom)
}

function Backup-Config($Path) {
    $backupDir = Join-Path $ConfigDir "profile_backups"
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $backupPath = Join-Path $backupDir ("{0}.{1}.bak" -f (Split-Path $Path -Leaf), $stamp)
    Copy-Item -LiteralPath $Path -Destination $backupPath -Force
    return $backupPath
}

function Convert-TextValue([string]$Value) {
    if ($Value -match '^(?i:true|false)$') {
        return [bool]::Parse($Value)
    }
    if ($Value -match '^-?\d+$') {
        return [int]$Value
    }
    if ($Value -match '^-?\d+\.\d+$') {
        return [decimal]$Value
    }
    if ($Value -match '^\d+x\d+$') {
        $parts = $Value -split 'x'
        return @([int]$parts[0], [int]$parts[1])
    }
    return $Value
}

function Convert-FrameValue([string]$Value) {
    $text = $Value.Trim()
    if ($text -match '^(\d+)\s*[-:]\s*') {
        return [int]$Matches[1]
    }
    switch -Regex ($text) {
        '(?i)^25\s*(fps)?$' { return 0 }
        '(?i)^120\s*(fps)?$' { return 4 }
        '^-?\d+$' { return [int]$text }
        default { throw "Frame must be an internal mode number. Known mappings: 25 FPS = 0, 120 FPS = 4." }
    }
}

function Read-Choice($Prompt, $Default, [string[]]$Choices) {
    Write-Host ""
    Write-Host $Prompt
    for ($i = 0; $i -lt $Choices.Count; $i++) {
        Write-Host ("  {0}. {1}" -f ($i + 1), $Choices[$i])
    }
    $answer = Read-Host ("Choose number or press Enter for {0}" -f $Default)
    if ([string]::IsNullOrWhiteSpace($answer)) {
        return $Default
    }
    if ($answer -match '^\d+$') {
        $index = [int]$answer - 1
        if ($index -ge 0 -and $index -lt $Choices.Count) {
            return $Choices[$index]
        }
    }
    return $answer
}

function Read-OptionalValue($Prompt, $Default) {
    $answer = Read-Host ("{0} [{1}]" -f $Prompt, $Default)
    if ([string]::IsNullOrWhiteSpace($answer)) {
        return $Default
    }
    return $answer
}

function Add-IfSet($Table, [string]$Name, $Value) {
    if ($null -ne $Value) {
        $Table[$Name] = $Value
    }
}

function Show-CurrentConfig($Pc, $Quality) {
    Write-Host ""
    Write-Host "Current pcconfig:"
    Write-Host ("  resolution: {0}x{1}" -f $Pc.resolution[0], $Pc.resolution[1])
    Write-Host ("  full_screen: {0}" -f $Pc.full_screen)
    Write-Host ""
    Write-Host "Current qualityconfig highlights:"
    foreach ($name in $FieldHelp.Keys) {
        if ($Quality.PSObject.Properties.Name -contains $name) {
            Write-Host ("  {0,-32} {1}" -f $name, $Quality.$name)
        }
    }
    Write-Host ""
}

function Select-ProfileFromInput {
    Show-Profiles
    $choice = Read-Host "Type profile name or number"
    if ($choice -match '^\d+$') {
        $index = [int]$choice - 1
        $keys = @($Profiles.Keys)
        if ($index -lt 0 -or $index -ge $keys.Count) {
            throw "Invalid profile number: $choice"
        }
        return $keys[$index]
    }
    return $choice
}

if ($ListProfiles) {
    Show-Profiles
    Write-Host "Common override examples:"
    Write-Host "  -Width 1600 -Height 900 -FullScreen `$false -Frame 1 -Render2020 2"
    Write-Host "  -Set shadow=0 -Set volumetric_cloud=0 -Set z_far=0.8"
    Write-Host ""
    Write-Host "Known advanced fields:"
    foreach ($name in $FieldHelp.Keys) {
        Write-Host ("  {0,-32} {1}" -f $name, $FieldHelp[$name])
    }
    exit 0
}

if (-not (Test-Path -LiteralPath $GameExe)) {
    throw "Missing game executable: $GameExe"
}

$pc = Read-JsonObject $PcConfigPath
$quality = Read-JsonObject $QualityConfigPath

if ($ShowCurrent) {
    Show-CurrentConfig $pc $quality
    if (-not $Profile -and -not $Interactive -and -not $Set -and $Width -le 0 -and $Height -le 0) {
        exit 0
    }
}

if (-not $Profile) {
    if ($Interactive) {
        $Profile = Select-ProfileFromInput
    }
    elseif (-not $Set -and $Width -le 0 -and $Height -le 0) {
        $Profile = Select-ProfileFromInput
    }
}

$pcOverrides = @{}
$qualityOverrides = @{}

if ($Profile) {
    if (-not $Profiles.Contains($Profile)) {
        Show-Profiles
        throw "Unknown profile: $Profile"
    }
    $selected = $Profiles[$Profile]
    foreach ($key in $selected.Pc.Keys) {
        $pcOverrides[$key] = $selected.Pc[$key]
    }
    foreach ($key in $selected.Quality.Keys) {
        $qualityOverrides[$key] = $selected.Quality[$key]
    }
}

if ($Interactive) {
    $resolutionChoice = Read-Choice "Resolution" ("{0}x{1}" -f $pc.resolution[0], $pc.resolution[1]) @("960x540", "1280x720", "1600x900", "1920x1080", "2560x1440")
    $pcOverrides["resolution"] = Convert-TextValue $resolutionChoice

    $fullscreenChoice = Read-Choice "Fullscreen" ([string]$pc.full_screen) @("false", "true")
    $pcOverrides["full_screen"] = Convert-TextValue $fullscreenChoice

    $qualityChoice = Read-Choice "Overall quality level" ([string]$quality.last_quality_level) @("1", "2", "3", "4", "5")
    $qualityOverrides["last_quality_level"] = Convert-TextValue $qualityChoice
    $qualityOverrides["quality"] = -1

    $frameChoice = Read-Choice "Frame mode" ([string]$quality.frame) @("0 - 25 FPS", "1 - internal mode", "2 - internal mode", "3 - internal mode", "4 - 120 FPS", "5 - internal mode")
    $qualityOverrides["frame"] = Convert-FrameValue $frameChoice

    $renderChoice = Read-Choice "Render precision / new renderer level" ([string]$quality.render_2020) @("0", "1", "2", "3")
    $qualityOverrides["render_2020"] = Convert-TextValue $renderChoice

    $shadowChoice = Read-Choice "Shadow quality" ([string]$quality.shadow) @("0", "1", "2", "3")
    $qualityOverrides["shadow"] = Convert-TextValue $shadowChoice

    $plantChoice = Read-Choice "Vegetation quality" ([string]$quality.plant) @("0", "1", "2", "3")
    $qualityOverrides["plant"] = Convert-TextValue $plantChoice

    $cloudChoice = Read-Choice "Volumetric cloud" ([string]$quality.volumetric_cloud) @("0", "1", "2", "3")
    $qualityOverrides["volumetric_cloud"] = Convert-TextValue $cloudChoice

    $aaChoice = Read-Choice "Anti-aliasing" ([string]$quality.anti_alias_pc) @("0", "1", "2")
    $qualityOverrides["anti_alias_pc"] = Convert-TextValue $aaChoice

    $advanced = Read-Host "Advanced overrides as key=value,key=value or press Enter"
    if (-not [string]::IsNullOrWhiteSpace($advanced)) {
        $Set += ($advanced -split ',')
    }
}

if ($Width -gt 0 -or $Height -gt 0) {
    if ($Width -le 0 -or $Height -le 0) {
        throw "Width and Height must be supplied together."
    }
    $pcOverrides["resolution"] = @($Width, $Height)
}

if (-not [string]::IsNullOrWhiteSpace($FullScreen)) {
    $pcOverrides["full_screen"] = Convert-TextValue $FullScreen
}

if ($null -ne $Frame) {
    $qualityOverrides["frame"] = Convert-FrameValue ([string]$Frame)
}
Add-IfSet $qualityOverrides "last_quality_level" $QualityLevel
Add-IfSet $qualityOverrides "render" $Render
Add-IfSet $qualityOverrides "render_2020" $Render2020
Add-IfSet $qualityOverrides "shadow" $Shadow
Add-IfSet $qualityOverrides "plant" $Plant
Add-IfSet $qualityOverrides "light" $Light
Add-IfSet $qualityOverrides "lighting_rendering" $LightingRendering
Add-IfSet $qualityOverrides "volumetric_cloud" $VolumetricCloud
Add-IfSet $qualityOverrides "ambient_occlusion" $AmbientOcclusion
Add-IfSet $qualityOverrides "anisotropic_filter" $AnisotropicFilter
Add-IfSet $qualityOverrides "anti_alias_pc" $AntiAliasPc
Add-IfSet $qualityOverrides "surface_reflection" $SurfaceReflection
Add-IfSet $qualityOverrides "global_illumination" $GlobalIllumination
Add-IfSet $qualityOverrides "scene_sfx_performance" $SceneSfx
Add-IfSet $qualityOverrides "main_player_sfx_performance" $MainPlayerSfx
Add-IfSet $qualityOverrides "other_player_sfx_performance" $OtherPlayerSfx

foreach ($rawItem in @($Set)) {
    foreach ($item in ([string]$rawItem -split ',')) {
    if ([string]::IsNullOrWhiteSpace($item)) { continue }
    if ($item -notmatch '^([^=]+)=(.*)$') {
        throw "Invalid -Set item '$item'. Use key=value."
    }
    $key = $Matches[1].Trim()
    $value = Convert-TextValue $Matches[2].Trim()
    if ($key -eq "resolution") {
        $pcOverrides[$key] = $value
    }
    elseif ($key -eq "full_screen") {
        $pcOverrides[$key] = $value
    }
    elseif ($quality.PSObject.Properties.Name -contains $key -or $FieldHelp.Contains($key)) {
        if ($key -eq "frame") {
            $qualityOverrides[$key] = Convert-FrameValue $Matches[2].Trim()
        }
        else {
            $qualityOverrides[$key] = $value
        }
    }
    else {
        throw "Unknown config field '$key'. Use -ListProfiles to see common fields."
    }
    }
}

if ($pcOverrides.Count -eq 0 -and $qualityOverrides.Count -eq 0) {
    throw "No profile or overrides selected."
}

foreach ($key in $pcOverrides.Keys) {
    Set-JsonProperty $pc $key $pcOverrides[$key]
}

foreach ($key in $qualityOverrides.Keys) {
    Set-JsonProperty $quality $key $qualityOverrides[$key]
}

$pcBackup = Backup-Config $PcConfigPath
$qualityBackup = Backup-Config $QualityConfigPath

Write-JsonObject $PcConfigPath $pc
Write-JsonObject $QualityConfigPath $quality

Write-Host ""
Write-Host ("Applied profile: {0}" -f $(if ($Profile) { $Profile } else { "custom" }))
Write-Host ("  pcconfig backup:      {0}" -f $pcBackup)
Write-Host ("  qualityconfig backup: {0}" -f $qualityBackup)
Write-Host ("  resolution:           {0}x{1}" -f $pc.resolution[0], $pc.resolution[1])
Write-Host ("  fullscreen:           {0}" -f $pc.full_screen)
Write-Host "  quality overrides:"
foreach ($key in ($qualityOverrides.Keys | Sort-Object)) {
    Write-Host ("    {0,-30} {1}" -f $key, $quality.$key)
}

if ($NoLaunch) {
    Write-Host "NoLaunch is set; game was not started."
    exit 0
}

Start-Process -FilePath $GameExe -WorkingDirectory $GameRoot
Write-Host ("Started: {0}" -f $GameExe)

if ($DelaySeconds -gt 0) {
    Write-Host ("Waiting {0} seconds before exit so the game can read config..." -f $DelaySeconds)
    Start-Sleep -Seconds $DelaySeconds
}
