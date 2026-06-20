# 后端 NodeJS 到 Python 迁移：permission check contract

## 执行状态
- 状态：待执行
- 目标：为 permission check（权限检查）建立 Python contract，先锁输入输出和拒绝语义。
- 角色分工：worker 负责契约和测试；reviewer 确认不绕过 Node 权限引擎。

### 状态清单
- [x] Python 有 permission check contract。
- [x] Node permission 测试能映射 allow/deny/reason。
- [x] deny 不能被 fallback 成 allow。
- [x] gate 全绿。
- [x] Codex review 确认生产权限仍由 Node 承担。

## 目标

permission 是后端迁移大块。先锁 Python contract，后续再逐步迁 runtime。

## 允许修改的文件
- `tws-ai-slide-rule-python/tests/test_permission_check_contract.py`
- `tws-ai-slide-rule-python/middlewares/auth.py`
- `server/permission/check-engine.ts`
- `server/permission/check-engine.test.ts`
- `server/permission/check-engine-python-contract.test.ts`
- `shared/permission/contracts.ts`
- `agent-loop/tasks/backend-python-permission-check-contract.md`

## 禁止扩大范围
- 不改生产权限策略。
- 不把 deny 改成 allow。
- 不改数据库或组织模型。
- 不提交密钥。
- 不更新总迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `permissionCheckContractGates`。

## 成功标准

- Python 测试覆盖 allow、deny、missing context、invalid policy。
- Node/shared 测试验证 contract 形状和现有 permission check 兼容。
- deny/failure 语义不退化。
- 所有 gate 通过。
