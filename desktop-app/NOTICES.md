# 公告热推送维护

v2.6.1 安全构建号为 3。签名清单可加入 `"updatePolicy":{"minimumVersion":"2.6.1","minimumBuild":3}`。策略每次启动独立检查，不受普通检查频率影响；低版本或同版本低构建号会下载更新并限制新增帧率应用，恢复权限始终保留。构建号可避免同版本安全替换后重复更新。尚未内置此入口的旧 EXE 不会被远程追溯控制。

客户端只从官方仓库 `launcher-notices` Release 的 `notices.json` 获取经过 Ed25519 签名的文本清单，每次启动检查，之后每一分钟检查。支持 ETag 条件请求，不变时服务器可返回 304；请求互斥、八秒超时，未更新内容不重复写盘。不下载可执行代码，不修改游戏文件。

首次部署需要在 GitHub 创建该公告 Release 并上传签名文件。当前未部署，不会自动发布公告。

原始 JSON：

```json
{"schema":1,"sequence":1,"messages":[{"id":"example","version":"1","type":"notice","title":"公告标题","body":"公告正文","minVersion":"2.6.1","startsAt":"2026-10-06T00:00:00Z","expiresAt":"2026-12-31T00:00:00Z"}]}
```

每次发布必须增加 sequence。type 支持 notice、risk、disclaimer。内容变更或版本变更都需要重新确认。消息按程序版本和有效期筛选，同意记录只存本机。远程 disclaimer 在现代版主进程阻止新增帧率应用，但从不阻止恢复官方帧率。

使用 `node sign-notices.js <原始JSON路径>` 输出签名封装，然后上传为 notices.json。私钥位于 `%LOCALAPPDATA%\LifeAfterReleaseKeys\notices-private.pem`，必须自行离线备份，不上传 GitHub、不随软件分发。该密钥不是微软代码签名证书。更换信任公钥需要完整客户端更新。

现代版支持自动弹窗和工具页查看有效公告。托盘、失焦、忙碌状态不自动弹窗；选择稍后处理后本次运行不再自动提醒，但应用解锁时仍要求处理未同意的免责声明。已过期公告不会展示。经典版此次加入本地免责声明和后端写入门禁，未包含远程公告界面；命令行用户先运行 `--fps-consent-dialog` 阅读并确认。

本机免责声明确认：`%LOCALAPPDATA%\LifeAfterGraphicsLauncher\fps-consent.txt`，保存版本、UTC 时间及内容 SHA-256。更新前已有用户同样需要确认。确认属于本地阅读同意记录，不作为身份认证或不可篡改的电子签名。
