# SlideRule Python 迁移任务状态

这个文件是给人看的迁移总表，用来回答“哪一片已经执行完、哪一片还没做”。详细机器运行记录仍然放在 `.agent-loop/latest/` 和 `.agent-loop/runs/`，这些目录是运行产物，不提交。

## 分层进度口径

这些比例只用于把范围说清楚，不要把它们混成一个总数。尤其不能把 SlideRule 某条链路的高进度，误报成整个 NodeJS 后端的迁移进度。

| 范围 | 当前判断 | 进度条 | 说明 |
|---|---:|---|---|
| 整体 NodeJS 后端迁 Python | 约 38-44% | `[████░░░░░░]` | 大分母仍是整个 NodeJS backend。本轮已经补上 route inventory、Blueprint proxy/state contract、role runtime proxy、Web AIGC adapters、NL command、workflow、RAG ingestion、telemetry、A2A 等一批 contract/runtime 边界；但 Blueprint/Autopilot 主状态机、auth/admin/audit/permission 全量迁移、executor/tasks、生产部署、真实外部服务接线仍未完成。不能写成 50%。 |
| SlideRule V5 子系统迁移 | 约 90-94% | `[█████████░]` | 对话、审议、结构化报告、delivery chain（交付链）、`outcome.visualize`、`ux.preview`、evidence provenance（证据来源）、runtime config（运行配置）、real vector retrieval smoke/runtime 边界、RAG ingestion、telemetry、A2A 等切片已经成片通过 gate；剩余重点是生产级真实外部依赖、完整 `orchestrate.plan` 主编排迁移、部署观测和长跑稳定性。 |
| SlideRule V5 Node 到 Python 薄代理链路 | 约 97-99% | `[██████████]` | Python mode、delegation helper、timeout（超时）、health check（健康检查）、contract smoke、delivery/visual/artifact capability 白名单、Blueprint proxy 和多条 runtime contract 已比较完整；仍需守住 live smoke、部署配置和非 capability 编排边界。 |
| Python V5 可运行基线 | 约 88-92% | `[█████████░]` | Python 服务、核心 smoke、contract expansion、native LLM capability、vector client、evidence provenance、runtime config、real vector retrieval、RAG ingestion、NL command、workflow、telemetry、A2A contract runtime 都已有测试支撑；真实生产依赖、运行观测和部署策略仍要继续补。 |
| LLM infra 迁移 | 约 58-65% | `[██████░░░░]` | Python `sliderule_llm` 已支撑 chat、JSON hardening、基础 pool、provider/model fallback、telemetry metadata、vector client、stream contract、pool resilience、cost runtime accounting、circuit breaker（熔断）和 multimodal contract（多模态契约）；完整并发、真实生产计费、跨后端观测和 Node 全量 env 细节仍未完全对齐。 |
| 能力覆盖 | 高 | `[█████████░]` | 当前已记录的主要 SlideRule V5 `python-llm` 能力包括对话、审议、report、structure、risk/evidence、delivery chain、`outcome.visualize`、`ux.preview`；未审计或只完成 contract 的边界不能自动视为完整 runtime 迁移。 |

## 最新大白话结论

本轮“冲 50%”队列没有真的把整个 NodeJS 后端推到 50%。更准确的说法是：**整体迁移从 2/3 开头推进到了 4 开头候选区间，当前按约 38-44% 记录**。

这轮最有价值的成果不是“百分比好看”，而是把一批之前模糊的深水区边界变硬了：

- Web AIGC search/file/vision/audio adapter（搜索/文件/视觉/音频适配器）有了 Python contract 和 Node contract test。
- NL command runtime（自然语言命令运行时）、workflow runtime（工作流运行时）、RAG ingestion runtime（RAG 摄取运行时）、telemetry route（观测路由）、A2A runtime（A2A 运行时）都有了 contract-only 或 fake-runtime 边界。
- Node 侧 safe failure（安全失败）和 status/provenance（状态/来源）字段更清楚，避免把 failed/cancelled/unavailable 伪装成 completed/success。
- 这些切片都在主仓库应用 patch 后重新跑过对应 gate，并按独立 commit 提交。

## 本轮 50% 候选队列结果

| 任务 | 结果 | 说明 |
|---|---|---|
| `backend-python-node-route-inventory-50` | 完成 | 新增 Node route inventory 文档。 |
| `backend-python-blueprint-main-state-contract` | 完成 | Blueprint main state Python contract + Node/shared test。 |
| `backend-python-blueprint-job-runtime-proxy` | 完成 | Blueprint job runtime proxy contract。 |
| `backend-python-blueprint-stage-edit-proxy-contract` | 完成 | Blueprint stage edit validate/preview contract。 |
| `backend-python-role-runtime-proxy-contract` | 完成 | Role runtime proxy contract，并处理敏感信息扫描假阳性。 |
| `backend-python-web-aigc-node-adapter-inventory` | 完成 | Web AIGC Node adapter inventory 文档。 |
| `backend-python-web-aigc-search-adapter-contract` | 完成 | Web/graph/image/static page search adapter contract。 |
| `backend-python-web-aigc-file-adapter-contract` | 完成 | File generation/slicing/translation/excel/long-text contract。 |
| `backend-python-web-aigc-vision-audio-adapter-contract` | 完成 | OCR/audio/vision/voice fake contract 和稳定字段。 |
| `backend-python-nl-command-runtime-contract` | 完成 | NL command analyze/clarify/plan/approval/report contract。 |
| `backend-python-workflow-runtime-contract` | 完成 | Workflow graph/run/node_result/error contract。 |
| `backend-python-rag-ingestion-runtime-contract` | 完成 | RAG ingest/chunk/embed/upsert/delete/error contract。 |
| `backend-python-telemetry-route-contract` | 完成 | telemetry/cost/monitoring contract，区分 synthetic/estimated/actual。 |
| `backend-python-a2a-runtime-contract` | 完成 | A2A invoke/stream/cancel/list agents contract。 |
| `backend-python-migration-status-refresh-50` | 人工接管完成 | 自动 review 因无有效 diff 卡住；本文件按真实提交证据人工刷新。 |

## 本轮提交记录

这些 commit 是本轮已经落主仓库的可审查切片：

- `2b72291f docs(agent-loop): record backend route migration inventory`
- `6401a688 feat(backend-python): add blueprint main state contract`
- `b027fa1f feat(backend-python): add blueprint job runtime proxy`
- `b159bfea feat(backend-python): add blueprint stage edit proxy contract`
- `f3cb105e feat(backend-python): add role runtime proxy contract`
- `5d51a88c docs(agent-loop): inventory web aigc node adapters`
- `f087edc5 feat(backend-python): add web aigc search adapter contract`
- `6f3a6b17 feat(backend-python): add web aigc file adapter contract`
- `e097c095 feat(backend-python): add web aigc vision audio contract`
- `31e1cf85 feat(backend-python): add nl command runtime contract`
- `e433b2cd feat(backend-python): add workflow runtime contract`
- `1a6e16c7 feat(backend-python): add rag ingestion runtime contract`
- `fe0b0a51 feat(backend-python): add telemetry route contract`
- `3eca0bd4 feat(backend-python): add a2a runtime contract`

## 已知边界

- contract（契约）完成不等于 runtime（运行时）全量完成。
- fake runtime（假运行时）完成不等于生产真实外部依赖已接线。
- safe failure（安全失败）完成不等于业务成功路径已完全迁移。
- Web AIGC、A2A、RAG、workflow、telemetry 这批切片给的是更硬的边界和测试，不是“整个 Node 后端已经迁完”。
- `tws-ai-ask-python` 只是参考项目，不是迁移目标；迁移目标仍然是从 NodeJS backend 到本仓库的 Python 侧实现和 Node proxy/contract 表面。

## 当前迁移原则

`agent-loop` 可以用于 NodeJS 到 Python 迁移，但定位应该是：

> NodeJS 到 Python 迁移的切片执行器、gate runner、自动修复工作单元。

不要把它当成：

> 一键把整个 Node 后端迁到 Python 的全自动迁移器。

适合交给 AgentLoop 的单位：

- 一个 endpoint。
- 一个 `capabilityId`。
- 一个 Node 到 Python delegation 白名单扩展。
- 一个 Python parity test。
- 一个 live smoke gate。
- 一个数据、密钥、运行产物清理任务。

不适合交给 AgentLoop 的任务：

- 一次迁整个 NodeJS 后端。
- 一次迁多个无关子系统。
- 同时改业务逻辑、部署策略、密钥配置和 UI。
- 没有明确 allowed files、gate、成功标准的开放式迁移。

## 下一步建议

下一步如果继续冲 50%，不要再堆“看起来很大”的迁移口号，而是把已经锁住的 contract 往真实 runtime 推：

| 顺序 | 建议任务 | 目标 |
|---|---|---|
| 1 | real vector retrieval production wiring | 把 smoke 推进到真实 vector store 接线、fallback 和 provenance 运行时。 |
| 2 | RAG ingestion production storage | 把 fake/upsert contract 接到真实 storage/vector pipeline。 |
| 3 | Web AIGC adapter runtime bridge | 让 search/file/vision/audio adapter 从 contract-only 走向真实 Python runtime 桥。 |
| 4 | A2A runtime bridge | 先接 invoke/cancel/list agents 的真实 Python 路径，不碰复杂 stream 长链路。 |
| 5 | workflow runtime staged execution | 先迁 graph validation 和 node_result 投影，再迁真实执行。 |
| 6 | telemetry production sink | 把 synthetic/estimated/actual contract 接到真实观测存储，继续防止伪造 actual。 |
| 7 | auth/admin/audit/permission inventory | 开始从 SlideRule 子系统外扩到全后端大块。 |

## 状态规则

- `[x]`：已经实现并通过当前记录的 gate 或 live 验证。
- `[ ]`：还没有迁移，或没有足够验证证据。
- `provenance="python-llm"`：Python 真 LLM 输出，不是旧 RAG 罐头。
- `provenance="python-contract"`：Python contract/fake runtime 输出，不等于生产真实 runtime。
- `provenance="python-rag"`：仍走旧 Python mapped/RAG 路径，后续需要按能力逐片替换。

## 提交前检查

- [ ] 只暂存本次任务相关文件，绝不使用 `git add -A`。
- [ ] 不暂存 `.agent-loop/`、`.tmp/`、`probes/`、`.env`、日志、缓存、`tws-ai-slide-rule-python/data/`。
- [ ] 不提交真实密钥、数据库密码、Qdrant key、Bearer token。
- [ ] 如果只改文档，至少跑 `node agent-loop/src/check-mojibake.js agent-loop/tasks/...`。
- [ ] 如果改代码，重新跑对应 Python、Node、TypeScript gate。
