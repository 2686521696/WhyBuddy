# 后端 NodeJS 迁 Python：Auth token/mailer/session cutover 101

## 执行状态
- 状态：待执行
- 目标：继续压缩 Auth 生产链路里的 token issuance、email code/mailer、session repository、password policy Node-owned gap。
- 角色分工：worker 负责 Python auth runtime 与 Node bridge；reviewer 必须确认没有把 mock mailer、内存 session 或 synthetic token 写成真实生产接管。

### 状态清单
- [ ] Python 能输出 token/mailer/session cutover readiness。
- [ ] Node bridge 能消费 readiness，并保留真实 session store、邮件发送、密码策略的边界。
- [ ] login/register、refresh/logout、session persistence 的既有测试继续通过。
- [ ] gate 全绿。
- [ ] review 确认没有绕过安全策略。

## 背景

Auth 在 96/97/100 阶段已经补了 session persistence、refresh/logout、login/register 和 auth-audit closure，但状态表仍然指出生产 persistence、email、policy、external audit 还有 Node-owned gap。101 这一刀只补 token/mailer/session 的 cutover readiness，不假装接管真实外部邮件平台或完整用户仓库。

## 允许修改的文件
- `tws-ai-slide-rule-python/services/auth_token_mailer_session_cutover.py`
- `tws-ai-slide-rule-python/services/auth_audit_production_closure.py`
- `tws-ai-slide-rule-python/services/auth_identity_runtime.py`
- `tws-ai-slide-rule-python/services/auth_session_persistence.py`
- `tws-ai-slide-rule-python/tests/test_auth_token_mailer_session_cutover_101.py`
- `server/routes/auth.ts`
- `server/auth/session-service.ts`
- `server/auth/email-code-service.ts`
- `server/tests/auth-token-mailer-session-cutover-101.test.ts`
- `server/tests/auth-login-register-python-runtime.test.ts`
- `server/tests/auth-session-refresh-logout-python-runtime.test.ts`
- `server/tests/auth-session-production-persistence.test.ts`
- `shared/auth.ts`
- `agent-loop/tasks/backend-python-auth-token-mailer-session-cutover-101.md`

## 禁止扩大范围

- 不重写完整认证系统。
- 不引入真实邮件服务密钥。
- 不提交真实 token、密码、cookie、session dump。
- 不降低 password policy、rate limit、session invalidation 的安全语义。
- 不把 mock/synthetic mailer 写成 production-ready。
- 不删除既有 auth 测试。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `authTokenMailerSessionCutover101Gates`。

## 成功标准

- Python 测试覆盖 token、mailer、session repository 的 ready、blocked、degraded、skipped-live 分类。
- Node 测试确认 auth route 能映射 Python readiness，并保留现有安全失败语义。
- 既有 login/register、refresh/logout、session persistence 测试继续通过。
- 产生真实业务代码 diff，不能以 `HALT_NO_CHANGES` 收口。
- 所有 gate 通过。

## 给 worker 的大白话

认证这块宁可保守。你要补的是“Python 现在能不能接 token、邮件、session 这些生产环节”的判断和桥接，不能用假邮件、假 token、假 session 去骗过迁移进度。
