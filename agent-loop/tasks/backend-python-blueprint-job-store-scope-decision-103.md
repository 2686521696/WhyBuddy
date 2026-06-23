# 后端 NodeJS 迁 Python：Blueprint job store scope decision 103

## 执行状态

- 状态：待执行
- 目标：把 Blueprint 的 job store / event bus / ledger / replan / prompt package 这些最后卡住 100% 的面，拆成可验证的 `python-owned`、`node-retained`、`external-owned` 或 `out-of-scope`。如果能安全推进，补最小 Python-owned job state boundary；如果不能迁，就写成明确的 scope exclusion，不再把它伪装成迁移缺口。
- 角色分工：worker 负责 Python decision service、Node bridge 消费和测试；reviewer 必须确认没有把 Node 平台壳、状态机壳、队列壳误报为 Python 生产接管。

### 状态清单

- [ ] 读取 100/101/102 的 Blueprint runtime / cutover / ownership 证据。
- [ ] 明确 job store、event bus、ledger、replan、prompt package、preview state 的归属。
- [ ] 若存在可迁移小闭环，补 Python-owned runtime slice 和 Node thin bridge。
- [ ] 若仍应由 Node 保留，产出可测试的 retained / out-of-scope decision。
- [ ] gate 全绿。
- [ ] review 确认没有虚写 Blueprint 主系统 100%。

## 背景

102 已经证明 Blueprint 主生产面仍有大量 `node-retained`。103 不再做泛泛状态刷新，而是专门处理 job store 这一类“到底是不是迁移范围”的分母问题。结论必须能被代码和测试消费，不能只写在 markdown 里。

## 允许修改的文件

- `tws-ai-slide-rule-python/services/blueprint_job_store_scope_decision.py`
- `tws-ai-slide-rule-python/services/blueprint_production_ownership_closure.py`
- `tws-ai-slide-rule-python/services/blueprint_shell_state_cutover.py`
- `tws-ai-slide-rule-python/services/blueprint_job_runtime.py`
- `tws-ai-slide-rule-python/tests/test_blueprint_job_store_scope_decision_103.py`
- `tws-ai-slide-rule-python/tests/test_blueprint_production_ownership_closure_102.py`
- `server/routes/blueprint/job-store-scope-decision-python.ts`
- `server/routes/blueprint/production-ownership-closure-python.ts`
- `server/routes/blueprint/jobs/service.ts`
- `server/routes/blueprint/event-bus.ts`
- `server/routes/__tests__/blueprint.job-store-scope-decision-103.test.ts`
- `server/routes/__tests__/blueprint.production-ownership-closure-102.test.ts`
- `shared/blueprint/jobs/types.ts`
- `shared/blueprint/agent-events.ts`
- `agent-loop/tasks/backend-python-blueprint-job-store-scope-decision-103.md`

## 禁止扩大范围

- 不重写完整 `/api/blueprint`。
- 不迁移真实生产 job store、event bus、ledger、replan，除非测试证明 Python 真的接管该最小闭环。
- 不把 `node-retained`、`external-owned`、`out-of-scope` 写成 `python-owned`。
- 不把 readiness、decision、docs-only 算成业务迁移完成。
- 不提交 `.agent-loop`、`.worktrees`、日志、缓存或真实用户数据。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `blueprintJobStoreScopeDecision103Gates`。

## 成功标准

- Python service 返回稳定的 scope decision envelope，至少包含 `area`、`ownership`、`productionTakeover`、`migrationDenominator`、`reason`、`evidence`。
- Node bridge 能消费 decision，并断言 `node-retained` / `out-of-scope` 不等于 Python takeover。
- 至少一个最小可迁移 job-state slice 被标记为 `python-owned`，或者明确说明为什么全部仍是 `node-retained/out-of-scope`。
- 产生真实代码 diff；如果最终只有文档变化，任务应失败。
- 所有 gate 通过。

## 给 worker 的大白话

别再冲“Blueprint 100%”这个数字。你要把 job store 这块说死：能交给 Python，就拿代码和测试接住；不能交，就写成系统可读的 retained/out-of-scope，后面算进度时从分母里处理，而不是继续吊着。
