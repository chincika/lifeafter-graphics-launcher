# 2026-08-10 老 PC 包体游戏内调整样本

本目录记录用户在 2026-08-10 游戏更新后，进入游戏内手动调整到合适档位后的配置。本样本被确定为最高画质参考基线，不是可直接覆盖用户文件的模板。

## 预设接入原则

切换任何启动器预设时，只允许修改两个字段：

- `pcconfig.resolution`
- `qualityconfig.frame`

其他字段全部沿用用户当前配置。包括所有 `hidden_*` 特效选项、`reflex_mode`、`taa_quality`、`aa_type`、`dlss_quality`、`TAA`、全屏状态和垂直同步设置，均不能随画质档位被重置。

因此，低分辨率或低帧率档位只调整分辨率和帧率，不改变用户在游戏内选定的特效显示策略。

## 采集信息

- 平台：老 PC 包体
- 游戏目录：`D:\Program Files (x86)\LifeAfter`
- 配置落盘时间：2026-08-10 10:19
- `qualityconfig` SHA-256：`540B0D486BA21D581C85C27FA9A6FBBEE05A184D7BAF0398B38877E5FEA0093C`
- `pcconfig` SHA-256：`6617FE9EF5795B0885C23A2825F92151DB95085ADDBD4359DC8D75A1E42D6AD8`
- 采集时游戏已退出，配置已稳定落盘。

## 2026-08-06 后首次观察到的画质字段

| 字段 | 本样本值 |
| --- | ---: |
| `hidden_assault_rifle_sfx` | 1 |
| `hidden_shotgun_sfx` | 1 |
| `hidden_bazooka_sfx` | 1 |
| `hidden_pistol_sfx` | 1 |
| `hidden_emg_sfx` | 1 |
| `reflex_mode` | 0 |
| `taa_quality` | 2 |

## 本次游戏内调整后新落盘的字段

| 字段 | 本样本值 |
| --- | --- |
| `aa_type` | `"taa"` |
| `dlss_quality` | `2` |
| `TAA` | `null` |

`TAA` 的大小写和 `null` 值按游戏原始输出保留，不做自动归一化。

## 相对 08:37 更新前样本的其他变化

| 字段 | 之前 | 本样本 |
| --- | ---: | ---: |
| `hidden_assault_rifle_sfx` | 0 | 1 |
| `hidden_shotgun_sfx` | 0 | 1 |
| `hidden_bazooka_sfx` | 0 | 1 |
| `hidden_pistol_sfx` | 0 | 1 |
| `hidden_emg_sfx` | 0 | 1 |
| `hidden_specific_shrub` | 0 | 1 |
| `home_render_budget` | 1 | 0 |
| `other_home_bobj_show_range` | 30 | 100 |

## `pcconfig` 管理边界

`displayconfig.json` 记录采集时的显示状态。启动器实际只管理其中的 `resolution`；`full_screen` 和 `vsync` 仅用于参考，不随预设切换：

- `resolution`
- `full_screen`
- `vsync`

下列字段不进入启动器预设，不覆盖、不删除，维持游戏或系统自身配置：

- `keymap`
- `half_infected_keymap`

后续接入时应改为 JSON 字段级合并，禁止使用整个 `pcconfig` 或 `qualityconfig` 模板覆盖原文件。
