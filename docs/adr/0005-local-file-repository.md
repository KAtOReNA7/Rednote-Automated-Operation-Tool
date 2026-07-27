# ADR 0005：本地文件仓库

- 状态：已接受
- 日期：2026-07-27
- 范围：M1 Issue 008
- 固定起点：`eb9ac8a600caa05c764eb3f2e62e535efa509069`

## 决策

### 包和进程边界

`packages/shared` 保存纯契约：文件类别、`ManagedRelativePath`、文件名净化、稳定错误码与有限 DTO。`packages/storage` 使用 Node.js 24 内置的 `fs`、`path`、`crypto` 和 `stream` 实现文件系统能力；它不依赖 Electron、云 SDK、原生扩展或第三方文件库。`packages/db` 只负责 SQLite 路径约束和迁移。

Electron main 仅在系统临时目录执行一次合成 storage smoke。renderer 不导入 storage、`node:fs`、绝对路径或数据库；preload 继续只暴露 Issue 006 的四个只读接口。本 Issue 没有新增 IPC、HTTP 服务、端口或长期 JobWorker。

### ProjectDataRoot、根标记和目录

调用方必须向 `initializeProjectDataRoot(rootPath)` 或 `openProjectDataRoot(rootPath)` 显式传入绝对路径。API 没有默认参数，不读取 `process.cwd()`、用户主目录、桌面、文档、下载或云盘，也拒绝文件系统根、UNC 和设备命名空间。根目录选择和生产引用持久化留给 Issue 010。

根标记固定为 `.rednote-data-root.json`：

```json
{
  "format": "rednote-project-data",
  "version": 1,
  "instanceId": "随机 UUID",
  "createdAt": "UTC ISO-8601"
}
```

标记不保存绝对路径、用户名、机器名、环境变量、密钥、数据库内容或业务正文。标记先写入同目录独占临时文件并 `sync`，再用独占硬链接发布；同进程初始化按根串行化，竞争者读取获胜标记，因此 instance id 稳定。合法标记存在时可补齐缺失的普通目录；非空无标记目录、高版本、错误 format、普通文件占位、符号链接或 junction 均被拒绝。

固定布局为：

```text
project-data/
  database/
  sources/
    snapshots/
    screenshots/
  photos/
    originals/
    processed/
  generated-images/
  exports/
  imports/
  backups/
    database/
  logs/
```

没有云同步目录、凭据目录或永久 staging 目录。

### 文件类别与 ManagedRelativePath

单一类别映射如下：

| 类别              | 目录                  |
| ----------------- | --------------------- |
| `SOURCE_SNAPSHOT` | `sources/snapshots`   |
| `CLIP_SCREENSHOT` | `sources/screenshots` |
| `PHOTO_ORIGINAL`  | `photos/originals`    |
| `PHOTO_PROCESSED` | `photos/processed`    |
| `GENERATED_IMAGE` | `generated-images`    |
| `IMPORT`          | `imports`             |
| `EXPORT`          | `exports`             |
| `BACKUP`          | `backups`             |
| `LOG`             | `logs`                |

数据库和跨包业务引用只使用 `ManagedRelativePath`：UTF-8 字符串、唯一分隔符 `/`、总长至多 1,024、单段至多 120，不允许空段、`.`、`..`、反斜杠、冒号、盘符、URI、NUL、控制字符或应用临时文件前缀。构造函数还要求路径位于上述类别目录。

native 路径通过 `path.resolve` 和 `path.relative` 做根包含验证，不使用字符串 `startsWith` 作为安全判断。访问已存在路径前逐段 `lstat`，拒绝符号链接和 Windows junction。该边界面向单用户本地应用，防止误用和路径穿越；Node 跨平台 API 不能消除所有 Windows TOCTOU 竞争，因此不宣称抵抗同机高权限攻击者。

### Windows 文件名和长路径

净化器保留中文、日文、emoji 和正常 Unicode，使用 NFC，分开处理基础名和扩展名，处理 Windows 保留字符、控制字符、尾随空格/句点和设备名（含 `COM¹`/`LPT¹` 变体）。目录分隔符、NUL、`.` 和 `..` 直接拒绝。截断按 Unicode code point 迭代，不切断 UTF-16 surrogate pair。

最终不可变存储名不是原始显示名，而是小写 SHA-256，因此大小写或 Unicode 显示名碰撞不会覆盖内容。显示名只以净化后的有限字段返回。

根打开时在根内创建并精确清理专用多段探针，当前 Windows 实测路径超过传统 `MAX_PATH` 后才能继续。内部目录名短且确定；不修改 `LongPathsEnabled`、注册表、组策略，也不要求管理员权限。此结果只证明当前 Node、Electron 和 packaged EXE 环境，不代表所有 Windows 10/11 主机无限支持长路径。

### 内容寻址、流式 I/O 和原子发布

`putBuffer`、`putStream` 与 `ingestExternalFile` 统一走流式暂存。流处理遵循 async iterator backpressure，同时计算实际字节数与 SHA-256；默认并发上限为 4，默认单文件上限为 512 MiB，调用方可收紧。每个操作支持 `AbortSignal`。32 MiB 合成测试证明不使用整文件 `readFile`。

暂存文件以强前缀和随机 id 独占创建，完成写入后先 `sync` 文件句柄并关闭，再移入最终哈希分片目录，最后用硬链接独占发布。目标从第一次可见起就是完整文件；相同类别和内容复用同一路径，同名异内容得到不同路径，20 路相同内容并发只留下一个目标。Windows `EBUSY`、`EPERM`、`EACCES` 只做有上限的可测试重试。失败和取消只清理本操作的精确临时普通文件，从不先删除旧目标。

此设计不宣称 exactly-once，也不宣称所有文件系统、断电或崩溃场景都不会留下可识别临时文件。Windows 不提供等同 POSIX 目录 `fsync` 的统一保证；硬链接不受支持时操作以稳定写入错误失败。

### 外部导入、读取与完整性

外部导入只接受受信任上层显式传入的绝对普通文件，逐段拒绝链接、junction、UNC、设备路径、目录及非普通文件。仓库复制而不移动、重命名或删除源文件，复制前后比较设备、inode（可用时）、大小和时间；变化返回 `FILE_CHANGED_DURING_COPY`。扩展名和 MIME 不被视为内容验证。

本 Issue 不解析、执行、打开、渲染或索引图片、HTML、CSV、Excel、ZIP、PDF、电子书或任何导入内容。读取、stat 和 verify 只接受 `ManagedRelativePath`；verify 重新流式计算哈希和大小，区分缺失与损坏且不自动修复或删除。

### 日志

`logs/events.jsonl` 是进程内串行化的本地 JSON Lines sink。事件只含 UTC 时间、有限 code、level、message 和受限 context。字符串、数组、深度、字段数和单行字节数均有限制；Authorization、Cookie、API key、password、secret、token、payload、正文和明显绝对路径递归脱敏。日志不上报、不遥测，也不使业务文件在日志失败时被误报成功。

### SQLite 路径字段和迁移 3

真实 Schema 只有六个本地路径列：

| 列                                  | 允许前缀               |
| ----------------------------------- | ---------------------- |
| `sources.local_snapshot_path`       | `sources/snapshots/`   |
| `clips.screenshot_path`             | `sources/screenshots/` |
| `assets.original_path`              | `photos/originals/`    |
| `assets.processed_path`             | `photos/processed/`    |
| `post_packages.export_path`         | `exports/`             |
| `metric_snapshots.import_file_path` | `imports/`             |

因此追加连续迁移：

- 版本：3
- 名称：`managed_local_file_paths`
- SHA-256：`11dc5ba6496b265cf2945ea7b6b94f59e01428ee253a203596d188b929a222ed`
- 受影响表：`sources`、`clips`、`assets`、`post_packages`、`metric_snapshots`

迁移使用带字段语义前缀的 SQLite `CHECK` 重建五张表，同时逐列复制数据并重建原索引。NULL 语义、主键、外键、唯一约束、STRICT、删除策略、时间字段和全部业务列保持。迁移 runner 仅在该重建事务期间关闭外键执行，事务内运行 `quick_check` 和 `foreign_key_check`，随后强制重新启用外键；失败时整个迁移回滚。版本 1、2 的正文和校验和保持为：

- 1 `initial_prd_schema`：`8964b8727dfb4f244a8c63a47368da3ceb23de945078b37efe161af91acac907`
- 2 `persistent_local_job_queue`：`ab3d6d34621f9f29601f1574f624381d78c208f1c36cfda35377d8f82f4c57ce`

迁移 runner 新增显式绝对 `backupDirectory` 注入；未传入时保持 Issue 007 的默认语义。ProjectDataRoot 集成把数据库放到 `database/`，把迁移前备份放到 `backups/database/`；备份失败时不开始迁移。

### 文件系统与 SQLite 一致性

文件系统发布和 SQLite 事务不是跨系统原子事务。文件先完整发布，数据库事务随后只保存最终 `ManagedRelativePath`、哈希和元数据。数据库失败时不删除可能被并发复用的内容寻址文件，而把它视为可检测 orphan；本 Issue 不提供生产自动删除、垃圾回收或递归清理 API。测试证明重试复用文件，数据库不会指向临时文件或根外路径。

## 明确未实现

本 Issue 没有实现 Issue 010 的设置向导、生产根目录选择或密钥引用；没有实现 Issue 016 的抓取；没有实现 Issue 031—033 的图片模型、图片处理、EXIF、缩略图、OCR 或卡片；没有实现 Issue 036 的正式发布包、manifest 或整周 ZIP；没有实现 Issue 044 的完整备份与恢复。

同时不存在真实模型/API、费用、云存储、云数据库、远程队列、开卷、盗版电子书处理、小红书登录/发布/评论/私信/定时/验证码/风控、安装器、签名或自动更新。`ai_disclosure` 继续固定为 false 且不参与门禁；AI 参与度和版权均不进入评分、审批、优先级、排期或导出。
