# 后端 NodeJS 到 Python 迁移：Production external live smoke 97

## 执行状态

- 状态：待执行
- 目标：为真实外部依赖补可配置、可跳过、可诊断的 live smoke，不把 missing config 或 fake smoke 写成生产接管。
- 角色分工：worker 负责 Python/Node live smoke diagnostics、safe skip 语义和测试；reviewer 确认没有提交密钥、没有强制访问外网、没有夸大生产成熟度。

### 状态清单

- [x] Python live smoke 能区分 ready/skipped/config_missing/failed，并输出 provider、reason、duration metadata。
- [x] Node live smoke 能映射 Python diagnostics，并保留 Qdrant、embedding、search、OCR、vision、audio、APM、billing、audit platform 的分类。
- [x] 缺少 env/config 时必须 skip，不得失败或伪装 healthy。
- [x] gate 全绿。
- [x] Codex review 确认没有真实密钥或外部服务副作用。

## 目标

95/96 阶段已经有 production wiring smoke，但真实外部依赖仍未证明。这个任务不强制跑真实服务，只补一个生产可用的诊断框架：有配置就检查，无配置就清楚地 skip；所有结果都必须能说明为什么不能计入真实 production takeover。

## 允许修改的文件

- `tws-ai-slide-rule-python/services/external_dependency_live_smoke.py`
- `tws-ai-slide-rule-python/tests/test_external_dependency_live_smoke_97.py`
- `tws-ai-slide-rule-python/tests/test_deployment_live_smoke_boundary.py`
- `tws-ai-slide-rule-python/tests/test_real_vector_retrieval_production_wiring.py`
- `server/routes/__tests__/python-external-dependency-live-smoke.test.ts`
- `server/routes/__tests__/python-deployment-live-smoke.test.ts`
- `server/rag/store/qdrant-adapter.ts`
- `server/rag/embedding/embedding-provider.ts`
- `server/core/web-aigc-runtime-observability.ts`
- `shared/telemetry/contracts.ts`
- `agent-loop/tasks/backend-python-production-external-live-smoke-97.md`

## 禁止扩大范围

- 不提交 `.env`、API key、Bearer token、数据库密码、Qdrant key 或真实用户数据。
- 不默认访问真实外网；只有显式 env/config 存在时才允许做只读 smoke。
- 不写入真实 Qdrant、APM、billing、audit platform 或外部 provider。
- 不把 skipped/config_missing 写成 healthy。
- 不提交 `.agent-loop` 运行产物。
- 不更新整体迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `productionExternalLiveSmoke97Gates`。

## 成功标准

- Python 测试覆盖 ready、skipped、config_missing、timeout、failed diagnostics。
- Node 测试确认 live smoke result 能被 dashboard/status 层消费，且 skipped 不计入 production takeover。
- 现有 deployment/vector/observability smoke 测试继续通过。
- 产生真实业务代码 diff，不能以 `HALT_NO_CHANGES` 收口。
- 所有 gate 通过。
