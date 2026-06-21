# 后端 NodeJS 到 Python 迁移：Auth permission audit runtime 90

## 执行状态
- 状态：待执行
- 目标：把 auth/session、permission check、rate limit、audit event 从 contract/boundary 推到可计入 90% 的 runtime 证据层。
- 角色分工：worker 负责最小 runtime 边界和测试；reviewer 确认不改生产 schema、不放宽权限语义。

### 状态清单
- [ ] auth/session runtime boundary 有明确 Python mode 行为。
- [ ] permission check 和 rate limit runtime boundary 保留 deny/error 语义。
- [ ] audit event runtime boundary 保留 envelope、actor、action、error 字段。
- [ ] gate 全绿。
- [ ] Codex review 确认没有把安全失败伪装成成功。

## 目标

auth、permission、audit 是后端迁移的大分母。90% 阶段需要让这些边界至少具备可测试 runtime（运行时）语义，而不是只停在 contract（契约）层。

## 允许修改的文件
- `tws-ai-slide-rule-python/tests/test_auth_session_runtime_boundary.py`
- `tws-ai-slide-rule-python/tests/test_auth_session_contract.py`
- `tws-ai-slide-rule-python/tests/test_permission_check_runtime_boundary.py`
- `tws-ai-slide-rule-python/tests/test_permission_check_contract.py`
- `tws-ai-slide-rule-python/tests/test_permission_rate_limit_runtime_boundary.py`
- `tws-ai-slide-rule-python/tests/test_permission_rate_limit_contract.py`
- `tws-ai-slide-rule-python/tests/test_audit_event_runtime_boundary.py`
- `tws-ai-slide-rule-python/tests/test_audit_event_contract.py`
- `server/tests/auth-session-runtime-boundary.test.ts`
- `server/tests/auth-session-python-contract.test.ts`
- `server/permission/check-engine-python-runtime.test.ts`
- `server/permission/check-engine-python-contract.test.ts`
- `server/permission/rate-limiter-python-runtime.test.ts`
- `server/permission/rate-limiter-python-contract.test.ts`
- `server/tests/audit-event-python-runtime.test.ts`
- `server/tests/audit-event-python-contract.test.ts`
- `shared/permission/contracts.ts`
- `shared/audit/contracts.ts`
- `agent-loop/tasks/backend-python-auth-permission-audit-runtime-90.md`

## 禁止扩大范围
- 不改生产数据库 schema。
- 不接真实 IAM、OAuth provider 或外部审计平台。
- 不放宽 deny、rate-limit、audit failure 语义。
- 不提交 `.agent-loop` 运行产物。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `authPermissionAuditRuntime90Gates`。

## 成功标准

- Python 和 Node 测试覆盖 auth/session、permission check、rate limit、audit event runtime boundary。
- deny/error/timeout 不被映射成成功。
- contract 字段稳定，可被后续生产接线复用。
- 所有 gate 通过。
