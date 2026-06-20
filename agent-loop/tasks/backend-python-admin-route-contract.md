# 后端 NodeJS 到 Python 迁移：admin route contract

## 执行状态
- 状态：待执行
- 目标：为 admin route（管理接口）建立 Python contract，先锁安全边界和响应形状。
- 角色分工：worker 负责 contract 和测试；reviewer 确认不改变真实 admin 权限。

### 状态清单
- [x] Python 有 admin contract。
- [x] Node admin route 测试能映射 success/forbidden/error。
- [x] forbidden 不能 fallback 成 success。
- [x] gate 全绿。
- [x] Codex review 确认不泄露管理数据。

## 目标

admin 是整体后端大分母。这个任务只建立 contract，不迁真实 admin 功能。

## 允许修改的文件
- `tws-ai-slide-rule-python/tests/test_admin_route_contract.py`
- `server/routes/admin.ts`
- `server/tests/admin-routes.test.ts`
- `server/tests/admin-python-contract.test.ts`
- `agent-loop/tasks/backend-python-admin-route-contract.md`

## 禁止扩大范围
- 不改真实 admin 权限。
- 不导出真实用户数据。
- 不改数据库 schema。
- 不更新总迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `adminRouteContractGates`。

## 成功标准

- Python 测试覆盖 success/forbidden/error contract。
- Node 测试证明 admin route 可映射 Python contract。
- forbidden/error 语义不退化。
- 所有 gate 通过。
