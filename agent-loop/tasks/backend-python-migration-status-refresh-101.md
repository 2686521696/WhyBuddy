# 后端 NodeJS 迁 Python：migration status refresh 101

## 执行状态
- 状态：待执行
- 目标：基于 101 final-gap 队列的真实代码、gate、review 和任务结果刷新 `sliderule-python-migration-status.md`，并把“整体工程进度”和“剩余短板成熟度”拆开写。
- 角色分工：worker 负责读取 queue outcomes、commits、gate、任务文档和 diff 证据；reviewer 必须确认没有把 docs-only、no-diff、skipped-live、HALT 或 rescue-only 任务计入业务迁移完成。

### 状态清单
- [x] 读取 101 队列每个任务的 outcome、diff、gate、review 证据。
- [x] 区分 real runtime、thin proxy、compat shell、readiness-only、docs-only、no-diff、failed、manual rescue。
- [x] 更新整体工程进度表，避免把短板成熟度和总进度混成一个数字。
- [x] 更新剩余短板成熟度表，解释为什么局部仍可能是 85-93%。
- [x] gate 全绿。
- [x] review 确认没有虚高整体 NodeJS 后端迁移进度。

## 背景

用户已经指出当前表里“整体 97-98%，但局部还有 80 多”看着容易混淆。101 状态刷新必须把两张表分开：

- 整体工程进度：看已迁移的大盘和可工作路径。
- 剩余短板成熟度：只看还没完全从 Node 拿下来的最后短板，所以百分比可以明显低于整体。

## 允许修改的文件
- `agent-loop/tasks/sliderule-python-migration-status.md`
- `agent-loop/tasks/backend-python-migration-status-refresh-101.md`

## 允许读取和引用的证据
- `.agent-loop/queue-outcomes.json`
- `.agent-loop/latest/final-report.md`
- `.agent-loop/latest/final-report.json`
- `agent-loop/scripts/migration-queue.json`
- `agent-loop/tasks/backend-python-*-101.md`
- `agent-loop/tasks/backend-python-*-100.md`
- `docs/backend-python-node-route-cutover-audit-100.md`
- 本轮 101 code queue 对应的 Python/Node test paths 和 commits

## 禁止扩大范围

- 不改业务代码。
- 不提交 `.agent-loop`、`.worktrees`、日志、缓存或真实用户数据。
- 不把 status refresh 本身计入迁移分子。
- 不把 docs-only、inventory、skipped live smoke、HALT_NO_CHANGES、HALT_APPLY_FAILED、rescue patch 直接计入完成。
- 不把 readiness-only 写成 production takeover。
- 不写整体 100%，除非 101 队列和 route/gate 证据真的支撑。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `migrationStatusRefresh101Gates`。

## 成功标准

- `sliderule-python-migration-status.md` 拆成“整体工程进度”和“剩余短板成熟度”两张表。
- 明确列出 101 本轮成功计入、不能计入、需要人工接管的任务。
- 对整体百分比使用保守口径；若证据不足，继续写 98-99% 或更保守区间，而不是硬写 100%。
- 对局部短板解释清楚为什么会低于整体进度。
- mojibake 扫描通过。

## 给 worker 的大白话

这个任务只负责算账，不负责刷分。整体可以很接近完成，但剩下几个短板本身成熟度低，这是正常的。要把这两件事拆开写，让人一眼看懂。
