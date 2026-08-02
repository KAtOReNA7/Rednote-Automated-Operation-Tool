# V2-R05 本地互动与回复合同

状态：实现合同；适用于 V2-R05。它不授权 R06、真实平台接入或自动发送。

## 用户结果与边界

用户只能在现有“互动”页主动粘贴一条 `COMMENT` 或 `DIRECT_MESSAGE`，可选关联当前 workspace
内一个稳定的 R04 `ContentPackage` ID。来源固定为 `USER_PASTE`。页面必须持续显示：

> 本地 Scripted 建议，不是模型生成；系统不会发送消息。

系统不读取平台收件箱，不保存联系人或平台凭据，不调用模型、搜索、抓取、OCR、图片或业务网络。
`MANUAL_SENT` 只记录用户确认自己已在官方端完成发送，绝不是发送命令或成功回执。

## 有界合同

- 用户文本：NFC、换行统一、去首尾空白后 1—8,000 UTF-8 bytes。
- 回复建议：同样规范化后 1—4,000 UTF-8 bytes。
- 单次只创建一项；批量确认 1—40 项。
- item、version、idempotency 与相关内容包 ID 只接受有界的 `[A-Za-z0-9_-]` token，并原样保留大小写。
- 去重作用域为 workspace；key 是 `kind + relatedContentPackageId + normalized text` 的 SHA-256。
- 精确重放先查询去重 key：返回既有项，不新增 row，也不调用文件写入。

## 状态机

```text
NEW --生成建议--> SUGGESTED --确认当前版本--> CONFIRMED --明确记录--> MANUAL_SENT
 |                    |             |
 +------跳过----------+             +--实质编辑新版本--> SUGGESTED
          |
       SKIPPED --重新打开--> NEW（无建议）/ SUGGESTED（已有建议）

MANUAL_SENT --受控撤销--> CONFIRMED
任意可见状态 --预览并明确确认删除--> DELETED（产品墓碑）
```

所有 mutation 均携带 `expectedRevision`；创建使用固定初始值 0。确认和 `MANUAL_SENT` 还绑定精确
current suggestion version ID。实质编辑追加 suggestion version 并回到 `SUGGESTED`；字节相同的
no-op 不写文件、不升版。批量确认先在单事务中校验全部 revision、状态与 current version，任何一项
stale 时整批零写入。

## SQLite 与本地文件

Migration 23 只追加两张 `STRICT, WITHOUT ROWID` 表：

- `v2_interaction_items`：类型、来源、可选 R04 关联、用户文本文件 metadata、去重 key、current
  suggestion version、状态、revision 与有限 UTC 时间。
- `v2_reply_suggestion_versions`：item、version/version ID、固定 `SCRIPTED` provider、回复文件
  metadata 与 UTC 创建时间。

正文和建议只进入 ProjectDataRoot 的内容寻址 `IMPORT` managed files。SQLite、错误、日志、诊断、
IPC 摘要、证据与导出都不得包含正文、联系人标识或绝对路径。renderer 只接收窄 DTO 中当前可见
正文，不接收 DB row、SQL、绝对路径或 managed path。

## 删除语义

删除固定为 `preview → confirmed mutation → DELETED tombstone`。preview 只返回 item ID、将保留的
managed reference 计数以及 `physicalDeletion=false`。墓碑后，普通 list/get/facade/IPC 不再返回用户
正文或建议，其他互动与 R04 内容包不受影响。

现有内容寻址仓库没有可证明引用安全和断电安全的单文件删除能力，因此 R05 不物理删除这些 bytes，
也不做目录扫描或新建 GC。文件作为产品不可访问的 cleanup pending/orphan 保留；任何报告不得把这
描述成“磁盘字节已删除”。

## IPC 与安全

底层 IPC 仍严格只有 `v2:workspace:read` 与 `v2:workspace:mutate`。preload 只增加具名窄方法；main
process 校验 exact-object、大小、枚举、revision、sender frame/origin/window。renderer 继续没有
Node、Electron、SQLite、文件系统或网络直连。AI 标识固定不参与门禁，版权风险完全不进入合同。
