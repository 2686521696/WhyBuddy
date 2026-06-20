# 后端 NodeJS 到 Python 迁移：auth session contract

## 执行状态
- 状态：待执行
- 目标：为 auth session（认证会话）建立 Python contract，不迁真实登录系统。
- 角色分工：worker 负责契约和测试；reviewer 确认不泄露 cookie/token、不改变生产认证行为。

### 状态清单
- [x] Python 侧有 session validate contract。
- [x] Node auth 测试可验证 Python contract 兼容形状。
- [x] expired、missing、invalid 三类错误稳定。
- [x] gate 全绿。
- [x] Codex review 确认没有真实 token 泄露。

## 目标

auth 是整体后端大分母。要冲 45%，不能只做 SlideRule。这个任务先锁 auth session 的 Python contract，为后续逐步迁移做边界。

## 允许修改的文件
- `tws-ai-slide-rule-python/middlewares/auth.py`
- `tws-ai-slide-rule-python/tests/test_auth_session_contract.py`
- `server/auth/session-service.ts`
- `server/tests/auth-session-python-contract.test.ts`
- `server/tests/auth-session-middleware.test.ts`
- `agent-loop/tasks/backend-python-auth-session-contract.md`

## 禁止扩大范围
- 不改真实登录、注册、密码重置流程。
- 不提交 cookie、token、密钥。
- 不改数据库 schema。
- 不更新总迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `authSessionContractGates`。

## 成功标准

- Python 测试覆盖 valid、expired、missing、invalid session contract。
- Node 测试证明现有 auth session 语义可映射到 Python contract。
- 不泄露真实 token/cookie。
- 所有 gate 通过。
