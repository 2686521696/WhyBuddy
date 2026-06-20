# 后端 NodeJS 到 Python 迁移：auth session runtime boundary

## 执行状态
- 状态：待执行
- 目标：把 auth session（认证会话）从 contract 推进到 runtime boundary（运行时边界），不迁真实登录系统。
- 角色分工：worker 负责 Python runtime boundary 和测试；reviewer 确认不泄露 cookie/token、不改变生产认证行为。

### 状态清单
- [ ] Python session runtime boundary 覆盖 valid、expired、missing、invalid。
- [ ] Node middleware test 可映射 Python session result。
- [ ] deny/invalid 不 fallback 成 authenticated。
- [ ] gate 全绿。
- [ ] Codex review 确认没有真实 token 泄露。

## 目标

auth 是整体后端大分母。这个任务只推进 session validation 的 runtime boundary，不迁登录、注册、密码重置或真实 token 签发。

## 允许修改的文件
- `tws-ai-slide-rule-python/middlewares/auth.py`
- `tws-ai-slide-rule-python/tests/test_auth_session_runtime_boundary.py`
- `tws-ai-slide-rule-python/tests/test_auth_session_contract.py`
- `server/auth/session-service.ts`
- `server/tests/auth-session-runtime-boundary.test.ts`
- `server/tests/auth-session-python-contract.test.ts`
- `server/tests/auth-session-middleware.test.ts`
- `agent-loop/tasks/backend-python-auth-session-runtime-boundary.md`

## 禁止扩大范围
- 不改真实登录、注册、密码重置流程。
- 不提交 cookie、token、密钥。
- 不改数据库 schema。
- 不把 invalid session 当作 authenticated。
- 不更新总迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `authSessionRuntimeBoundaryGates`。

## 成功标准

- Python 测试覆盖 valid、expired、missing、invalid。
- Node 测试证明 middleware 可以映射 Python session result。
- invalid/expired 语义不退化。
- 所有 gate 通过。
