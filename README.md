# 明日之后画质启动器

一个用于切换《明日之后》PC 端画质配置、帧率解锁、多开游戏并监控实例状态的 Windows 启动器。



本项目为公益开源项目，免费使用，仅用于个人便利、学习与交流。请勿倒卖、捆绑收费或用于破坏游戏环境的用途。

GitHub 地址：https://github.com/chincika/lifeafter-graphics-launcher

如果这个项目对你有帮助，欢迎在 GitHub 点一个 Star。

## 主要功能

- 全新的 Windows 11 Fluent 风格界面，支持 Mica/毛玻璃质感与现代化交互。
- 自动扫描固定磁盘中的 `LifeAfter` 与 `mrzh` 游戏目录，也支持手动添加任意位置的安装目录。
- 顶部包体菜单会记录多个安装目录，可在“老PC包体”和“发烧平台包体”之间切换；移除列表记录不会删除游戏文件。
- 一键切换常用画质预设：2K 120、1080p 120、1080p 60、900p 120、900p 60、720p 60、540p 60、540p 25。
- 每个画质预设可独立记忆进程优先级与 CPU 核心策略；高帧主力默认使用高优先级和全部核心，540p 25 挂机档默认使用低优先级和能效核心。
- 通过 Windows CPU Set 自动识别混合架构处理器的性能核、能效核和逻辑处理器编号，也支持用户在二级配置中自由选择。
- 全部核心和自定义模式可选为系统保留逻辑处理器 CPU 0；开启后摘要与实例状态会明确显示“− CPU0”。
- 支持“主力 + 挂机”多开：默认分步确认，也提供实验性的自动倒计时模式，默认间隔 20 秒。
- 最多监控 4 个游戏实例，实时显示游戏 ID、分辨率、帧率、CPU、内存与运行时长。
- 按游戏 ID 自动记录账号运行时长，提供日、周、月、总览统计、账号排行、最近会话与 CSV 导出。
- 启动记录可随时暂停或恢复；暂停后仍显示实时实例状态，但不会累计或保存新的会话时长。
- 帧率解锁菜单可将游戏原生 120 FPS 档单独接管为 180、240 或 300 FPS；25/30/40/50/60/90 等其他档位保持游戏原逻辑。
- 帧率补丁使用包体版本锁、目标槽位哈希锁与写后整包校验；每次写入前保留完整 NPK 事务备份，并自动建立永久保护的官方原包基线。
- 帧率修改成功后只保留最新 1 份事务备份；也可手动清理全部事务备份，官方初始还原点不会被删除。
- 帧率解锁可自动识别“老PC包体”与“发烧平台包体”；发烧平台只修改 `Documents` 增量包，根目录完整包始终只读。游戏更新后结构完全一致则建立独立兼容档案，结构变化则自动锁定写入。
- 事务备份保留在游戏 `Documents\fps_unlock_backups`，按平台与版本隔离的永久还原点保存在启动器本地数据区。
- 支持最小化到系统托盘继续记录游戏时长；托盘状态下释放主界面渲染窗口，并使用自适应低频实例检测。
- 可选开启局域网只读副屏，通过手机、平板或电脑浏览器实时查看实例状态、账号排行和最近会话。
- 远端设备使用五分钟配对码授权；接口不提供游戏启动、配置修改、帧率操作或本机文件访问。
- “性能优先”会使用游戏官方 `Documents\bin\x64-3\lifeafter.exe` 通道启动；关闭后使用根目录 `lifeafter.exe`，单开与多开会保持同一选择。
- 每次写入配置前自动备份，并保留默认 2K120 的恢复点。
- 日志和工具数据写入游戏配置目录下的 `launcher_data`，避免污染 exe 所在目录。
- 运行数据仅保存在本机，并为后续局域网副屏监控预留了独立实例数据接口。
- 启动记录、局域网设置与已授权设备只保存在当前 Windows 用户的应用数据目录中，不会写入或打包进便携版 EXE。
- 默认每次启动从 GitHub Release 检查更新，也可调整为每天、每周或每月；下载文件必须通过 SHA-256 校验后才会自动替换。
- 兼容 2026-07 游戏更新后的新增配置项：`dpi_resize_policy`、`player_super_low`。

## 使用方式

推荐直接运行现代便携版：

```powershell
明日之后画质启动器-现代版.exe
```

仓库同时保留经典单文件版：

```powershell
明日之后画质启动器.exe
```

命令行切换预设：

```powershell
明日之后画质启动器.exe --apply "2K 120"
明日之后画质启动器.exe --apply "540p 25" --launch
```

## 编译现代版

现代版使用 Electron 桌面外壳与本地 C# 后台：

```powershell
cd desktop-app
npm install
npm run portable
```

便携版输出到 `desktop-app/release/LifeAfter-Graphics-Launcher-2.5.0.exe`。

## 编译经典版

使用系统自带的 .NET Framework C# 编译器：

```powershell
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
& $csc /nologo /target:winexe /platform:anycpu /out:'明日之后画质启动器.exe' /win32icon:'assets\app.ico' /resource:'assets\cover.png,cover.png' /reference:System.Windows.Forms.dll /reference:System.Drawing.dll LifeAfterPresetLauncher.cs
```

## 版本

当前版本：v2.5.0

- 现代便携版：v2.5.0
- 经典单文件版：v1.8.0

完整更新内容见 [CHANGELOG.md](CHANGELOG.md)。
