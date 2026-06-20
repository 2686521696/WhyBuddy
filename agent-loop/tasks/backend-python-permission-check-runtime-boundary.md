# 后端 NodeJS 到 Python 迁移：permission check runtime boundary

## 执行状态
- 状态：待执行
- 目标：把 permission check（权限检查）从 contract 推进到 Python runtime boundary。
- 角色分工：worker 负责 runtime boundary 和测试；reviewer 确认不绕过 Node 权限引擎。

### 状态清单
- [ ] Python runtime boundary 覆盖 allow、deny、missing context、invalid policy。
- [ ] Node permission engine test 能映射 Python result。
- [ ] deny/failure 不 fallback 成 allow。
- [ ] gate 全绿。
- [ ] Codex review 确认生产权限语义不退化。

## 目标

这个任务不是全面替换权限系统。只把 permission check 的输入、输出、原因码和 failure 语义做成可运行边界。

## 允许修改的文件
- `tws-ai-slide-rule-python/middlewares/auth.py`
- `tws-ai-slide-rule-python/tests/test_permission_check_runtime_boundary.py`
- `tws-ai-slide-rule-python/tests/test_permission_check_contract.py`
- `server/permission/check-engine.ts`
- `server/permission/check-engine-python-runtime.test.ts`
- `server/permission/check-engine-python-contract.test.ts`
- `server/permission/check-engine.test.ts`
- `shared/permission/contracts.ts`
- `agent-loop/tasks/backend-python-permission-check-runtime-boundary.md`

## 禁止扩大范围
- 不改生产权限策略。
- 不把 deny 改成 allow。
- 不改数据库或组织模型。
- 不提交密钥。
- 不更新总迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `permissionCheckRuntimeBoundaryGates`。

## 成功标准

- Python 测试覆盖 allow、deny、missing context、invalid policy。
- Node/shared 测试验证 runtime boundary 和现有 permission check 兼容。
- deny/failure 语义不退化。
- 所有 gate 通过。
