# ADR 0019：版本化单变量实验与确定性分配

状态：已接受
日期：2026-07-30
范围：M3 Issue 023

## 背景

Issue 022 已提供 current、eligible、可追溯的 TopicCandidate 与 immutable FIRST_30 计划。下一步
需要保存可检验假设、单变量 arms、指标、跨作品结构和样本分配，但此时尚无 Content Brief、
发布执行或真实平台指标。旧 schema 已有 `experiments` 根表，也不能建立第二套实验身份。

## 决策

1. 扩展既有 `experiments` 为稳定根，追加 immutable design/assignment、current pointer、
   dependency/invalidation、transition/audit 和 policy registry。旧行只迁移为待复核 DRAFT。
2. V1 精确一个 primary variable、一个 control、有限 treatments 和一个 primary metric；arm
   只能改变 registry 中该维度。多变量实验必须拆分，不实现 factorial design。
3. 用版本化 ReplicationStructure fingerprint 约束 Topic；至少三个不同 canonical Work 才可
   ready。Edition、重复 Topic 或复制 fingerprint 不能凑数。
4. 热度只保存显式快照并用于 HOT/WARM/COLD/UNKNOWN blocking。无依据固定 UNKNOWN，不自动推断。
5. assignment 以有限 strata、保存的 seed 和稳定 hash/tie-break 一次求解；输入乱序不变，短缺
   显式返回，不随机试平衡。
6. LOCKED 只冻结设计。当前不保存真实观测，不计算 effect、显著性、power 或 winner。
7. 所有写操作经 preview、expected revision 和 sender/window 绑定的一次性确认；renderer 只接收
   有界 DTO。依赖变化只精确标记 stale，不自动重排、解锁或切换 current。

## 被否决方案

- 新建第二个 Experiment 根：会破坏既有引用并形成双重真相。
- 同时改变标题和封面：无法归因，违反严格单变量合同。
- 用不同 Edition 充当三本作品：混淆表达版本与 canonical Work。
- 根据书名、出版社或模型记忆推断热度：不可追溯且会把 UNKNOWN 伪装为已知。
- 为凑齐样本复制 Topic、跨 strata 合并或放宽 eligibility：会制造虚假的 ready。
- 反复随机分配直到“看起来平衡”：不可复现且难以审计。
- 在 Issue 023 建表保存平台结果或计算 winner：越过后续指标回收与分析范围。
- 自动生成 Brief、标题、正文或图片：越过 Issue 024/025。

## 后果

- 本机可在零业务网络、零模型调用和零费用下建立、验证、分层、分配、锁定和 clone 实验设计。
- schema 增加多张 STRICT 历史表及索引，换取版本、并发、失效和恢复的可审计证据。
- 后续 Issue 024 可只读取已锁定且非 stale 的设计身份；本 ADR 不授权创建 Brief 或任何内容。
- Issue 023 完成后，下一步仅规划 Issue 024。
