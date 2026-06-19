# 后端 NodeJS 到 Python 迁移：skill.invoke runtime contract

## 执行状态

- 状态：已完成
- 目标：在 skill.invoke boundary audit（边界审计）之后，补 runtime contract（运行时契约），仍不直接接生产 skill registry
- 角色分工：Grok 负责补契约测试；Codex 负责审查是否把 fake skill invoke 说成真实运行时

### 状态清单

- [x] 已执行 AgentLoop
- [x] contract test 覆盖 skillName/provenance/error shape
- [x] 明确当前 fallback 不是 fake/real skill registry
- [x] 没有接生产 skill registry
- [x] gate 全绿
- [x] Codex review（审查）已确认没有把 fallback 当成真实 skill runtime

## 目标

当前审计已经确认 `skill.invoke` 不是真实 skill runtime。下一步先锁 contract：输入字段、成功 provenance、skill not found、registry unavailable、fallback/degraded 的表达。

这个任务为后续桥接 Node `SkillRegistryDependency` 或 Python skill client 做准备。

## 允许修改的文件

- `tws-ai-slide-rule-python/tests/test_skill_invoke_contract.py`
- `tws-ai-slide-rule-python/services/capability_maps.py`
- `tws-ai-slide-rule-python/services/slide_rule_executor.py`
- `server/routes/__tests__/sliderule.skill-invoke-contract.test.ts`
- `docs/backend-python-skill-invoke-boundary-audit.md`
- `agent-loop/tasks/backend-python-skill-invoke-contract.md`

## 禁止扩大范围

- 不接生产 skill registry。
- 不改 Blueprint role-agent runtime 主链路。
- 不改权限系统。
- 不把 fake registry 说成 production runtime。
- 不更新全局迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `skillInvokeContractGates`。

## 成功标准

- Python contract test 覆盖成功、skill not found、registry unavailable 三类 shape。
- Node contract test 确认不会把 fallback 误标为 real skill runtime。
- provenance 区分 `python-rag`、`skill:*` 和 degraded。
- 所有 gate 通过。
