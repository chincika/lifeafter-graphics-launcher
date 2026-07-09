# 明日之后多开画质启动器

一个用于切换《明日之后》PC 端画质配置并启动游戏的小工具。

作者：不与世俗纷争

本项目为公益开源项目，免费使用，仅用于个人便利、学习与交流。请勿倒卖、捆绑收费或用于破坏游戏环境的用途。

GitHub 地址：https://github.com/chincika/lifeafter-graphics-launcher

如果这个项目对你有帮助，欢迎在 GitHub 点一个 Star。

## 主要功能

- 自动检测游戏目录，也支持手动选择安装目录。
- 一键切换常用画质预设：2K 120、1080p 120、1080p 60、900p 120、900p 60、720p 60、540p 60、540p 25。
- 支持“主力 + 挂机”多开：默认分步确认，也提供实验性的自动倒计时模式，默认间隔 20 秒。
- 每次写入配置前自动备份，并保留默认 2K120 的恢复点。
- 日志和工具数据写入游戏配置目录下的 `launcher_data`，避免污染 exe 所在目录。
- 内置封面展示与末世科幻风 UI；封面和图标已打包进 exe，仓库中的 `assets/cover.png`、`assets/app.ico` 用作源素材。
- 兼容 2026-07 游戏更新后的新增配置项：`dpi_resize_policy`、`player_super_low`。

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
& $csc /nologo /target:winexe /platform:anycpu /out:'明日之后画质启动器.exe' /win32icon:'assets\app.ico' /resource:'assets\cover.png,cover.png' /reference:System.Windows.Forms.dll /reference:System.Drawing.dll LifeAfterPresetLauncher.cs
```

## 版本

当前版本：v1.5.4
