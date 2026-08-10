param(
    [ValidateSet("2K 120", "1080p 120", "540p", "540p 60")]
    [string]$ApplyPreset,
    [switch]$StartGame
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = "Stop"

function U([string]$Base64) {
    return [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($Base64))
}

$GameRoot = "D:\Program Files (x86)\LifeAfter"
$ConfigDir = Join-Path $GameRoot "Documents\configs"
$PcConfigPath = Join-Path $ConfigDir "pcconfig"
$QualityConfigPath = Join-Path $ConfigDir "qualityconfig"
$GameExe = Join-Path $GameRoot "lifeafter.exe"

$Pc540p = @'
{"resolution": [960, 540], "ignore_hint": true, "half_infected_keymap": {"HANDBRAKE": [0, 0], "DRONE_CAST_SKILL": [88, 0], "SPORE_SKILL": [74, 0], "TOGGLE_WEAPONS": [90, 0], "DRONE_CONTROL_SKILL_1": [0, 0], "AIR_UP": [0, 0], "WHISTLE": [0, 0], "WEAPON_SKILL": [81, 0], "OPEN_FASHION": [81, 1], "ARTIFACT_STUNT": [72, 0], "CHANGE_POS": [0, 0], "AIR_DOWN": [0, 0], "SPORE_USE": [16, 0], "FAST_COLD_WEAPON": [71, 0], "TOGGLE_MEDICINE": [66, 0], "MOVE_RUN": [87, 1], "SWITCH_WEAPON": [69, 0], "PLAYER_SKILL7": [-1, 0], "AUTO_MOVE": [0, 0], "NITROGEN": [0, 0], "SWITCH_THROWABLE": [188, 0]}, "hide_tag": false, "pc_tutorial_showed": true, "full_screen": false, "hint_occurred": 4, "hint_close_PanelBulletBox": true}
'@

$Quality540p = @'
{"jijian_engine": 1, "render_2020": 2, "player_num": 0.9, "enemy_limit_num": 35, "friend_limit_num": 20, "hidden_tatic_sfx": 0, "hidden_flamethrower_sfx": 0, "hidden_diffuser_sfx": 0, "bloom_enhance": 1, "render": 0, "last_quality_level": 4, "light": 0, "shadow": 0, "plant": 0, "frame": 0, "frame_prediction": 0, "dynamic_shadow": false, "preset_mode": -1, "shadow_distance_scale": 0.0, "transparent_shadow": false, "lighting_rendering": 1, "quality": -1, "contrast_enhancement": 1, "color_grading": 2, "home_render_budget": 1, "scene_sfx_performance": 2, "main_player_sfx_performance": 1, "other_player_sfx_performance": 2, "fsr_postprocess": 0, "hidden_specific_shrub": 0, "dynamic_hide_bobj": false, "same_appear_hint": 0, "hide_building": 0, "enable_low_fps_mode": 1, "plant_distance_scale": 0.0, "volumetric_cloud": 3, "ambient_occlusion": 0, "yingguang_sen": 1.0, "illum_auto_switch": 0, "blurred_distant_view": 0, "surface_reflection": 0, "z_far": 1.0, "anisotropic_filter": 2, "global_illumination": 1, "self_home_bobj_show_range": 100, "other_home_bobj_show_range": 30, "anti_alias_pc": 1, "dynamic_pvp_rule": 1, "long_shadow": 0, "shadow_distance": 0, "ocean_depth": 0, "monster_quality_upgrade_hit_sfx": 0}
'@

$Pc2K = $Pc540p -replace '"resolution": \[960, 540\]', '"resolution": [2560, 1440]'
$Pc1080p = $Pc540p -replace '"resolution": \[960, 540\]', '"resolution": [1920, 1080]'

$Quality2K120 = @'
{"jijian_engine": 1, "render_2020": 2, "player_num": 0.9, "enemy_limit_num": 35, "friend_limit_num": 20, "hidden_tatic_sfx": 0, "hidden_flamethrower_sfx": 0, "hidden_diffuser_sfx": 0, "bloom_enhance": 1, "render": 4, "last_quality_level": 4, "light": 1, "shadow": 1, "plant": 1, "frame": 4, "frame_prediction": 1, "dynamic_shadow": false, "preset_mode": -1, "shadow_distance_scale": 0.0, "transparent_shadow": true, "lighting_rendering": 1, "quality": -1, "contrast_enhancement": 1, "color_grading": 2, "home_render_budget": 1, "scene_sfx_performance": 2, "main_player_sfx_performance": 1, "other_player_sfx_performance": 2, "fsr_postprocess": 0, "hidden_specific_shrub": 0, "dynamic_hide_bobj": false, "same_appear_hint": 0, "hide_building": 0, "enable_low_fps_mode": 1, "plant_distance_scale": 0.0, "volumetric_cloud": 3, "ambient_occlusion": 0, "yingguang_sen": 1.0, "illum_auto_switch": 0, "blurred_distant_view": 0, "surface_reflection": 0, "z_far": 1.0, "anisotropic_filter": 2, "global_illumination": 1, "self_home_bobj_show_range": 100, "other_home_bobj_show_range": 30, "anti_alias_pc": 1, "dynamic_pvp_rule": 1, "long_shadow": 0, "shadow_distance": 0, "ocean_depth": 0, "monster_quality_upgrade_hit_sfx": 0}
'@

function Backup-Config($Path) {
    $backupDir = Join-Path $ConfigDir "profile_backups"
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $backupPath = Join-Path $backupDir ("{0}.{1}.bak" -f (Split-Path $Path -Leaf), $stamp)
    Copy-Item -LiteralPath $Path -Destination $backupPath -Force
    return $backupPath
}

function Write-TextNoBom($Path, [string]$Text) {
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Text.Trim(), $utf8NoBom)
}

function Set-RawNumber([string]$Json, [string]$Key, [int]$Value) {
    $pattern = [regex]::new(('"' + [regex]::Escape($Key) + '"\s*:\s*-?\d+(\.\d+)?'))
    if ($pattern.Matches($Json).Count -ne 1) {
        throw "JSON field $Key is missing or duplicated. Write cancelled."
    }
    return $pattern.Replace($Json, ('"' + $Key + '": ' + $Value), 1)
}

function Set-Resolution([string]$Json, [int]$Width, [int]$Height) {
    $pattern = [regex]::new('"resolution"\s*:\s*\[\s*\d+\s*,\s*\d+\s*\]')
    if ($pattern.Matches($Json).Count -ne 1) {
        throw "pcconfig resolution is missing or duplicated. Write cancelled."
    }
    return $pattern.Replace($Json, ('"resolution": [' + $Width + ', ' + $Height + ']'), 1)
}

function Merge-PresetWithCurrentConfig($Target) {
    $targetResolution = [regex]::Match($Target.Pc, '"resolution"\s*:\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]')
    $targetFrame = [regex]::Match($Target.Quality, '"frame"\s*:\s*(-?\d+)')
    if (-not $targetResolution.Success -or -not $targetFrame.Success) {
        throw "Preset resolution or frame is invalid."
    }

    $currentPc = [System.IO.File]::ReadAllText($PcConfigPath, [System.Text.Encoding]::UTF8)
    $currentQuality = [System.IO.File]::ReadAllText($QualityConfigPath, [System.Text.Encoding]::UTF8)
    return @{
        Pc = Set-Resolution $currentPc ([int]$targetResolution.Groups[1].Value) ([int]$targetResolution.Groups[2].Value)
        Quality = Set-RawNumber $currentQuality "frame" ([int]$targetFrame.Groups[1].Value)
    }
}

function Build-Preset([string]$Preset) {
    switch ($Preset) {
        "2K 120" { return @{ Pc = $Pc2K; Quality = $Quality2K120 } }
        "1080p 120" { return @{ Pc = $Pc1080p; Quality = $Quality2K120 } }
        "540p" { return @{ Pc = $Pc540p; Quality = $Quality540p } }
        "540p 60" {
            return @{
                Pc = $Pc540p
                Quality = Set-RawNumber $Quality540p "frame" 2
            }
        }
        default { throw ((U "5pyq55+l6aKE6K6+OiA=") + $Preset) }
    }
}

function Apply-Preset([string]$Preset, [bool]$Launch) {
    $built = Merge-PresetWithCurrentConfig (Build-Preset $Preset)
    $pcBackup = Backup-Config $PcConfigPath
    $qualityBackup = Backup-Config $QualityConfigPath
    Write-TextNoBom $PcConfigPath $built.Pc
    Write-TextNoBom $QualityConfigPath $built.Quality
    $message = (U "5bey5bqU55So6aKE6K6+77ya") + $Preset + "`r`n" + (U "5aSH5Lu95paH5Lu277ya") + "`r`n$pcBackup`r`n$qualityBackup`r`n" + (U "5LuF5L+u5pS55YiG6L6o546H5LiO5bin546H77yM5YW25LuW6YWN572u5bey5L+d55WZ44CC")
    if ($Launch) {
        Start-Process -FilePath $GameExe -WorkingDirectory $GameRoot
        $message += "`r`n" + (U "5ri45oiP5bey5ZCv5Yqo44CC")
    }
    if ($script:status) {
        $script:status.Text = $message
    }
    return $message
}

if ($ApplyPreset) {
    $message = Apply-Preset $ApplyPreset ([bool]$StartGame)
    Write-Host $message
    exit 0
}

[System.Windows.Forms.Application]::EnableVisualStyles()

$form = New-Object System.Windows.Forms.Form
$form.Text = U "5piO5pel5LmL5ZCO5a6J5YWo55S76LSo5ZCv5Yqo5Zmo"
$form.StartPosition = "CenterScreen"
$form.Size = New-Object System.Drawing.Size(520, 260)
$form.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 9)

$label = New-Object System.Windows.Forms.Label
$label.Text = U "5bqU55So6aKE6K6+5pe25LuF5L+u5pS55YiG6L6o546H5ZKM5bin546H77yM5L+d55WZ5ri45oiP5YaF55S76LSo44CB54m55pWI5ZKM5oyJ6ZSu6K6+572u44CC"
$label.AutoSize = $true
$label.Left = 16
$label.Top = 16
$form.Controls.Add($label)

$presetBox = New-Object System.Windows.Forms.ComboBox
$presetBox.DropDownStyle = [System.Windows.Forms.ComboBoxStyle]::DropDownList
[void]$presetBox.Items.Add("2K 120")
[void]$presetBox.Items.Add("1080p 120")
[void]$presetBox.Items.Add("540p")
[void]$presetBox.Items.Add("540p 60")
$presetBox.SelectedItem = "540p"
$presetBox.Left = 16
$presetBox.Top = 48
$presetBox.Width = 180
$form.Controls.Add($presetBox)

$apply = New-Object System.Windows.Forms.Button
$apply.Text = U "5bqU55So"
$apply.Left = 220
$apply.Top = 46
$apply.Width = 100
$apply.Add_Click({
    try { Apply-Preset $presetBox.SelectedItem $false }
    catch { [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, "Error") | Out-Null }
})
$form.Controls.Add($apply)

$launchButton = New-Object System.Windows.Forms.Button
$launchButton.Text = U "5bqU55So5bm25ZCv5Yqo"
$launchButton.Left = 330
$launchButton.Top = 46
$launchButton.Width = 130
$launchButton.Add_Click({
    try { Apply-Preset $presetBox.SelectedItem $true }
    catch { [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, "Error") | Out-Null }
})
$form.Controls.Add($launchButton)

$status = New-Object System.Windows.Forms.TextBox
$status.Multiline = $true
$status.ReadOnly = $true
$status.ScrollBars = "Vertical"
$status.Left = 16
$status.Top = 92
$status.Width = 470
$status.Height = 110
$status.Text = U "5bCx57uq44CC5Y+v6YCJ6aKE6K6+77yaMksgMTIw44CBMTA4MHAgMTIw44CBNTQwcOOAgTU0MHAgNjDjgII="
$form.Controls.Add($status)

[void]$form.ShowDialog()
