# 后端 NodeJS 到 Python 迁移：Blueprint V5 adjacent runtime closure 95

## 执行状态
- 状态：待执行
- 目标：复核 `orchestrate.plan` 周边 Blueprint 能力是否已形成可计入 V5 95% 的邻接 runtime/proxy 闭环。
- 角色分工：worker 负责读取当前 HEAD 的 Blueprint 邻接证据并生成审计表；reviewer 确认没有把整个 Blueprint 大路由、状态机或 event bus 写成已迁完。

### 状态清单
- [x] 读取 `orchestrate.plan`、state projection、spec docs batch、artifact memory、review export 的当前测试和服务路径。
- [x] 生成 `docs/backend-python-blueprint-v5-adjacent-runtime-95.md`。
- [x] 区分可计入 SlideRule V5 95% 的邻接能力和仍属于 Blueprint 大系统缺口的能力。
- [x] 标出后续若要推进整体后端比例时必须拆出的 Blueprint 小切片。
- [x] gate 全绿。
- [x] Codex review 确认没有把 proxy-only 证据误写成完整 runtime。

## 目标

`orchestrate.plan` 已经进入 Python runtime route，但它周边还有一组 Blueprint 邻接能力会影响 SlideRule V5 的真实闭环感。本任务只核这些邻接能力，不迁移完整 `/api/blueprint` 大路由。

重点回答：

- state projection 是否能稳定把 Python plan 输出投射到 Node/Blueprint 可消费结构。
- spec docs batch、artifact memory、review export 是 contract、proxy 还是 bounded runtime。
- 哪些能力可以作为 SlideRule V5 95% 的支撑证据。
- 哪些仍然属于整体 Blueprint migration gap，不能计入 SlideRule V5 95%。

## 允许修改的文件
- `docs/backend-python-blueprint-v5-adjacent-runtime-95.md`
- `agent-loop/tasks/backend-python-blueprint-v5-adjacent-runtime-closure-95.md`

## 允许读取和引用的证据
- `.agent-loop/queue-outcomes.json`
- `agent-loop/tasks/sliderule-python-migration-status.md`
- `docs/backend-python-node-route-inventory-90.md`
- `docs/backend-python-runtime-depth-audit-90.md`
- `tws-ai-slide-rule-python/tests/test_orchestrate_plan_state_projection.py`
- `tws-ai-slide-rule-python/tests/test_blueprint_spec_docs_batch_proxy.py`
- `tws-ai-slide-rule-python/tests/test_blueprint_artifact_memory_proxy.py`
- `tws-ai-slide-rule-python/tests/test_blueprint_review_export_proxy.py`
- `server/routes/__tests__/sliderule.orchestrate-plan-state-projection.test.ts`
- `server/routes/__tests__/blueprint.spec-docs-batch-python-proxy.test.ts`
- `server/routes/__tests__/blueprint.artifact-memory-python-proxy.test.ts`
- `server/routes/__tests__/blueprint.review-export-python-proxy.test.ts`

## 禁止扩大范围
- 不改业务代码。
- 不迁完整 Blueprint state machine、job store、event bus、diagnostics、ledger、preview 或 prompt package。
- 不把 proxy-only 或 contract-only 写成 runtime 完成。
- 不提交 `.agent-loop` 运行产物。
- 不更新整体迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `blueprintV5AdjacentRuntimeClosure95Gates`。

## 成功标准

- 报告列出每条 Blueprint 邻接能力的证据路径、当前层级和是否支撑 SlideRule V5 95%。
- 清楚标出仍阻碍整体后端 90%+ 的 Blueprint 大系统缺口。
- 不把 `orchestrate.plan` 的高完成度外推到整个 Blueprint。
- mojibake 扫描通过。
