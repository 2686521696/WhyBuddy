# 后端 NodeJS 到 Python 迁移：permission rate limit runtime boundary

## 执行状态
- 状态：待执行
- 目标：为 permission rate limit（权限限流）建立 Python runtime boundary，单独锁住限流语义。
- 角色分工：worker 负责 runtime boundary 和测试；reviewer 确认不放宽限流。

### 状态清单
- [ ] Python runtime boundary 覆盖 allowed、limited、reset、invalid key。
- [ ] Node rate limiter test 能映射 Python result。
- [ ] limited 不 fallback 成 allowed。
- [ ] gate 全绿。
- [ ] Codex review 确认没有绕过限流。

## 目标

rate limit（限流）不要和 permission check 混在一个任务里。这个任务只锁住限流输入输出和错误语义。

## 允许修改的文件
- `tws-ai-slide-rule-python/tests/test_permission_rate_limit_runtime_boundary.py`
- `tws-ai-slide-rule-python/tests/test_permission_rate_limit_contract.py`
- `server/permission/rate-limiter.ts`
- `server/permission/rate-limiter-python-runtime.test.ts`
- `server/permission/rate-limiter-python-contract.test.ts`
- `server/permission/rate-limiter.test.ts`
- `shared/permission/contracts.ts`
- `agent-loop/tasks/backend-python-permission-rate-limit-runtime-boundary.md`

## 禁止扩大范围
- 不放宽生产限流策略。
- 不改组织/用户模型。
- 不提交真实用户标识或 token。
- 不更新总迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `permissionRateLimitRuntimeBoundaryGates`。

## 成功标准

- Python 测试覆盖 allowed、limited、reset、invalid key。
- Node/shared 测试验证 limited 不伪装成 allowed。
- reset/retry-after 字段稳定。
- 所有 gate 通过。
