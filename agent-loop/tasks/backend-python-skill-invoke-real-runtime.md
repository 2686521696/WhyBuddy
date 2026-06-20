# 后端 NodeJS 到 Python 迁移：skill.invoke real runtime

## 执行状态
- 状态：待执行
- 目标：把 `skill.invoke` 从 fake runtime smoke（假运行时冒烟）推进到可插拔 skill runtime（技能运行时）边界。
- 角色分工：worker 负责 Python runtime adapter 和测试；reviewer 确认没有执行任意本地命令或绕过权限。

### 状态清单
- [x] Python 有 skill runtime adapter（技能运行时适配器）接口。
- [x] 测试覆盖 success、not found、denied、runtime error。
- [x] 结果保留 skill id、runtime、provenance 和错误分类。
- [x] gate 全绿。
- [x] Codex review 确认没有任意命令执行风险。

## 目标

`skill.invoke` 现在已有 contract 和 smoke。这个任务要把它推进成可替换 adapter，而不是把测试里的 fake 逻辑写死在 executor 里。

## 允许修改的文件
- `tws-ai-slide-rule-python/services/capability_maps.py`
- `tws-ai-slide-rule-python/services/slide_rule_executor.py`
- `tws-ai-slide-rule-python/services/skill_runtime.py`
- `tws-ai-slide-rule-python/tests/test_skill_invoke_real_runtime.py`
- `tws-ai-slide-rule-python/tests/test_skill_invoke_runtime_smoke.py`
- `agent-loop/tasks/backend-python-skill-invoke-real-runtime.md`

## 禁止扩大范围
- 不执行真实本地 shell 命令。
- 不新增真实外部服务依赖。
- 不改 Node skill.invoke 实现。
- 不提交密钥或运行产物。
- 不更新总迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `skillInvokeRealRuntimeGates`。

## 成功标准

- Python 测试可注入 fake skill adapter 并覆盖成功、缺失、拒绝、错误。
- runtime response 不丢 skill id / runtime / provenance。
- 旧 contract/smoke 测试继续通过。
- 所有 gate 通过。
