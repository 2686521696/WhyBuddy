# 后端 NodeJS 迁 Python：migration scope reconciliation 103

## 执行状态

- 状态：待执行
- 目标：基于 103 队列真实 outcome、diff、gate 和 review 证据刷新 `sliderule-python-migration-status.md`。只做最后汇总，不新增业务迁移分子；重点是把 `python-owned`、`node-retained`、`external-owned`、`out-of-scope` 从迁移分母里算清楚。
- 角色分工：worker 负责读取 queue outcomes、任务文档、gate、diff 和 review 证据；reviewer 必须确认没有把 docs-only、retained、skipped-live、external-owned、out-of-scope 虚算成 Python 迁移完成。

### 状态清单

- [ ] 读取 103 队列每个任务的 outcome、diff、gate、review 证据。
- [ ] 区分 `python-owned`、`node-retained`、`external-owned`、`out-of-scope`、`blocked`、`docs-only`。
- [ ] 更新整体工程进度和剩余短板成熟度。
- [ ] 明确是否可以调整整体 98% 工作数字；证据不足时保持保守数字。
- [ ] gate 全绿。
- [ ] review 确认没有虚高整体 NodeJS 后端迁移进度。

## 背景

102 后整体仍不能写 100%，因为多个生产面仍是 Node retained 或 external-owned。103 如果迁了真实 runtime slice，可以计入；如果只是 scope exclusion，则应从分母口径解释，而不是当成业务迁移完成。

## 允许修改的文件

- `agent-loop/tasks/sliderule-python-migration-status.md`
- `agent-loop/tasks/backend-python-migration-scope-reconciliation-103.md`

## 允许读取和引用的证据

- `.agent-loop/queue-outcomes.json`
- `.agent-loop/latest/final-report.md`
- `.agent-loop/latest/final-report.json`
- `agent-loop/scripts/migration-queue.json`
- `agent-loop/tasks/backend-python-*-103.md`
- `agent-loop/tasks/backend-python-*-102.md`
- `agent-loop/tasks/backend-python-*-101.md`
- 本轮 103 对应 Python/Node test paths 和 commits

## 禁止扩大范围

- 不改业务代码。
- 不提交 `.agent-loop`、`.worktrees`、日志、缓存或真实用户数据。
- 不把 status refresh 本身计入迁移分子。
- 不把 retained、blocked、readiness-only、docs-only、no-diff、skipped-live、external-owned、out-of-scope 直接计入业务完成。
- 不写整体 100%，除非 103 队列和 route/gate/review 证据真的支持。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `migrationScopeReconciliation103Gates`。

## 成功标准

- 状态文档明确列出 103 成功计入、不计入、从分母剔除或仍阻塞 100% 的证据。
- 如果整体仍不能写 100%，要说明剩余 node-retained / external-owned / blocked surface。
- 如果整体可以上调，必须逐项说明哪些短板已由 Python-owned runtime 或明确 out-of-scope 替代。
- mojibake 扫描通过。

## 给 worker 的大白话

这是算账，不是冲数字。103 谁真的迁给 Python，谁只是保留给 Node，谁属于外部系统，谁应该从迁移范围剔除，都要写清楚。证据不够就别写 100%。
