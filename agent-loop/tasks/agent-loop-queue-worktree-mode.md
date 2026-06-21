# AgentLoop: queue worktree mode

## 执行状态
- 状态：待执行
- 目标：新增 queue-level worktree（队列级隔离工作树）模式，让一次 run-queue（运行队列）使用一个 worktree（隔离工作树）顺序执行多个 task（任务），最后统一 landing（落地）到 main（主仓库）。
- 角色分工：worker（执行工人）负责 queue worktree（队列工作树）、checkpoint（检查点）和回滚逻辑；reviewer（审查者）确认不会把失败任务的 diff（差异补丁）混入最终落地。

### 状态清单
- [ ] `migration-queue.json`（迁移队列配置）支持 `worktreeScope: "task" | "queue"`。
- [ ] `worktreeScope: "queue"` 时，整条队列只创建一个 queue worktree（队列级隔离工作树）。
- [ ] 每个 task（任务）运行前创建 checkpoint（检查点），成功后保留改动，失败后回滚到上一个 checkpoint。
- [ ] 队列结束后生成 queue patch（队列补丁）或 landing summary（落地摘要），不再对每个 task 单独 `git apply`。
- [ ] main（主仓库）有未提交 diff（差异）时，队列启动前进入 `DIRTY_MAIN_NEEDS_COMMIT`（主仓库有未提交改动，需要先提交），不继续跑。
- [ ] gate（门禁测试）全绿。
- [ ] Codex review（Codex 审查）确认 task 失败不会污染后续 task。

## 背景

当前 per-task worktree（单任务隔离工作树）模式在批量迁移中会反复把每个 task diff 应用回 main，导致 `patch does not apply`（补丁无法应用）、`already exists in working directory`（工作区已存在）和 task checklist（任务清单）冲突。迁移队列天然是递进式施工线，后续 task 应该能看到前序成功 task 的结果。

## 允许修改的文件
- `agent-loop/scripts/run-queue.mjs`
- `agent-loop/src/runQueue.js`
- `agent-loop/src/worktree.js`
- `agent-loop/src/loopApply.js`
- `agent-loop/src/queueOutcomes.js`
- `agent-loop/src/runQueueProgress.js`
- `agent-loop/test/run-queue.test.js`
- `agent-loop/test/worktree.test.js`
- `agent-loop/test/loopApply.test.js`
- `agent-loop/test/runQueueProgress.test.js`
- `agent-loop/scripts/migration-queue.json`
- `agent-loop/tasks/agent-loop-queue-worktree-mode.md`

## 禁止扩大范围
- 不迁移任何 NodeJS 后端业务功能。
- 不重写 loop engine（循环引擎）的 agent 调用流程。
- 不删除 task-level worktree（单任务隔离工作树）兼容模式。
- 不在失败 task 后保留其业务 diff。
- 不自动 commit（提交）到 main（主仓库）。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `agentLoopQueueWorktreeModeGates`。

## 成功标准

- `worktreeScope: "queue"` 的测试证明 3 个 task 只创建 1 个 worktree。
- 成功 task 的 diff 被保留给后续 task。
- 失败 task 会回滚到前一个 checkpoint，不污染后续 task。
- dirty main（主仓库有未提交改动）会在队列开始前停止。
- task-level worktree（单任务隔离工作树）原有测试仍通过。
- mojibake gate（乱码门禁）通过。
