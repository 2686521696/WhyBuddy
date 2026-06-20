# SlideRule Python 迁移任务状态

这个文件是给人看的迁移总表，用来回答“哪一片已经执行完、哪一片还没做”。详细机器运行记录仍然放在 `.agent-loop/latest/` 和 `.agent-loop/runs/`，这些目录是运行产物，不提交。

## 分层进度口径

这些比例只用于把范围说清楚，不要把它们混成一个总数。尤其不能把 SlideRule 某条链路的高进度，误报成整个 NodeJS 后端的迁移进度。

| 范围 | 当前判断 | 进度条 | 说明 |
|---|---:|---|---|
| 整体 NodeJS 后端迁 Python | 约 48-54% 候选区间 | `[█████░░░░░]` | 大分母仍是整个 NodeJS backend。本轮新增或复核了 production/runtime bridge、auth/session、permission、audit、admin、Blueprint agent crew/brainstorm 等一批边界；但 task executor、knowledge admin 本轮只是 baseline gate 已绿且无新 diff，Blueprint/Autopilot 主状态机、auth/admin/audit/permission 全量迁移、executor/tasks、生产部署、真实外部服务接线仍未完成。不能写成“已经 60%”。 |
| SlideRule V5 子系统迁移 | 约 92-95% | `[█████████░]` | 对话、审议、结构化报告、delivery chain（交付链）、`outcome.visualize`、`ux.preview`、evidence provenance（证据来源）、runtime config（运行配置）、real vector retrieval（真实向量检索）、RAG ingestion（RAG 摄取）、telemetry（观测）、A2A 等切片已经成片通过 gate；剩余重点是生产级真实外部依赖、完整 `orchestrate.plan` 主编排迁移、部署观测和长跑稳定性。 |
| SlideRule V5 Node 到 Python 薄代理链路 | 约 97-99% | `[██████████]` | Python mode、delegation helper、timeout（超时）、health check（健康检查）、contract smoke、delivery/visual/artifact capability 白名单、Blueprint proxy 和多条 runtime contract 已比较完整；仍需守住 live smoke、部署配置和非 capability 编排边界。 |
| Python V5 可运行基线 | 约 90-93% | `[█████████░]` | Python 服务、核心 smoke、contract expansion、native LLM capability、vector client、evidence provenance、runtime config、real vector retrieval、RAG ingestion、NL command、workflow、telemetry、A2A contract runtime 都已有测试支撑；真实生产依赖、运行观测和部署策略仍要继续补。 |
| LLM infra 迁移 | 约 58-65% | `[██████░░░░]` | Python `sliderule_llm` 已支撑 chat、JSON hardening、基础 pool、provider/model fallback、telemetry metadata、vector client、stream contract、pool resilience、cost runtime accounting、circuit breaker（熔断）和 multimodal contract（多模态契约）；完整并发、真实生产计费、跨后端观测和 Node 全量 env 细节仍未完全对齐。 |
| 能力覆盖 | 高 | `[█████████░]` | 当前已记录的主要 SlideRule V5 `python-llm` 能力包括对话、审议、report、structure、risk/evidence、delivery chain、`outcome.visualize`、`ux.preview`；未审计或只完成 contract 的边界不能自动视为完整 runtime 迁移。 |

## 最新大白话结论

本轮“冲 60%”队列推进了一批真实切片，但还不能写成“整体已经 60%”。更准确的说法是：**整体 NodeJS 后端迁 Python 从 38-44% 推进到约 48-54% 候选区间**。

这次最有价值的不是把数字写好看，而是把几类硬边界继续往前推了：

- A2A invoke/list/cancel runtime bridge（运行时桥）已经落到 Python + Node proxy，并且不把 failed/cancelled 伪装成 completed。
- RAG ingestion production storage（RAG 生产存储）和 real vector retrieval（真实向量检索）比之前更接近真实运行链路。
- Web AIGC search runtime bridge（搜索运行时桥）从 adapter contract 往 runtime bridge 走了一步。
- auth/session、permission、audit、admin、Blueprint agent crew/brainstorm 等后端大块开始被切成可审查、可测试的小片。
- `task-executor-proxy-contract` 和 `knowledge-admin-proxy-contract` 本轮是 `HALT_NO_CHANGES`：baseline gate 绿，但没有新交付 diff，所以不能按“本轮新增完成”计算。

## 本轮 60% 候选队列结果

| 任务 | 结果 | 说明 |
|---|---|---|
| `backend-python-a2a-invoke-runtime-bridge` | 完成 | A2A invoke/list/cancel bridge 已落地，stream 长链路仍未迁。 |
| `backend-python-rag-ingestion-production-storage` | 完成 | RAG ingestion 从 contract/fake 继续推进到 production storage boundary。 |
| `backend-python-web-aigc-search-runtime-bridge` | 完成 | Web AIGC search adapter 从 contract 推进到 runtime bridge。 |
| `backend-python-auth-session-runtime-boundary` | 完成 | auth/session runtime boundary 已复核并标记 reviewed。 |
| `backend-python-permission-check-runtime-boundary` | 完成 | permission check runtime boundary 已落地。 |
| `backend-python-audit-query-proxy-boundary` | 完成 | audit query proxy boundary 已落地。 |
| `backend-python-admin-route-contract` | 完成 | admin route contract 队列结果为 `DONE_REVIEWED`，任务文档已标记。 |
| `backend-python-task-executor-proxy-contract` | 未按新增交付计入 | 队列结果为 `HALT_NO_CHANGES`，baseline gate 绿但本轮无新 diff。 |
| `backend-python-executor-callback-contract` | 完成 | executor callback contract 队列结果为 `DONE_REVIEWED`，任务文档已标记。 |
| `backend-python-knowledge-admin-proxy-contract` | 未按新增交付计入 | 队列结果为 `HALT_NO_CHANGES`，baseline gate 绿但本轮无新 diff。 |
| `backend-python-blueprint-agent-crew-proxy-contract` | 完成 | Blueprint agent crew proxy contract 队列结果为 `DONE_REVIEWED`，任务文档已标记。 |
| `backend-python-blueprint-brainstorm-contract` | 完成 | 自动 review 中途卡过一次，已人工应用有效 diff、重跑 gate，并单独提交。 |
| `backend-python-migration-status-refresh-60` | 当前执行 | 只刷新真实进度，不把候选目标写成已完成事实。 |

## 本轮提交记录

这些 commit 是已经落到主仓库的可审查切片：

- `7e34c2a9 feat(backend-python): add a2a invoke runtime bridge`
- `36a6a4c5 feat(backend-python): add rag ingestion production storage boundary`
- `3a7791c9 feat(backend-python): add web aigc search runtime bridge`
- `eed3e73b feat(agent-loop): guide grok on missing gate files`
- `be1fcf0a chore(agent-loop): use codex for migration queue fixes`
- `68088d21 docs(agent-loop): mark auth and telemetry runtime tasks reviewed`
- `61097ed0 feat(backend-python): add permission check runtime boundary`
- `f43a65ee docs(agent-loop): mark permission and audit runtime tasks reviewed`
- `8bb89e91 feat(backend-python): add audit query proxy boundary`
- `b8f21ec6 docs(agent-loop): mark admin executor and agent crew tasks reviewed`
- `314bdfc2 feat(backend-python): harden blueprint brainstorm contract fields`
- `83970d23 docs(agent-loop): mark blueprint brainstorm contract reviewed`

## 已知边界

- contract（契约）完成不等于 runtime（运行时）全量完成。
- runtime bridge（运行时桥）完成不等于 production wiring（生产接线）完成。
- fake runtime（假运行时）完成不等于真实外部依赖已经接好。
- safe failure（安全失败）完成不等于业务成功路径已经完全迁移。
- `HALT_NO_CHANGES` 只能说明本轮没有有效新增 diff，不能自动算作一个新迁移切片完成。
- `tws-ai-ask-python` 只是参考项目，不是迁移目标；迁移目标仍然是本仓库 NodeJS backend 到 Python 侧实现和 Node proxy/contract 表面。

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

如果下一阶段继续往 60% 以上推进，建议优先补这几类“真分母”：

| 顺序 | 建议任务 | 目标 |
|---|---|---|
| 1 | task executor proxy/runtime | 把本轮 `HALT_NO_CHANGES` 的 executor/tasks 大块拆成真实可落地切片。 |
| 2 | knowledge admin proxy/runtime | 把本轮 `HALT_NO_CHANGES` 的 knowledge admin 从 baseline 绿推进到真实新增交付。 |
| 3 | Blueprint/Autopilot main state runtime | 继续迁主状态机，不只停在单个 contract/proxy。 |
| 4 | auth/admin/audit/permission 深化 | 现有边界已经起步，下一步要扩大到真实读写、权限组合和错误恢复。 |
| 5 | production external service wiring | 把 vector/RAG/A2A/Web AIGC 的真实外部服务、fallback、provenance 和观测串起来。 |
| 6 | deployment/live smoke | 把 Python 服务部署配置、健康检查、超时、回退和长跑稳定性纳入 gate。 |

## 状态规则

- `[x]`：已经实现并通过当前记录的 gate 或 live 验证。
- `[ ]`：还没有迁移，或没有足够验证证据。
- `provenance="python-llm"`：Python 真 LLM 输出，不是旧 RAG 罐头。
- `provenance="python-contract"`：Python contract/fake runtime 输出，不等于生产真实 runtime。
- `provenance="python-rag"`：仍走旧 Python mapped/RAG 路径，后续需要按能力逐片替换。

## 提交前检查

- [ ] 只暂存本次任务相关文件，绝不使用 `git add -A`。
- [ ] 不暂存 `.agent-loop/`、`.tmp/`、`.probes/`、`.env`、日志、缓存、`tws-ai-slide-rule-python/data/`。
- [ ] 不提交真实密钥、数据库密码、Qdrant key、Bearer token。
- [ ] 如果只改文档，至少跑 `node agent-loop/src/check-mojibake.js agent-loop/tasks/...`。
- [ ] 如果改代码，重新跑对应 Python、Node、TypeScript gate。
