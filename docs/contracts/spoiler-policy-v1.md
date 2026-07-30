# Spoiler Policy V1

状态：Issue 021 冻结合同，版本为 `spoiler-policy-v1`。

## 级别与要求

| 级别                  | 核心诡计/结局披露 | Warning    | 用户额外确认 | Warning placement              |
| --------------------- | ----------------- | ---------- | ------------ | ------------------------------ |
| `NO_SPOILER`          | 否                | 否         | 否           | `NONE`                         |
| `LIGHT_SPOILER`       | 否                | 必须       | 否           | `BODY_OPENING`                 |
| `FULL_TRICK_ANALYSIS` | 是                | 必须且醒目 | 必须         | `COVER_TITLE_AND_BODY_OPENING` |

完整核心诡计分析允许存在，不因“涉及剧透”本身被禁止。缺少必要 warning 或 FULL_TRICK 的用户确认
时，未来 content-brief 前置状态保持 blocked。

## 正交边界

剧透 warning 只解决剧透知情提示，不提升：

- 用户是否读过的真实性；
- R2 assertion 的有效范围；
- R3/S1 的第一人称权限；
- Dossier/FactPolicy 的事实就绪度；
- 个人或资料评分权限。

因此 S1 + FULL_TRICK 仍只能使用“公开资料整理”模式；R3 不能借剧透设置伪装亲身阅读。AI 标识、
版权信息与 publication relationship 不进入 spoiler evaluator。

Issue 021 只保存 policy 状态、warning requirement 和 UI 配置，不生成实际警告文案、标题、正文、
封面或发布包。
