# 明日之后 FPS 解锁 180 / 240

这是针对本机当前 `script.py314.lc.npk` 精确制作的研究补丁，只修改
`SettingManager` 的固定长度压缩槽，不改 NXPK 头、加密索引、画质配置或其他记录。

支持的已知状态：

- 官方原始槽位
- 180 FPS
- 240 FPS

## 使用

双击 `LifeAfter-FPS-Unlock-180-240.exe`，直接回车可识别本机默认安装路径。
按菜单选择 180、240、恢复或备份。

命令行也可使用：

```text
LifeAfter-FPS-Unlock-180-240.exe status [NPK路径]
LifeAfter-FPS-Unlock-180-240.exe backup [NPK路径]
LifeAfter-FPS-Unlock-180-240.exe apply 180 [NPK路径]
LifeAfter-FPS-Unlock-180-240.exe apply 240 [NPK路径]
LifeAfter-FPS-Unlock-180-240.exe restore [NPK路径]
```

## 安全保护

- 仅接受已审查的 NXPK v3 元数据和三种已知槽位 SHA-256。
- 每次写入前校验目标槽以外的完整包体内容。
- 首次写入前在 `%LOCALAPPDATA%\LifeAfter FPS Unlock 180-240\Backups` 创建
  完整官方原包备份，并校验完整 SHA-256。
- 每次操作另存事务槽位备份。
- 写后回读验证；失败时自动恢复写入前槽位。
- `restore` 后要求完整 NPK SHA-256 恢复为已审查原版。
- 游戏运行时拒绝写入。

## 已知限制

- 只适配生成补丁时的当前包体。游戏更新导致元数据、槽位或槽外哈希变化时会拒绝操作。
- 180/240 是注入给 `frame_execute_mgr.request_frame_rate` 和
  `game3d.set_frame_rate` 的固定整数，并不是新增原生 UI 档位。
- 实际帧数仍受显示器刷新率、渲染负载、驱动和游戏内部逻辑限制。
- 本工具不包含反作弊绕过。修改联网游戏文件可能违反游戏规则并产生账号风险。
