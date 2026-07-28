# FPS Slot Lab

一个只保留《明日之后》PC 端帧率槽检测、切换和恢复功能的 Windows 静态研究工具。

## 安全边界

- 只处理 `<游戏目录>\Documents\script.py314.lc.npk` 中已知的 `SettingManager` 记录。
- 只允许切换到 260、280、300、360 FPS。
- 当前槽位、NXPK 元数据或补丁哈希不属于已知状态时拒绝写入。
- 写入前在主逻辑中重新检查 `lifeafter.exe`，不是只依赖按钮状态。
- 从解析到写入结束持续以 `FileShare.None` 持有 NPK 独占句柄。
- 每次写入前保存首次观测槽和带时间戳的事务备份。
- 写入后校验目标槽完整 SHA-256、槽外整包 SHA-256，以及三个画质配置的前后 SHA-256。
- 恢复使用首次观测备份，不把内置 `patch_120.bin` 宣称为网易官方原件。

该工具不会提供防封能力。修改游戏包可能违反游戏用户协议或触发完整性/反作弊检测，测试风险由使用者自行承担。

## 构建

在 PowerShell 中运行：

```powershell
Set-Location 'C:\Users\Admin\Documents\一键启动\fps-slot-lab'
.\build.ps1 -Clean
```

构建产物：

```text
dist\
  FPS-Slot-Lab.exe
  README.md
  SHA256SUMS.txt
  patches\
    patch_120.bin
    patch_260.bin
    patch_280.bin
    patch_300.bin
    patch_360.bin
```

运行时必须保留 `patches` 目录与 EXE 的相对位置。

运行合成 NXPK 测试：

```powershell
.\test.ps1
```

测试会在系统临时目录创建一个最小 NXPK v3 样本，验证检测、260 FPS 写入、槽外不变、画质配置不变、首次备份恢复以及未知槽拒绝。测试不会访问或修改真实游戏目录。

## 使用

1. 完全退出游戏。
2. 启动 `dist\FPS-Slot-Lab.exe`。
3. 自动检测失败时，选择包含 `mingrizhihou.exe` 的游戏根目录。
4. 等待工具识别当前目标槽。
5. 阅读并勾选风险确认。
6. 选择 260、280、300 或 360 FPS。
7. 写入完成且全部校验通过后，再正常启动游戏测试。
8. 需要回退时，退出游戏并点击“恢复首次备份”。

备份保存在：

```text
%LOCALAPPDATA%\FPS Slot Lab\backups\<游戏包路径哈希>\
```

## 已知限制

- 内置补丁来自本次用户提供的 `WM优化助手-Setup-v2.3.1.exe`，不是从网易签名发布物独立取得。
- 300 FPS 补丁除帧率整数外，还包含 1,047 个前导序列化字节差异，界面会二次提示。
- 工具要求目标 NXPK 记录元数据与已审查版本完全一致；游戏更新后可能拒绝操作。
- 仅完成静态实现和无游戏环境自测，不代表已验证实际游戏帧率或账号安全。
