# 后端 NodeJS 到 Python 迁移：audit query proxy contract

## 执行状态
- 状态：待执行
- 目标：为 audit query（审计查询）建立 Python proxy contract，不迁真实审计存储。
- 角色分工：worker 负责 contract 和测试；reviewer 确认不破坏审计权限和分页语义。

### 状态清单
- [x] Python 有 audit query contract。
- [x] Node audit query 测试覆盖 filter/page/error。
- [x] 权限失败和空结果形状稳定。
- [x] gate 全绿。
- [x] Codex review 确认不导出真实审计数据。

## 目标

audit event contract 只锁写入形状。这个任务锁查询形状，为后续 audit 子系统迁移铺路。

## 允许修改的文件
- `tws-ai-slide-rule-python/tests/test_audit_query_proxy_contract.py`
- `server/audit/audit-query.ts`
- `server/tests/audit-query.test.ts`
- `server/tests/audit-query-python-proxy.test.ts`
- `shared/audit/contracts.ts`
- `agent-loop/tasks/backend-python-audit-query-proxy-contract.md`

## 禁止扩大范围
- 不迁真实 audit store。
- 不导出真实数据。
- 不改权限策略。
- 不更新总迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `auditQueryProxyContractGates`。

## 成功标准

- Python 测试覆盖 filter/page/empty/forbidden/error。
- Node/shared 测试验证 query contract 与现有 audit query 兼容。
- forbidden 不能伪装空结果。
- 所有 gate 通过。
