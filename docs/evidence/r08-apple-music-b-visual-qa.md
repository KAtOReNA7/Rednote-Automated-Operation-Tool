# R08 Apple Music B visual QA

## Approved Figma references

| Page          | Figma node | Production surface                  | Result                                                                                   |
| ------------- | ---------- | ----------------------------------- | ---------------------------------------------------------------------------------------- |
| B1 总览       | `11:39`    | `overview-page.tsx`                 | Unchanged by R08 B3–B7 implementation                                                    |
| B2 本周计划   | `11:40`    | `weekly-plan-page.tsx`              | Unchanged by R08 B3–B7 implementation                                                    |
| B3 内容工作台 | `26:34`    | `content-page.tsx`                  | Queue, primary editor and inspection column implemented                                  |
| B4 互动收件箱 | `26:35`    | `interaction-page.tsx`              | Inbox, reply workspace and context column implemented                                    |
| B5 书库       | `26:36`    | `library-page.tsx` + shared styles  | Cover-led editorial card grid implemented; neutral placeholder remains                   |
| B6 数据复盘   | `26:37`    | `review-page.tsx`                   | KPI, local-data trend/comparison charts, intake, summary and strategy states implemented |
| B7 设置       | `26:38`    | `settings-page.tsx` + shared styles | Grouped preference hierarchy and reduced diagnostic emphasis implemented                 |

## Deterministic checks

- Figma B6 was revised before code implementation: KPI summary, metric legend, trend chart, content comparison, intake, no-data and insufficient-sample states.
- The renderer uses only persisted review details and totals. Empty data is explicit; no layout sample number is encoded in production code.
- B1 and B2 source files are absent from the implementation diff.
- Focused renderer/workflow tests, formatting, lint, typecheck, build and `git diff --check` are the local acceptance evidence.

## Visual comparison notes

- B3/B4 use a three-column workbench with a stronger current item and a compact right-side verification/context surface.
- B5 uses dark editorial covers only for existing local content and a neutral surface for unavailable covers.
- B6 uses semantic text, legends and numeric labels in addition to color for every chart state.
- B7 keeps credential and provider flows unchanged while making the currently actionable provider state more prominent than advanced diagnostics.
