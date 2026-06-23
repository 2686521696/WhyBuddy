# 后端 NodeJS 迁 Python：Auth session token boundary 103

## 执行状态

- 状态：待执行
- 目标：把 Auth 的 session repository / token issuance / password policy / mailer 边界拆清楚。能迁的补 Python-owned session/token boundary；不能迁的明确 Node-retained 或 out-of-scope。
- 角色分工：worker 负责 Python boundary service、Node auth bridge 和测试；reviewer 必须确认没有把 login/register readiness 写成生产 session/token 接管。

### 状态清单

- [ ] 读取 88/96/97/100/101/102 Auth 证据。
- [ ] 明确 session repository、token issuance、email mailer、password policy、user repository 的归属。
- [ ] 补最小 Python-owned session/token boundary，或产出 retained/out-of-scope decision。
- [ ] Node auth 测试覆盖 session/token 路径。
- [ ] gate 全绿。
- [ ] review 确认没有虚写 Auth 生产链路 100%。

## 背景

102 结论是 auth 生产组件大多仍 `node-retained`。103 不追“登录接口看着能跑”，而是追 session/token 的所有权：真实由 Python 判断，还是 Node 壳继续持有。

## 允许修改的文件

- `tws-ai-slide-rule-python/services/auth_session_token_boundary.py`
- `tws-ai-slide-rule-python/services/auth_production_ownership_closure.py`
- `tws-ai-slide-rule-python/services/auth_token_mailer_session_cutover.py`
- `tws-ai-slide-rule-python/services/auth_identity_runtime.py`
- `tws-ai-slide-rule-python/services/auth_session_persistence.py`
- `tws-ai-slide-rule-python/tests/test_auth_session_token_boundary_103.py`
- `tws-ai-slide-rule-python/tests/test_auth_production_ownership_closure_102.py`
- `server/routes/auth.ts`
- `server/auth/session-service.ts`
- `server/auth/email-code-service.ts`
- `server/auth/email-mailer.ts`
- `server/auth/password.ts`
- `server/auth/types.ts`
- `server/tests/auth-session-token-boundary-103.test.ts`
- `server/tests/auth-production-ownership-closure-102.test.ts`
- `server/tests/auth-login-register-python-runtime.test.ts`
- `server/tests/auth-session-refresh-logout-python-runtime.test.ts`
- `server/tests/auth-session-production-persistence.test.ts`
- `shared/auth.ts`
- `agent-loop/tasks/backend-python-auth-session-token-boundary-103.md`

## 禁止扩大范围

- 不重写完整 auth 系统。
- 不碰真实密钥、用户数据、生产 token secret。
- 不把 mock login/register 当成 session repository 或 token issuance 接管。
- 不把 email/password/session 的 Node retained 决策写成 Python-owned。
- 不提交 `.agent-loop`、`.worktrees`、日志、缓存或真实用户数据。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `authSessionTokenBoundary103Gates`。

## 成功标准

- Python service 明确 session/token/password/email/user repository 的 ownership。
- Node bridge 能消费该 ownership，并在 retained 时保持原 Node 生产路径。
- 至少一个 session/token 校验或 decision path 有 Python-owned runtime 证据，或者明确标为 retained/out-of-scope。
- 产生真实代码 diff；如果最终只有文档变化，任务应失败。
- 所有 gate 通过。

## 给 worker 的大白话

Auth 这块别看“登录能跑”就算迁完。你要盯 session 和 token：谁发、谁验、谁存。Python 真接了就拿测试证明；没接就明牌 Node retained。
