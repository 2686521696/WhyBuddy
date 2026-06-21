# 后端 NodeJS 到 Python 迁移：Node route inventory 90

## 执行状态
- 状态：待执行
- 目标：重做 90% 阶段 Node route/core/task/auth/permission/audit/Blueprint/Web AIGC/A2A 盘点，修复 75 阶段 route inventory 的落地失败口径。
- 角色分工：worker 负责盘点文档和证据链接；reviewer 确认没有把参考项目 `tws-ai-ask-python` 当成迁移目标。

### 状态清单
- [ ] 盘点 Node route/core/task/auth/permission/audit/Blueprint/Web AIGC/A2A。
- [ ] 每条路径标注 `node-only`、`contract`、`proxy`、`runtime`、`production-wiring`。
- [ ] 标出仍阻碍 90% 的 route 缺口。
- [ ] gate 全绿。
- [ ] Codex review 确认盘点证据来自当前 repo。

## 目标

75 阶段的 `backend-python-node-route-inventory-75` 曾出现 `HALT_APPLY_FAILED`（补丁落地失败）。90 阶段需要一份可落地、可审查的 route inventory（路由盘点），作为真实分母。

## 允许修改的文件
- `docs/backend-python-node-route-inventory-90.md`
- `agent-loop/tasks/backend-python-node-route-inventory-90.md`

## 禁止扩大范围
- 不修改业务代码。
- 不把 `tws-ai-ask-python` 当作目标实现。
- 不把单一子系统高进度报成整体后端进度。
- 不提交 `.agent-loop` 运行产物。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `nodeRouteInventory90Gates`。

## 成功标准

- 文档按 route/core/task/auth/permission/audit/Blueprint/Web AIGC/A2A 分类列出迁移状态。
- 每类标明 evidence（证据）：测试、任务、代码路径、commit 或仍缺口。
- 明确 `contract/proxy/runtime/production-wiring` 分层。
- mojibake（乱码）扫描通过。
