# SlideRule Python native capability audit

## 执行状态

- 状态：已完成 — native capability 矩阵已落地到 docs
- 目标：审计 SlideRule V5 当前 capability（能力）到底哪些是 Python native LLM，哪些仍是 fallback / mapped / 未审计
- 前置：batch-3 delivery chain 已完成

- 最近执行：2026-06-19
- 最近确认：2026-06-19
- 执行方式：Codex 直接审计，不发 live LLM，不迁新 capability
- 审计报告：`docs/sliderule-python-native-capability-audit.md`
- gate 结果：`nativeAuditGates` 全绿

### 状态清单

- [x] 已执行本地审计
- [x] capability registry（能力注册表）审计完成
- [x] Node delegation（Node 委托）白名单与 Python native 列表一致性已检查
- [x] 未迁/未审计能力清单已写入报告
- [x] gate 全绿
- [x] 人工 review（审查）已确认 diff 干净

## 目标

做一次事实审计，不新增业务能力。输出一份清楚的能力矩阵：capabilityId、Python 是否 native、Node 是否委托、provenance、测试覆盖、剩余风险。

## 允许修改的文件

- `agent-loop/tasks/sliderule-python-native-capability-audit.md`
- `agent-loop/tasks/sliderule-python-migration-status.md`
- `docs/sliderule-python-native-capability-audit.md`
- `tws-ai-slide-rule-python/tests/test_capabilities.py`（仅当需要补只读审计断言）
- `server/routes/__tests__/sliderule.execute-capability.test.ts`（仅当需要补只读委托断言）

## 禁止扩大范围

- 不迁新 capability。
- 不改 prompt。
- 不改 Node/Python 业务实现，除非测试暴露明显登记错误且范围很小。
- 不提交 `.agent-loop/` 运行产物。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `nativeAuditGates`。

## 成功标准

- 审计报告列出已迁、未迁、未审计三类能力。
- 文档和当前代码事实一致。
- mojibake（乱码）检查通过。
- 如补了测试，相关 Python/Node gate 必须全绿。
