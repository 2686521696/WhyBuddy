# SlideRule Python 迁移任务状态

这个文件是给人看的迁移总表，用来回答“哪一片已经执行完、哪一片还没做”。详细机器运行记录仍然放在 `.agent-loop/latest/` 和 `.agent-loop/runs/`，这些目录是运行产物，不提交。

## 关键状态词对照

| 关键词 | 中文含义 | 计入口径 |
|---|---|---|
| `DONE_REVIEWED` | 已审查完成 | 只有能对应当前仓库代码、测试或 commit（提交）证据时，才计入完成。 |
| `HALT_NO_CHANGES` | 停止：无有效新增改动 | baseline gate（基线门禁）可能已绿，但本轮没有新 diff（差异补丁），不能按新增迁移切片计入。 |
| `HALT_APPLY_FAILED` | 停止：应用补丁失败 | run（运行）本身可能已 review（审查）通过，但 worktree（隔离工作树）diff 没有成功落回主仓库，不能计入完成。 |
| `HALT_HUMAN` | 停止：需要人工接管 | agent（代理）超时、审查 blocked（阻塞）或证据不足，需要人工判断。 |
| `DONE_REVIEWED_NO_DIFF` | 已审查完成但无新 diff | 建议中的更细状态；用于区分“已有能力复核通过”和“本轮新增交付”。 |
| `APPLY_CONFLICT` | 应用冲突 | 建议中的更细状态；用于区分 patch（补丁）冲突和业务代码失败。 |
| `gate` | 门禁测试 | 包括 Python pytest、Node/Vitest、TypeScript、mojibake（乱码）扫描等必跑检查。 |
| `queue outcomes` | 队列结果汇总 | 比单个 final report（最终报告）更接近批量队列最终状态。 |
| `worktree` | 隔离工作树 | AgentLoop 每个任务的临时改代码目录；通过后还要把 diff 应用回主仓库。 |
| `contract` | 契约 | 输入输出、错误语义和 envelope（信封结构）稳定，不等于真实生产运行。 |
| `runtime bridge` | 运行时桥 | Node 能把一个有边界的运行时操作委托给 Python。 |
| `proxy` | 代理 | Node 仍保留路由/入口，只把部分能力转发给 Python。 |
| `production wiring` | 生产接线 | 接入稳定存储、真实服务、观测、fallback（回退）和部署边界。 |

## 分层进度口径

这些比例只用于把范围说清楚，不要把它们混成一个总数。尤其不能把 SlideRule 某条链路的高进度，误报成整个 NodeJS 后端的迁移进度。

| 范围 | 当前判断 | 进度条 | 说明 |
|---|---:|---|---|
| 整体 NodeJS 后端迁 Python | 约 70-74% 候选区间，75% 接近但尚未坐实 | `[███████░░░]` | 大分母仍是整个 NodeJS backend（后端）。当前 `.agent-loop/queue-outcomes.json` 里 `backend-python-*` 共 79 项，其中 59 项 outcome（结果）为 `done`（完成），58 项 status（状态）为 `DONE_REVIEWED`（已审查完成），比上一版 50-56% 明显推进。但仍有 16 项 `HALT_HUMAN`（需人工接管）、3 项 `HALT_NO_CHANGES`（无有效新增改动）、1 项 `HALT_APPLY_FAILED`（补丁落地失败），且部分 `DONE_REVIEWED` 是 contract/proxy（契约/代理）或 maturity（成熟度）支撑，不等于所有业务 runtime（运行时）完成，所以还不能写死 75%。 |
| SlideRule V5 子系统迁移 | 约 94-96% | `[█████████░]` | 对话、审议、结构化报告、delivery chain（交付链）、`outcome.visualize`、`ux.preview`、evidence provenance（证据来源）、runtime config（运行配置）、real vector retrieval（真实向量检索）、RAG ingestion（RAG 摄取）、telemetry（观测）、A2A、task executor、knowledge admin 等切片已经成片通过 gate；剩余主要是生产级真实外部依赖、完整 `orchestrate.plan` 主编排、部署观测和长跑稳定性。 |
| SlideRule V5 Node 到 Python 薄代理链路 | 约 97-99% | `[██████████]` | Python mode、delegation helper、timeout（超时）、health check（健康检查）、contract smoke、delivery/visual/artifact capability 白名单、Blueprint proxy 和多条 runtime contract 已比较完整；这只是 SlideRule 薄代理链路，不能当成整体 NodeJS 后端迁移百分比。 |
| Python V5 可运行基线 | 约 93-95% | `[█████████░]` | Python 服务、核心 smoke、contract expansion、native LLM capability、vector client、evidence provenance、runtime config、real vector retrieval、RAG ingestion、NL command、workflow、telemetry、A2A contract runtime、task executor runtime bridge、knowledge admin runtime bridge 都已有测试支撑；真实生产依赖、运行观测落地和部署策略仍要继续补。 |
| LLM infra 迁移 | 约 58-65% | `[██████░░░░]` | Python `sliderule_llm` 已支撑 chat、JSON hardening、基础 pool、provider/model fallback、telemetry metadata、vector client、stream contract、pool resilience、cost runtime accounting、circuit breaker（熔断）和 multimodal contract（多模态契约）；完整并发、真实生产计费、跨后端观测和 Node 全量 env 细节仍未完全对齐。 |
| 能力覆盖 | 高 | `[█████████░]` | 当前已记录的主要 SlideRule V5 `python-llm` 能力包括对话、审议、report、structure、risk/evidence、delivery chain、`outcome.visualize`、`ux.preview`、task executor、knowledge admin；未审计或只完成 contract 的边界不能自动视为完整 runtime 迁移。 |

## 最新大白话结论

最新队列复核后，不能再沿用“整体只有 50-56%”的旧判断。更准确的说法是：**整体 NodeJS 后端迁 Python 已经进入约 70-74% 候选区间，正在接近 75%，但 75% 还需要补齐剩余红灯、无新增 diff 和落地证据后再写死**。

这次最有价值的不是把数字写好看，而是把几类硬边界继续往前推了：

- A2A invoke/list/cancel runtime bridge（运行时桥）已经落到 Python + Node proxy，并且不把 failed/cancelled 伪装成 completed。
- RAG ingestion production storage（RAG 生产存储）和 real vector retrieval（真实向量检索）比之前更接近真实运行链路。
- Web AIGC search runtime bridge（搜索运行时桥）从 adapter contract 往 runtime bridge 走了一步。
- auth/session、permission、audit、admin、Blueprint agent crew/brainstorm 等后端大块开始被切成可审查、可测试的小片。
- `task-executor-runtime-bridge`（任务执行器运行时桥）有 `DONE_REVIEWED`（已审查完成）和 `8d465116` commit（提交）证据，可以按新增 runtime bridge（运行时桥）计入。
- `knowledge-admin-runtime-bridge`（知识库管理运行时桥）有 `DONE_REVIEWED`（已审查完成）和 `744e119e` commit（提交）证据，可以按新增 runtime bridge（运行时桥）计入。
- `production-observability-rollup`（生产观测汇总）有 `DONE_REVIEWED`（已审查完成）和 `923bd432` commit（提交）证据，按 production maturity（生产成熟度）支撑计入，但不等同于业务迁移分母完成。
- `deployment-live-smoke-boundary`（部署在线冒烟边界）有 `DONE_REVIEWED`（已审查完成）和 `9164c86f` commit（提交）证据，按部署成熟度支撑计入，但不等同于所有业务 runtime（运行时）完成。
- Blueprint main state、job、stage edit、role、NL command、workflow、RAG runtime、telemetry route、A2A runtime 等 75 候选切片在队列结果里已经从红灯转为 `DONE_REVIEWED`（已审查完成），但其中不少仍是 contract/proxy（契约/代理）边界，不能按生产全量完成来膨胀百分比。
- `session-persistence-runtime-boundary`（会话持久化运行时边界）是 `DONE_REVIEWED_NO_DIFF`（已审查但无新 diff），只能当作已有能力复核，不按新增迁移切片计入。
- `backend-python-node-route-inventory-75` 仍是 `HALT_APPLY_FAILED`（补丁落地失败），只作为 route inventory（路由盘点）证据，不作为迁移实现完成。

## 75% 候选复核结果

本轮复核读取的证据包括主仓库 `.agent-loop/queue-outcomes.json`、对应 `.agent-loop/runs/*/final-report.*`、当前 `git log --oneline`、最新后端 commit（提交）和 `docs/backend-python-node-route-inventory-75.md`。工作树当前无未提交改动，`.agent-loop` 运行产物仍不作为提交对象。

| 证据层 | 当前结果 | 是否计入 75% 完成度 |
|---|---|---|
| queue outcomes（队列结果汇总） | 当前共 87 项任务；其中 `backend-python-*` 共 79 项，59 项 outcome（结果）为 `done`（完成），58 项 status（状态）为 `DONE_REVIEWED`（已审查完成），1 项为 `DONE_REVIEWED_NO_DIFF`（已审查但无新 diff），仍有 16 项 `HALT_HUMAN`、3 项 `HALT_NO_CHANGES`、1 项 `HALT_APPLY_FAILED`。 | 明确 `DONE_REVIEWED` 且能对应当前仓库代码/测试/commit 的切片可计入；`NO_DIFF`、`HALT_*` 不按新增完成计入。 |
| final reports（最终报告） | task executor runtime bridge、knowledge admin runtime bridge、production observability rollup、deployment live smoke、Blueprint/A2A/telemetry/workflow 等多条 75 候选 final report 中可见 review pass（审查通过）。 | 与 commit（提交）或主仓库 diff 能对上的按对应层级计入；只有 report 绿但没有落地证据的按候选证据处理。 |
| commits（提交） | 当前可见新增迁移 commit 包括 `8d465116 feat(backend-python): add task executor runtime bridge`、`923bd432 feat(backend-python): add observability rollup contract`、`744e119e feat(backend-python): add knowledge admin runtime bridge`、`9164c86f feat(backend-python): land deployment live smoke boundary`；`6463e85d` 及后续 AgentLoop commit 是工具链修复，不计入后端迁移完成度。 | task executor、knowledge admin 可计入新增 runtime bridge；observability rollup 和 deployment live smoke 计入生产成熟度支撑；AgentLoop 工具链不计入。 |
| route inventory（路由盘点） | `docs/backend-python-node-route-inventory-75.md` 明确 inventory（盘点）是 75 候选支撑文档，不证明整体 NodeJS backend（后端）已达 75%。 | 作为分母/边界证据，不作为迁移实现完成。 |

75 候选的主要缺口已经从“大量切片红灯”变成“少数红灯 + no-diff + contract/proxy 到 production runtime 的最后分层确认”。下一步要把 16 个 `HALT_HUMAN` 里仍有价值的旧切片判定为 superseded（已被后续任务覆盖）或重新开小任务修复，同时确认 `DONE_REVIEWED` 的 contract/proxy 切片哪些已经具备 runtime/production wiring 证据。

## 本轮 75% 候选队列结果

| 任务 | 队列状态 | 计入口径 |
|---|---|---|
| `backend-python-task-executor-runtime-bridge` | `DONE_REVIEWED` | 有 `8d465116` commit，可按新增 runtime bridge（运行时桥）计入。 |
| `backend-python-knowledge-admin-runtime-bridge` | `DONE_REVIEWED` | 有 `744e119e` commit，可按新增 runtime bridge（运行时桥）计入。 |
| `backend-python-production-observability-rollup` | `DONE_REVIEWED` | 有 `923bd432` commit，计入 production maturity（生产成熟度）支撑。 |
| `backend-python-deployment-live-smoke-boundary` | `DONE_REVIEWED` | 有 `9164c86f` commit，计入 deployment/live smoke（部署在线冒烟）支撑。 |
| `backend-python-blueprint-main-state-runtime-boundary` | `DONE_REVIEWED` | 已从红灯转绿；计入候选完成，但仍需按 runtime boundary（运行时边界）确认生产覆盖。 |
| `backend-python-blueprint-job-runtime-proxy` | `DONE_REVIEWED` | 已从 no-diff/失败观感转为已审查完成；按 proxy/runtime proxy（代理/运行时代理）候选计入。 |
| `backend-python-blueprint-stage-edit-proxy-contract` | `DONE_REVIEWED` | 按 contract/proxy（契约/代理）候选计入，不等同生产全量 runtime。 |
| `backend-python-role-runtime-proxy-contract` | `DONE_REVIEWED` | 按 runtime proxy contract（运行时代理契约）候选计入。 |
| `backend-python-nl-command-runtime-contract` | `DONE_REVIEWED` | 按 runtime contract（运行时契约）候选计入。 |
| `backend-python-workflow-runtime-contract` | `DONE_REVIEWED` | 按 runtime contract（运行时契约）候选计入。 |
| `backend-python-rag-ingestion-runtime-contract` | `DONE_REVIEWED` | 按 runtime contract（运行时契约）候选计入；production storage（生产存储）仍按更高层级另算。 |
| `backend-python-telemetry-route-contract` | `DONE_REVIEWED` | 按 route contract（路由契约）候选计入；生产 sink（生产写入端）仍是更高层级。 |
| `backend-python-a2a-runtime-contract` | `DONE_REVIEWED` | 按 A2A runtime contract（运行时契约）候选计入；stream 长链路仍不算完成。 |
| `backend-python-blueprint-artifact-memory-proxy` | `DONE_REVIEWED` | 按 artifact/memory proxy（产物/记忆代理）候选计入。 |
| `backend-python-blueprint-review-export-proxy` | `DONE_REVIEWED` | 按 review/export proxy（审查/导出代理）候选计入。 |
| `backend-python-session-persistence-runtime-boundary` | `DONE_REVIEWED_NO_DIFF` | 已复核但无新增 diff；不按新增迁移切片计入。 |
| `backend-python-node-route-inventory-75` | `HALT_APPLY_FAILED` | 作为 inventory（盘点）证据，不作为实现完成计入。 |
| `backend-python-migration-status-refresh-75` | `DONE_REVIEWED` | 文档刷新任务，不计入后端业务迁移分母。 |

## 历史 60% 候选队列结果

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
| `backend-python-migration-status-refresh-60` | 历史刷新任务 | 当时只刷新真实进度，不把候选目标写成已完成事实。 |

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
- `HALT_NO_CHANGES`（停止：无有效新增改动）只能说明本轮没有有效新增 diff（差异补丁），不能自动算作一个新迁移切片完成。
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

如果下一阶段继续把整体进度从 70-74% 候选区间推进到可坐实的 75%/80%，建议优先补这几类“真分母”：

| 顺序 | 建议任务 | 目标 |
|---|---|---|
| 1 | HALT 清算 / superseded 判定 | 把 16 个 `HALT_HUMAN` 逐项判断为仍需修复、已被后续任务覆盖，或应拆成更小任务。 |
| 2 | contract/proxy 到 runtime 分层复核 | 对 Blueprint、role、NL command、workflow、telemetry、A2A 等 `DONE_REVIEWED` 切片确认到底是 contract、proxy 还是 runtime。 |
| 3 | session persistence runtime | 当前是 `DONE_REVIEWED_NO_DIFF`，需要决定是接受为已有能力复核，还是补一个真实新增 diff。 |
| 4 | route inventory 落地 | `backend-python-node-route-inventory-75` 仍是 `HALT_APPLY_FAILED`，需要重新生成或人工整理 route inventory。 |
| 5 | production external service wiring | 把 vector/RAG/A2A/Web AIGC 的真实外部服务、fallback、provenance 和观测串起来。 |
| 6 | deployment/live smoke 扩展 | 已有 live smoke 边界，下一步把 Python 服务部署配置、健康检查、超时、回退和长跑稳定性纳入更强 gate。 |

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
