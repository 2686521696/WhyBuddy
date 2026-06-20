# 后端 NodeJS 到 Python 迁移：permission rate limit contract

## 执行状态
- 状态：待执行
- 目标：为 permission rate limit（权限限流）建立 Python contract。
- 角色分工：worker 负责 contract 和测试；reviewer 确认不削弱现有限流。

### 状态清单
- [x] Python 有 rate limit contract。
- [x] Node rate limiter 测试覆盖 allow/deny/reset。
- [x] deny 不能被 fallback 成 allow。
- [x] gate 全绿。
- [x] Codex review 确认不削弱安全边界。

## 目标

permission 迁移不能只看 check-engine，还要覆盖 rate limiter。这个任务先锁 contract。

## 允许修改的文件
- `tws-ai-slide-rule-python/tests/test_permission_rate_limit_contract.py`
- `server/permission/rate-limiter.ts`
- `server/permission/rate-limiter.test.ts`
- `server/permission/rate-limiter-python-contract.test.ts`
- `shared/permission/contracts.ts`
- `agent-loop/tasks/backend-python-permission-rate-limit-contract.md`

## 禁止扩大范围
- 不削弱限流策略。
- 不改组织/角色模型。
- 不提交运行产物。
- 不更新总迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `permissionRateLimitContractGates`。

## 成功标准

- Python 测试覆盖 allow/deny/reset/retryAfter。
- Node/shared 测试验证 contract 与现有限流兼容。
- deny/failure 语义不退化。
- 所有 gate 通过。
