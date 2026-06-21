# 后端 NodeJS 到 Python 迁移：Node route inventory 75

## 执行状态
- 状态：待执行
- 目标：更新 Node route/core/task/auth/permission/audit 的迁移盘点，为 75% 候选阶段提供证据，不直接改业务代码。
- 角色分工：worker 负责盘点文档和证据链接；reviewer 确认没有把参考项目 `tws-ai-ask-python` 当成迁移目标。

### 状态清单
- [x] 盘点 `server/routes`、`server/core`、`server/tasks`、`server/auth`、`server/permission`、`server/audit`。
- [x] 明确已迁、proxy、contract、runtime、仍在 Node 的分类。
- [x] 写入 `docs/backend-python-node-route-inventory-75.md`。
- [x] gate 全绿。
- [x] Codex review 确认盘点证据来自当前 repo。

## 目标

上一轮用户已纠正：迁移目标是当前 NodeJS 后端服务改造为 Python 项目，`tws-ai-ask-python` 只是参考。这个任务用 route inventory 防止后续进度口径漂移。

## 允许修改的文件
- `docs/backend-python-node-route-inventory-75.md`
- `agent-loop/tasks/backend-python-node-route-inventory-75.md`

## 禁止扩大范围
- 不修改业务代码。
- 不把 `tws-ai-ask-python` 当作目标实现。
- 不把单一子系统高进度报成整体后端进度。
- 不提交 `.agent-loop` 运行产物。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `nodeRouteInventory75Gates`。

## 成功标准

- 文档按 route/core/task/auth/permission/audit 分类列出迁移状态。
- 每类标明 evidence：测试、任务、代码路径或仍缺口。
- 明确 `tws-ai-ask-python` 只作为参考，不计入迁移完成度。
- mojibake gate 通过。
