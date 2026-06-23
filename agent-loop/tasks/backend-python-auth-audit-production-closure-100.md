# 后端 NodeJS 到 Python 迁移：Auth/Audit production closure 100

## 执行状态

- 状态：已完成（人工 rescue 后门禁已绿）
- 目标：把 Auth（认证）、Permission（权限）和 Audit（审计）的最后生产闭环补成 Python 可审计 runtime/production boundary（生产边界），为整体 100% 候选收口提供证据。
- 角色分工：worker 负责 Python closure runtime、Node bridge 和测试；reviewer 重点检查是否误报真实邮件服务、真实用户库、外部审计平台已经全部迁完。

### 状态清单

- [x] Python closure runtime 覆盖 register、login、email code、session issue/refresh/logout、permission decision、audit hook、retention/export 的组合摘要。
- [x] Node auth/audit/permission 层能消费 Python closure summary，并保留 password、email、session、policy、risk、audit metadata。
- [x] config missing、external platform missing、degraded 必须清楚区分，不能写成 healthy。
- [x] gate 全绿。
- [x] Codex review 确认没有提交密钥、没有真实外部副作用、没有虚高生产成熟度。

### 救回验证

- 原队列结果：`HALT_NO_PROGRESS` / rescue patch。
- 人工修复：ready 路径显式传入临时 session store，避免把缺少配置误判成 closure 失败；保留 `subEnvelopes`。
- Python gate：`34 passed, 1 warning`。
- Node/Vitest gate：`6 passed` test files / `26 passed` tests。

## 目标

97 阶段已经补了 auth login/register 和 permission audit hooks，但真实生产链路仍包括邮件码、session repository、password policy、token issue、permission policy orchestration、audit anomaly/compliance、retention/export 和外部 audit platform 等混合边界。本任务只做可审计 closure summary：Python 负责给出统一 runtime/production posture（姿态），Node 保留当前仍属于 Node 的具体存储和传输边界。

## 允许修改的文件

- `tws-ai-slide-rule-python/services/auth_audit_production_closure.py`
- `tws-ai-slide-rule-python/services/auth_identity_runtime.py`
- `tws-ai-slide-rule-python/services/auth_session_persistence.py`
- `tws-ai-slide-rule-python/services/permission_audit_hooks.py`
- `tws-ai-slide-rule-python/services/permission_management.py`
- `tws-ai-slide-rule-python/services/audit_retention_export.py`
- `tws-ai-slide-rule-python/services/audit_sink.py`
- `tws-ai-slide-rule-python/tests/test_auth_audit_production_closure_100.py`
- `server/tests/auth-audit-production-closure-100.test.ts`
- `server/routes/auth.ts`
- `server/auth/session-service.ts`
- `server/auth/email-code-service.ts`
- `server/auth/email-mailer.ts`
- `server/permission/check-engine.ts`
- `server/permission/audit-logger.ts`
- `server/audit/audit-hooks.ts`
- `server/routes/audit.ts`
- `shared/auth.ts`
- `shared/permission/contracts.ts`
- `shared/audit/contracts.ts`
- `agent-loop/tasks/backend-python-auth-audit-production-closure-100.md`

## 禁止扩大范围

- 不提交真实 SMTP、数据库、Qdrant、Bearer token、API key 或 `.env`。
- 不强制访问外部邮件服务、外部 audit platform 或真实用户库。
- 不降低密码、session、permission、audit 的安全语义。
- 不把 skipped/config_missing 写成 healthy。
- 不删除既有 auth/audit/permission 测试。
- 不在本任务直接刷新整体迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `authAuditProductionClosure100Gates`。

## 成功标准

- Python 测试覆盖 ready、config_missing、degraded、denied、external_missing、failed。
- Node 测试确认 Auth/Audit/Permission closure summary 能被路由和 service 层消费。
- 既有 login/register、refresh/logout、permission audit hooks、audit retention/export 测试继续通过。
- 产生真实业务代码 diff，不能以 `HALT_NO_CHANGES` 收口。
- 所有 gate 通过。
