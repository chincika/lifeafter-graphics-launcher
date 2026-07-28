Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = "Stop"

$GameRoot = "D:\Program Files (x86)\LifeAfter"
$ConfigDir = Join-Path $GameRoot "Documents\configs"
$PcConfigPath = Join-Path $ConfigDir "pcconfig"
$QualityConfigPath = Join-Path $ConfigDir "qualityconfig"
$GameExe = Join-Path $GameRoot "lifeafter.exe"

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
    $json = $Object | ConvertTo-Json -Compress -Depth 30
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
    $text = $Value.Trim()
    if ($text -match '^(?i:true|false)$') { return [bool]::Parse($text) }
    if ($text -match '^-?\d+$') { return [int]$text }
    if ($text -match '^-?\d+\.\d+$') { return [decimal]$text }
    return $text
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

function Format-FrameValue($Value) {
    switch ([int]$Value) {
        0 { return "0 - 25 FPS" }
        3 { return "3 - internal mode" }
        4 { return "4 - 120 FPS" }
        default { return [string]$Value }
    }
}

function New-Combo($Items, $Text) {
    $combo = New-Object System.Windows.Forms.ComboBox
    $combo.DropDownStyle = [System.Windows.Forms.ComboBoxStyle]::DropDown
    $combo.Width = 170
    foreach ($item in $Items) { [void]$combo.Items.Add($item) }
    $combo.Text = [string]$Text
    return $combo
}

function New-Label($Text) {
    $label = New-Object System.Windows.Forms.Label
    $label.Text = $Text
    $label.AutoSize = $true
    $label.Margin = New-Object System.Windows.Forms.Padding(3, 8, 8, 3)
    return $label
}

function Add-Row($Table, [string]$LabelText, $Control) {
    $row = $Table.RowCount
    $Table.RowCount += 1
    $Table.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::AutoSize))) | Out-Null
    $Table.Controls.Add((New-Label $LabelText), 0, $row)
    $Table.Controls.Add($Control, 1, $row)
}

function Parse-Resolution($Text) {
    if ($Text -notmatch '^\s*(\d+)\s*x\s*(\d+)\s*$') {
        throw "Resolution must look like 2560x1440."
    }
    return @([int]$Matches[1], [int]$Matches[2])
}

function Set-ComboIfPresent($Combo, $Value) {
    $Combo.Text = [string]$Value
}

function Set-ControlValue([string]$Name, $Value) {
    if ($fieldControls.Contains($Name)) {
        if ($Name -eq "frame") {
            $fieldControls[$Name].Text = Format-FrameValue $Value
        }
        else {
            $fieldControls[$Name].Text = [string]$Value
        }
    }
}

function Set-Base960Preset([int]$FrameMode) {
    $resolutionBox.Text = "960x540"
    $fullscreenBox.Checked = $false
    Set-ControlValue "frame" $FrameMode
    Set-ControlValue "last_quality_level" 4
    Set-ControlValue "render" 0
    Set-ControlValue "render_2020" 2
    Set-ControlValue "frame_prediction" 0
    Set-ControlValue "light" 0
    Set-ControlValue "shadow" 0
    Set-ControlValue "plant" 0
    Set-ControlValue "dynamic_shadow" $false
    Set-ControlValue "transparent_shadow" $false
    Set-ControlValue "lighting_rendering" 1
    Set-ControlValue "scene_sfx_performance" 2
    Set-ControlValue "main_player_sfx_performance" 1
    Set-ControlValue "other_player_sfx_performance" 2
    Set-ControlValue "volumetric_cloud" 3
    Set-ControlValue "ambient_occlusion" 0
    Set-ControlValue "anisotropic_filter" 2
    Set-ControlValue "anti_alias_pc" 1
    Set-ControlValue "surface_reflection" 0
    Set-ControlValue "global_illumination" 1
    Set-ControlValue "z_far" 1.0
    Set-ControlValue "player_num" 0.9
    Set-ControlValue "enemy_limit_num" 35
    Set-ControlValue "friend_limit_num" 20
    $statusBox.Text = "Loaded preset: 960x540, frame mode $FrameMode. Click Apply or Apply && Launch."
}

function Set-Base2K120Preset {
    $resolutionBox.Text = "2560x1440"
    $fullscreenBox.Checked = $false
    Set-ControlValue "frame" 4
    Set-ControlValue "last_quality_level" 4
    Set-ControlValue "render" 4
    Set-ControlValue "render_2020" 2
    Set-ControlValue "frame_prediction" 1
    Set-ControlValue "light" 1
    Set-ControlValue "shadow" 1
    Set-ControlValue "plant" 1
    Set-ControlValue "dynamic_shadow" $false
    Set-ControlValue "transparent_shadow" $true
    Set-ControlValue "lighting_rendering" 1
    Set-ControlValue "scene_sfx_performance" 2
    Set-ControlValue "main_player_sfx_performance" 1
    Set-ControlValue "other_player_sfx_performance" 2
    Set-ControlValue "volumetric_cloud" 3
    Set-ControlValue "ambient_occlusion" 0
    Set-ControlValue "anisotropic_filter" 2
    Set-ControlValue "anti_alias_pc" 1
    Set-ControlValue "surface_reflection" 0
    Set-ControlValue "global_illumination" 1
    Set-ControlValue "z_far" 1.0
    Set-ControlValue "player_num" 0.9
    Set-ControlValue "enemy_limit_num" 35
    Set-ControlValue "friend_limit_num" 20
    $statusBox.Text = "Loaded preset: 2560x1440, frame mode 4. Click Apply or Apply && Launch."
}

function Load-CurrentToControls {
    $script:pc = Read-JsonObject $PcConfigPath
    $script:quality = Read-JsonObject $QualityConfigPath

    Set-ComboIfPresent $resolutionBox ("{0}x{1}" -f $script:pc.resolution[0], $script:pc.resolution[1])
    $fullscreenBox.Checked = [bool]$script:pc.full_screen

    foreach ($entry in $fieldControls.GetEnumerator()) {
        $name = $entry.Key
        if ($script:quality.PSObject.Properties.Name -contains $name) {
            if ($name -eq "frame") {
                Set-ComboIfPresent $entry.Value (Format-FrameValue $script:quality.$name)
            }
            else {
                Set-ComboIfPresent $entry.Value $script:quality.$name
            }
        }
    }
    $statusBox.Text = "Loaded current config."
}

function Apply-SelectedConfig([bool]$Launch) {
    $pc = Read-JsonObject $PcConfigPath
    $quality = Read-JsonObject $QualityConfigPath

    $resolution = Parse-Resolution $resolutionBox.Text
    Set-JsonProperty $pc "resolution" $resolution
    Set-JsonProperty $pc "full_screen" ([bool]$fullscreenBox.Checked)

    foreach ($entry in $fieldControls.GetEnumerator()) {
        $name = $entry.Key
        if ($name -eq "frame") {
            $value = Convert-FrameValue $entry.Value.Text
        }
        else {
            $value = Convert-TextValue $entry.Value.Text
        }
        Set-JsonProperty $quality $name $value
    }

    Set-JsonProperty $quality "quality" -1
    Set-JsonProperty $quality "preset_mode" -1

    $pcBackup = Backup-Config $PcConfigPath
    $qualityBackup = Backup-Config $QualityConfigPath
    Write-JsonObject $PcConfigPath $pc
    Write-JsonObject $QualityConfigPath $quality

    $message = "Applied {0} / frame mode={1}.`r`nBackups:`r`n{2}`r`n{3}" -f $resolutionBox.Text, (Convert-FrameValue $fieldControls["frame"].Text), $pcBackup, $qualityBackup
    if ($Launch) {
        if (-not (Test-Path -LiteralPath $GameExe)) { throw "Missing game executable: $GameExe" }
        Start-Process -FilePath $GameExe -WorkingDirectory $GameRoot
        $message += "`r`nGame started."
    }
    $statusBox.Text = $message
}

[System.Windows.Forms.Application]::EnableVisualStyles()

$script:pc = Read-JsonObject $PcConfigPath
$script:quality = Read-JsonObject $QualityConfigPath

$form = New-Object System.Windows.Forms.Form
$form.Text = "LifeAfter Graphics Launcher"
$form.StartPosition = "CenterScreen"
$form.Size = New-Object System.Drawing.Size(760, 720)
$form.MinimumSize = New-Object System.Drawing.Size(720, 640)
$form.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 9)

$root = New-Object System.Windows.Forms.TableLayoutPanel
$root.Dock = "Fill"
$root.Padding = New-Object System.Windows.Forms.Padding(14)
$root.ColumnCount = 1
$root.RowCount = 4
$root.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::AutoSize))) | Out-Null
$root.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Percent, 100))) | Out-Null
$root.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::AutoSize))) | Out-Null
$root.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::AutoSize))) | Out-Null
$form.Controls.Add($root)

$topPanel = New-Object System.Windows.Forms.GroupBox
$topPanel.Text = "Window"
$topPanel.Dock = "Top"
$topPanel.Padding = New-Object System.Windows.Forms.Padding(10)
$topLayout = New-Object System.Windows.Forms.TableLayoutPanel
$topLayout.Dock = "Fill"
$topLayout.ColumnCount = 4
$topLayout.RowCount = 1
$topLayout.AutoSize = $true
$topPanel.Controls.Add($topLayout)

$resolutionBox = New-Combo @("960x540", "1280x720", "1600x900", "1920x1080", "2560x1440", "3840x2160") ("{0}x{1}" -f $script:pc.resolution[0], $script:pc.resolution[1])
$fullscreenBox = New-Object System.Windows.Forms.CheckBox
$fullscreenBox.Text = "Fullscreen"
$fullscreenBox.Checked = [bool]$script:pc.full_screen
$fullscreenBox.AutoSize = $true
$fullscreenBox.Margin = New-Object System.Windows.Forms.Padding(18, 8, 3, 3)

$topLayout.Controls.Add((New-Label "Resolution"), 0, 0)
$topLayout.Controls.Add($resolutionBox, 1, 0)
$topLayout.Controls.Add($fullscreenBox, 2, 0)
$root.Controls.Add($topPanel, 0, 0)

$qualityPanel = New-Object System.Windows.Forms.GroupBox
$qualityPanel.Text = "Graphics"
$qualityPanel.Dock = "Fill"
$qualityPanel.Padding = New-Object System.Windows.Forms.Padding(10)
$scroll = New-Object System.Windows.Forms.Panel
$scroll.Dock = "Fill"
$scroll.AutoScroll = $true
$qualityPanel.Controls.Add($scroll)

$grid = New-Object System.Windows.Forms.TableLayoutPanel
$grid.Dock = "Top"
$grid.AutoSize = $true
$grid.ColumnCount = 4
$grid.RowCount = 1
$grid.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Absolute, 155))) | Out-Null
$grid.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Absolute, 190))) | Out-Null
$grid.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Absolute, 155))) | Out-Null
$grid.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Absolute, 190))) | Out-Null
$scroll.Controls.Add($grid)

$fieldControls = [ordered]@{}
$fields = @(
    @{ Name = "frame"; Label = "Frame mode"; Items = @("0 - 25 FPS", "1 - internal mode", "2 - internal mode", "3 - internal mode", "4 - 120 FPS", "5 - internal mode") },
    @{ Name = "last_quality_level"; Label = "Overall quality"; Items = @("1", "2", "3", "4", "5") },
    @{ Name = "render"; Label = "Render"; Items = @("0", "1", "2", "3", "4") },
    @{ Name = "render_2020"; Label = "Render precision"; Items = @("0", "1", "2", "3") },
    @{ Name = "frame_prediction"; Label = "Frame prediction"; Items = @("0", "1") },
    @{ Name = "light"; Label = "Light"; Items = @("0", "1", "2", "3") },
    @{ Name = "lighting_rendering"; Label = "Lighting render"; Items = @("0", "1", "2", "3") },
    @{ Name = "shadow"; Label = "Shadow"; Items = @("0", "1", "2", "3") },
    @{ Name = "dynamic_shadow"; Label = "Dynamic shadow"; Items = @("false", "true") },
    @{ Name = "transparent_shadow"; Label = "Transparent shadow"; Items = @("false", "true") },
    @{ Name = "plant"; Label = "Vegetation"; Items = @("0", "1", "2", "3") },
    @{ Name = "plant_distance_scale"; Label = "Plant distance"; Items = @("0.0", "0.5", "1.0", "1.5", "2.0") },
    @{ Name = "volumetric_cloud"; Label = "Volumetric cloud"; Items = @("0", "1", "2", "3") },
    @{ Name = "ambient_occlusion"; Label = "Ambient occlusion"; Items = @("0", "1", "2", "3") },
    @{ Name = "anisotropic_filter"; Label = "Anisotropic filter"; Items = @("0", "1", "2", "4", "8", "16") },
    @{ Name = "anti_alias_pc"; Label = "Anti-aliasing"; Items = @("0", "1", "2", "3") },
    @{ Name = "surface_reflection"; Label = "Reflection"; Items = @("0", "1", "2", "3") },
    @{ Name = "global_illumination"; Label = "Global illum."; Items = @("0", "1", "2", "3") },
    @{ Name = "scene_sfx_performance"; Label = "Scene effects"; Items = @("0", "1", "2", "3") },
    @{ Name = "main_player_sfx_performance"; Label = "Self effects"; Items = @("0", "1", "2", "3") },
    @{ Name = "other_player_sfx_performance"; Label = "Other effects"; Items = @("0", "1", "2", "3") },
    @{ Name = "bloom_enhance"; Label = "Bloom"; Items = @("0", "1", "2", "3") },
    @{ Name = "color_grading"; Label = "Color grading"; Items = @("0", "1", "2", "3") },
    @{ Name = "contrast_enhancement"; Label = "Contrast"; Items = @("0", "1", "2", "3") },
    @{ Name = "z_far"; Label = "View distance"; Items = @("0.5", "0.8", "1.0", "1.2", "1.5", "2.0") },
    @{ Name = "player_num"; Label = "Player density"; Items = @("0.3", "0.5", "0.7", "0.9", "1.0") },
    @{ Name = "enemy_limit_num"; Label = "Enemy limit"; Items = @("10", "20", "35", "50", "80") },
    @{ Name = "friend_limit_num"; Label = "Friend limit"; Items = @("10", "20", "35", "50", "80") },
    @{ Name = "fsr_postprocess"; Label = "FSR postprocess"; Items = @("0", "1", "2", "3") },
    @{ Name = "blurred_distant_view"; Label = "Distant blur"; Items = @("0", "1") },
    @{ Name = "long_shadow"; Label = "Long shadow"; Items = @("0", "1", "2", "3") },
    @{ Name = "ocean_depth"; Label = "Ocean depth"; Items = @("0", "1", "2", "3") }
)

for ($i = 0; $i -lt $fields.Count; $i += 2) {
    $row = [int]($i / 2)
    $grid.RowCount += 1
    $grid.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::AutoSize))) | Out-Null

    for ($col = 0; $col -lt 2; $col++) {
        $fieldIndex = $i + $col
        if ($fieldIndex -ge $fields.Count) { continue }
        $field = $fields[$fieldIndex]
        $name = $field.Name
        $value = ""
        if ($script:quality.PSObject.Properties.Name -contains $name) {
            if ($name -eq "frame") {
                $value = Format-FrameValue $script:quality.$name
            }
            else {
                $value = $script:quality.$name
            }
        }
        $combo = New-Combo $field.Items $value
        $fieldControls[$name] = $combo
        $grid.Controls.Add((New-Label $field.Label), $col * 2, $row)
        $grid.Controls.Add($combo, ($col * 2) + 1, $row)
    }
}

$root.Controls.Add($qualityPanel, 0, 1)

$buttonPanel = New-Object System.Windows.Forms.FlowLayoutPanel
$buttonPanel.Dock = "Fill"
$buttonPanel.FlowDirection = "LeftToRight"
$buttonPanel.AutoSize = $true

$applyButton = New-Object System.Windows.Forms.Button
$applyButton.Text = "Apply"
$applyButton.Width = 110
$applyButton.Height = 34
$applyButton.Add_Click({
    try { Apply-SelectedConfig $false }
    catch { [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, "Error") | Out-Null }
})

$launchButton = New-Object System.Windows.Forms.Button
$launchButton.Text = "Apply && Launch"
$launchButton.Width = 130
$launchButton.Height = 34
$launchButton.Add_Click({
    try { Apply-SelectedConfig $true }
    catch { [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, "Error") | Out-Null }
})

$reloadButton = New-Object System.Windows.Forms.Button
$reloadButton.Text = "Reload Current"
$reloadButton.Width = 125
$reloadButton.Height = 34
$reloadButton.Add_Click({
    try { Load-CurrentToControls }
    catch { [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, "Error") | Out-Null }
})

$preset2kButton = New-Object System.Windows.Forms.Button
$preset2kButton.Text = "Preset: 2K 120"
$preset2kButton.Width = 120
$preset2kButton.Height = 34
$preset2kButton.Add_Click({ Set-Base2K120Preset })

$preset960Button = New-Object System.Windows.Forms.Button
$preset960Button.Text = "Preset: 960"
$preset960Button.Width = 105
$preset960Button.Height = 34
$preset960Button.Add_Click({ Set-Base960Preset 0 })

$preset960Frame3Button = New-Object System.Windows.Forms.Button
$preset960Frame3Button.Text = "Preset: 960 F3"
$preset960Frame3Button.Width = 120
$preset960Frame3Button.Height = 34
$preset960Frame3Button.Add_Click({ Set-Base960Preset 3 })

[void]$buttonPanel.Controls.Add($applyButton)
[void]$buttonPanel.Controls.Add($launchButton)
[void]$buttonPanel.Controls.Add($reloadButton)
[void]$buttonPanel.Controls.Add($preset2kButton)
[void]$buttonPanel.Controls.Add($preset960Button)
[void]$buttonPanel.Controls.Add($preset960Frame3Button)
$root.Controls.Add($buttonPanel, 0, 2)

$statusBox = New-Object System.Windows.Forms.TextBox
$statusBox.Multiline = $true
$statusBox.ReadOnly = $true
$statusBox.ScrollBars = "Vertical"
$statusBox.Height = 88
$statusBox.Dock = "Fill"
$statusBox.Text = "Ready. Presets use values read from your working game config. Frame writes internal modes: 0 for the 960 preset, 4 for 2K 120."
$root.Controls.Add($statusBox, 0, 3)

[void]$form.ShowDialog()
