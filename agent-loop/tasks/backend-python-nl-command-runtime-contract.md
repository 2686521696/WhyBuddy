# 后端 NodeJS 到 Python 迁移：NL command runtime contract

## 执行状态
- 状态：待执行
- 目标：为 `server/core/nl-command` 建立 Python runtime contract，锁定 analyze/plan/approve/report 基本形状。
- 角色分工：worker 负责 contract；reviewer 确认不迁完整任务执行系统。

### 状态清单
- [x] Python 侧有 NL command runtime contract。
- [x] Node 侧测试覆盖 analyze/clarify/plan/report。
- [x] permission guard 和 audit 字段不丢。
- [x] gate 全绿。
- [x] Codex review 确认没有执行真实命令。

## 目标

NL command 是 Node 后端核心编排能力之一。此任务只建立 Python contract，让后续能逐步迁移。

## 允许修改的文件
- `agent-loop/tasks/backend-python-nl-command-runtime-contract.md`
- `tws-ai-slide-rule-python/services/nl_command_runtime.py`
- `tws-ai-slide-rule-python/tests/test_nl_command_runtime_contract.py`
- `server/core/nl-command/**/*.ts`
- `server/routes/__tests__/nl-command-python-runtime-contract.test.ts`
- `shared/nl-command/*.ts`

## 禁止扩大范围
- 不执行真实命令。
- 不改权限策略。
- 不迁完整 mission/task 系统。
- 不改 UI。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `nlCommandRuntimeContractGates`。

## 成功标准

- Python contract 表达 analyze、clarify、plan、approval、report 五类结果。
- Node 测试确认 denied 不能 fallback 成 allowed。
- audit/permission 字段保留。
- gate 全绿。
