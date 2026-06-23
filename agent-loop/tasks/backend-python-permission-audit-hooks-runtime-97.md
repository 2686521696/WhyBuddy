# 后端 NodeJS 到 Python 迁移：Permission audit hooks runtime 97

## 执行状态

- 状态：待执行
- 目标：把 permission check 后的 audit hooks、policy decision provenance 和 denial logging 推进到 Python runtime boundary。
- 角色分工：worker 负责 Python permission audit hooks runtime、Node permission/audit bridge 和测试；reviewer 确认没有绕过 permission engine 或 audit chain。

### 状态清单

- [ ] Python runtime 支持 allowed/denied/approval_required/error 的 audit hook envelope。
- [ ] Node permission/audit hook 能映射 Python result，并保留 actor、resource、action、policy、risk metadata。
- [ ] denied/error 不伪装成 allowed。
- [ ] gate 全绿。
- [ ] Codex review 确认 permission policy 和 audit chain 没有被弱化。

## 目标

89/96 阶段已有 permission rate-limit、permission check、audit event/sink/retention/export 的小切片，但 permission audit hooks 仍是生产链路缺口。这个任务只迁 hook boundary：决策来源、拒绝原因、audit entry、error visibility。

## 允许修改的文件

- `tws-ai-slide-rule-python/services/permission_management.py`
- `tws-ai-slide-rule-python/services/permission_audit_hooks.py`
- `tws-ai-slide-rule-python/tests/test_permission_audit_hooks_runtime.py`
- `tws-ai-slide-rule-python/tests/test_permission_check_runtime_boundary.py`
- `server/permission/check-engine.ts`
- `server/permission/audit-logger.ts`
- `server/permission/policy-store.ts`
- `server/audit/audit-hooks.ts`
- `server/audit/audit-collector.ts`
- `server/tests/permission-audit-hooks-python-runtime.test.ts`
- `server/tests/permission-governance-audit-routes.test.ts`
- `server/tests/permission-mcp-checker-wiring.test.ts`
- `shared/permission/contracts.ts`
- `shared/audit/contracts.ts`
- `agent-loop/tasks/backend-python-permission-audit-hooks-runtime-97.md`

## 禁止扩大范围

- 不重写完整 permission policy store、role store 或 governance UI。
- 不绕过 deny、approval_required、rate limit 或 MCP checker。
- 不接真实外部 audit platform、SIEM、APM 或 billing。
- 不提交真实用户/权限/audit 数据。
- 不提交 `.agent-loop` 运行产物。
- 不更新整体迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `permissionAuditHooksRuntime97Gates`。

## 成功标准

- Python 测试覆盖 allow/deny/approval_required/error audit hook。
- Node 测试确认 permission engine 和 audit logger 能记录 Python hook result。
- 现有 permission governance/audit route 测试继续通过。
- 产生真实业务代码 diff，不能以 `HALT_NO_CHANGES` 收口。
- 所有 gate 通过。
