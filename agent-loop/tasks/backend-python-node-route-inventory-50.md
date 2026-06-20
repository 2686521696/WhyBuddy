# 后端 NodeJS 到 Python 迁移：Node route inventory for 50%

## 执行状态
- 状态：待执行
- 目标：盘点 `server/`、`shared/` 中仍由 NodeJS 承担的后端服务大块，为冲 50% 的下一批迁移任务排序。
- 角色分工：worker 只做盘点和文档，不改业务代码；reviewer 确认没有把 `tws-ai-ask-python` 当迁移目标。

### 状态清单
- [x] 列出 NodeJS 源头大块：Blueprint/Autopilot、role runtime、web-aigc adapters、NL command、workflow、RAG、telemetry。
- [x] 给每块标出源文件、目标 Python 位置、建议 gate。
- [x] 明确 `tws-ai-ask-python` 只能作为 Python 结构参考。
- [x] mojibake gate 通过。
- [x] Codex review 确认没有改业务代码。

## 目标

这不是迁移实现任务，而是下一波 50% 任务的源头盘点。必须从 NodeJS 后端源头出发：`server/routes`、`server/core`、`shared`。不能从 `tws-ai-ask-python/routes` 反推迁移范围。

## 允许修改的文件
- `agent-loop/tasks/backend-python-node-route-inventory-50.md`
- `docs/backend-python-node-route-inventory-50.md`

## 禁止扩大范围
- 不改 `server/`、`shared/`、`tws-ai-slide-rule-python/` 代码。
- 不把参考项目 `tws-ai-ask-python` 写成迁移目标。
- 不修改其它 task checklist。
- 不提交 `.agent-loop/` 运行产物。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `nodeRouteInventory50Gates`。

## 成功标准

- 产出一份清晰盘点，至少覆盖 6 个 NodeJS 后端大块。
- 每个大块都列出 source（源头）、Python target（目标）、risk（风险）和 suggested gates（建议门禁）。
- 文档明确写出 50% 是候选目标，不能提前宣称已达成。
- 文档通过 mojibake 检查。
