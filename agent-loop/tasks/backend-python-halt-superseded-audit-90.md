# 后端 NodeJS 到 Python 迁移：HALT superseded audit 90

## 执行状态
- 状态：待执行
- 目标：清算历史 `HALT_HUMAN`（需人工接管）和 `HALT_NO_CHANGES`（无有效新增改动）任务，判断哪些已被后续任务覆盖、哪些仍是真缺口。
- 角色分工：worker 负责读取当前 queue outcomes（队列结果）、task 文档、commit（提交）证据并写审计报告；reviewer 确认没有把旧红灯误算为完成。

### 状态清单
- [ ] 列出当前 `backend-python-*` 的 `HALT_HUMAN`、`HALT_NO_CHANGES`、`HALT_APPLY_FAILED`。
- [ ] 每个旧红灯标注 `superseded`（已被覆盖）、`still-open`（仍缺）、`split-needed`（需拆小）或 `docs-only`（仅文档/盘点）。
- [ ] 对被标记为 `superseded` 的项给出后续 task、commit 或测试证据。
- [ ] gate 全绿。
- [ ] Codex review 确认没有更新总迁移百分比。

## 目标

把 70-74% 候选区间推进到 90% 前，先解决一个根问题：面板里的旧红灯到底是真失败，还是已经被后续任务覆盖。这个任务只做证据清算，不写业务代码。

## 允许修改的文件
- `docs/backend-python-halt-superseded-audit-90.md`
- `agent-loop/tasks/backend-python-halt-superseded-audit-90.md`

## 禁止扩大范围
- 不修改业务代码。
- 不修改 `sliderule-python-migration-status.md` 的百分比。
- 不把 `DONE_REVIEWED`（已审查完成）但无 commit/测试证据的任务直接算完成。
- 不提交 `.agent-loop` 运行产物。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `haltSupersededAudit90Gates`。

## 成功标准

- 审计报告覆盖所有当前旧红灯和 no-diff 项。
- 每项都有明确分类和证据路径。
- 明确哪些缺口会进入后续 90% 任务。
- mojibake（乱码）扫描通过。
