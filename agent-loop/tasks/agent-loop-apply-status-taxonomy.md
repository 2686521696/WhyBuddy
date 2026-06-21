# AgentLoop: apply status taxonomy

## 执行状态
- 状态：待执行
- 目标：把 apply（应用补丁）阶段的错误从泛化 `HALT_APPLY_FAILED`（停止：应用补丁失败）拆成可诊断状态，避免把 no diff（无差异）和 patch conflict（补丁冲突）误报成 crash（崩溃）。
- 角色分工：worker（执行工人）负责状态分类、测试和最小 UI/summary 文案；reviewer（审查者）确认不降低证据链严格度。

### 状态清单
- [ ] `DONE_REVIEWED`（已审查完成）但没有 `diff.N.patch` 时，队列结果显示为 `DONE_REVIEWED_NO_DIFF`（已审查完成但无新增差异），不计为 crashed（崩溃）。
- [ ] `patch does not apply`（补丁无法应用）和 `already exists in working directory`（工作区已存在）归类为 `APPLY_CONFLICT`（应用冲突），并保留冲突文件/错误文本。
- [ ] `HALT_APPLY_FAILED`（停止：应用补丁失败）只保留给无法细分的 apply（应用补丁）失败。
- [ ] `queue-outcomes.json`（队列结果汇总）和 run summary（运行摘要）能携带 `applyStatus`、`applyErrorKind`、`applyErrorFiles`。
- [ ] gate（门禁测试）全绿。
- [ ] Codex review（Codex 审查）确认没有把真实失败刷绿。

## 背景

当前批量迁移队列出现大量 `ERR`（错误）/`HALT_APPLY_FAILED`（停止：应用补丁失败），但其中一大类只是 `DONE_REVIEWED`（已审查完成）后没有 `diff.N.patch`，另一类是主仓库已有部分文件导致 `git apply --check` 冲突。这些都不应该被 UI（界面）统一显示成 crash（崩溃）。

## 允许修改的文件
- `agent-loop/src/loopApply.js`
- `agent-loop/src/runQueue.js`
- `agent-loop/src/runSummary.js`
- `agent-loop/src/queueOutcomes.js`
- `agent-loop/test/loopApply.test.js`
- `agent-loop/test/run-queue.test.js`
- `agent-loop/test/runSummary.test.js`
- `agent-loop/test/vscode-extension.test.js`
- `agent-loop/tasks/agent-loop-apply-status-taxonomy.md`

## 禁止扩大范围
- 不实现 queue-level worktree（队列级隔离工作树），那是后续任务。
- 不改后端迁移业务代码。
- 不自动提交 `.agent-loop/` 运行产物。
- 不把 apply conflict（应用冲突）当成成功。
- 不改变已有 gate（门禁测试）的语义。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `agentLoopApplyStatusTaxonomyGates`。

## 成功标准

- 单测覆盖 no diff patch（无差异补丁）时输出 `DONE_REVIEWED_NO_DIFF`。
- 单测覆盖 patch conflict（补丁冲突）时输出 `APPLY_CONFLICT` 和冲突文件。
- `HALT_APPLY_FAILED` 不再用于 `no diff.N.patch found`。
- queue summary（队列摘要）中 `crashed` 数量不包含 no-diff reviewed（已审查但无新增差异）。
- mojibake gate（乱码门禁）通过。
