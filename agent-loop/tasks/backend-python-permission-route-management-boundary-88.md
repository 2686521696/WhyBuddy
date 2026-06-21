# 后端 NodeJS 到 Python 迁移：permission route management boundary 88

## 执行状态
- 状态：待执行
- 目标：补 `/api/permissions` 管理面的 Python boundary 或明确保留 Node-owned，不和 permission check engine 混淆。
- 角色分工：worker 负责 role/policy/token management 的最小边界与测试；reviewer 确认没有放宽权限语义。

### 状态清单
- [x] 明确 permission check engine 与 permission route management 的边界。
- [x] Python boundary 覆盖 role/policy/token 的最小读写或明确 no-op/unsupported 语义。
- [x] Node 测试确认 deny/conflict/error 不变。
- [x] gate 全绿。
- [x] Codex review 确认没有绕过权限检查。

## 目标

permission check engine 已有 runtime 证据，但 `/api/permissions` 管理面、role/policy/token store、dynamic manager、conflict detector 仍大多 Node-owned。本任务只补管理面最小边界或明确保留 Node 所有权，避免把 check-engine runtime 误当完整 permission 迁移。

## 允许修改的文件
- `tws-ai-slide-rule-python/services/permission_management.py`
- `tws-ai-slide-rule-python/tests/test_permission_route_management_boundary.py`
- `tws-ai-slide-rule-python/tests/test_permission_check_runtime_boundary.py`
- `server/routes/permissions.ts`
- `server/permission/management-python-boundary.ts`
- `server/permission/management-python-boundary.test.ts`
- `server/permission/check-engine-python-runtime.test.ts`
- `shared/permission/contracts.ts`
- `agent-loop/tasks/backend-python-permission-route-management-boundary-88.md`

## 禁止扩大范围
- 不改实际权限策略默认值。
- 不绕过 deny、conflict、rate-limit。
- 不改生产 role/policy/token schema。
- 不迁全部 dynamic manager。
- 不提交 `.agent-loop` 运行产物。
- 不更新总迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `permissionRouteManagementBoundary88Gates`。

## 成功标准

- Python/Node 测试覆盖 role/policy/token management 的 supported 或 explicit unsupported envelope。
- deny/conflict/error 不被映射成 success。
- 文档清楚区分 check engine runtime 与 route management boundary。
- gate 全绿。
