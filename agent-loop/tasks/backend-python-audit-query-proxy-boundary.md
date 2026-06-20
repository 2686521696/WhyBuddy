# 后端 NodeJS 到 Python 迁移：audit query proxy boundary

## 执行状态
- 状态：待执行
- 目标：为 audit query（审计查询）建立 Python proxy boundary，不迁真实审计存储。
- 角色分工：worker 负责 proxy boundary 和测试；reviewer 确认不泄露审计数据。

### 状态清单
- [ ] Python proxy boundary 覆盖 query/list/filter/error。
- [ ] Node audit query route test 能映射 Python result。
- [ ] forbidden/error 不伪装成 empty success。
- [ ] gate 全绿。
- [ ] Codex review 确认没有真实审计数据泄露。

## 目标

audit query 是 audit event 之后的下一片。这个任务只锁查询 envelope、分页、过滤和错误语义，不迁真实 audit store。

## 允许修改的文件
- `tws-ai-slide-rule-python/tests/test_audit_query_proxy_boundary.py`
- `tws-ai-slide-rule-python/tests/test_audit_query_proxy_contract.py`
- `server/routes/audit.ts`
- `server/tests/audit-query-python-boundary.test.ts`
- `server/tests/audit-query-python-proxy.test.ts`
- `server/tests/audit-query.test.ts`
- `shared/audit/contracts.ts`
- `agent-loop/tasks/backend-python-audit-query-proxy-boundary.md`

## 禁止扩大范围
- 不迁真实 audit store。
- 不导出真实审计数据。
- 不改权限策略。
- 不提交运行产物。
- 不更新总迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `auditQueryProxyBoundaryGates`。

## 成功标准

- Python 测试覆盖 query/list/filter/error。
- Node 测试确认 forbidden/error 不伪装成 empty success。
- pagination/filter 字段稳定。
- 所有 gate 通过。
