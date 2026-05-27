# 明日之后安全画质启动器

一个用于切换《明日之后》PC 端画质配置并启动游戏的小工具。

## 主要功能

- 自动检测游戏目录，也支持手动选择安装目录。
- 一键切换常用画质预设：2K 120、1080p 120、1080p 60、900p 60、720p 60、540p 60、540p 25。
- 支持“主力 + 挂机”延迟多开：先启动主力窗口，等待指定秒数后，再写入挂机配置并启动下一个窗口。
- 每次写入配置前自动备份，并保留默认 2K120 的恢复点。
- 日志和工具数据写入游戏配置目录下的 `launcher_data`，避免污染 exe 所在目录。

## 使用方式

直接运行：

```powershell
明日之后画质启动器.exe
```

命令行切换预设：

```powershell
明日之后画质启动器.exe --apply "2K 120"
明日之后画质启动器.exe --apply "540p 25" --launch
```

## 编译

使用系统自带的 .NET Framework C# 编译器：

```powershell
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
& $csc /nologo /target:winexe /platform:anycpu /out:'明日之后画质启动器.exe' /reference:System.Windows.Forms.dll /reference:System.Drawing.dll LifeAfterPresetLauncher.cs
```

## 版本

当前版本：v1.1.3
