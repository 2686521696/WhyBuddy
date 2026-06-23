# 后端 NodeJS 到 Python 迁移：Auth login/register runtime 97

## 执行状态

- 状态：待执行
- 目标：在 refresh/logout/session persistence 之后，把 login/register/email code 的最小认证运行时推进到 Python boundary，不迁真实用户系统。
- 角色分工：worker 负责 Python auth identity runtime、Node auth route bridge 和测试；reviewer 确认密码、token、邮件码和 session 语义没有被绕过。

### 状态清单

- [ ] Python runtime 支持 register/login/email-code verify/session-issued/denied/error envelope。
- [ ] Node auth route 能调用 Python runtime，并保留现有 password/email/session metadata。
- [ ] denied/invalid/expired 不伪装成 authenticated。
- [ ] gate 全绿。
- [ ] Codex review 确认没有引入真实邮件、真实用户库或不安全 token 签发。

## 目标

96 阶段补了 refresh/logout 和 session persistence，但注册、登录、邮件码仍是整体 Auth 分母。这个任务只做 bounded runtime：输入输出、校验、错误、session issuance envelope 稳定；生产用户库和真实邮件服务仍保留为后续任务。

## 允许修改的文件

- `tws-ai-slide-rule-python/services/auth_session_persistence.py`
- `tws-ai-slide-rule-python/services/auth_identity_runtime.py`
- `tws-ai-slide-rule-python/tests/test_auth_login_register_runtime.py`
- `tws-ai-slide-rule-python/tests/test_auth_session_refresh_logout_runtime.py`
- `server/routes/auth.ts`
- `server/auth/session-service.ts`
- `server/auth/email-code-service.ts`
- `server/auth/email-mailer.ts`
- `server/auth/password.ts`
- `server/auth/types.ts`
- `server/tests/auth-login-register-python-runtime.test.ts`
- `server/tests/auth-session-refresh-logout-python-runtime.test.ts`
- `server/tests/auth-session-production-persistence.test.ts`
- `shared/auth.ts`
- `agent-loop/tasks/backend-python-auth-login-register-runtime-97.md`

## 禁止扩大范围

- 不接真实 SMTP、短信、OAuth、第三方登录或生产用户数据库。
- 不提交真实密码、token、验证码或用户数据。
- 不降低密码校验、session expiry、email code expiry 或 audit 语义。
- 不删除现有 auth/session 测试。
- 不提交 `.agent-loop` 运行产物。
- 不更新整体迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `authLoginRegisterRuntime97Gates`。

## 成功标准

- Python 测试覆盖 register/login/email-code success、invalid credentials、expired code、session issuance、error。
- Node 测试确认 `/api/auth` 相关路径能映射 Python result，且 invalid 不会 fallback 成 authenticated。
- 现有 refresh/logout/session persistence 测试继续通过。
- 产生真实业务代码 diff，不能以 `HALT_NO_CHANGES` 收口。
- 所有 gate 通过。
