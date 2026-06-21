# SlideRule Python 迁移任务状态

这个文件是给人看的迁移总表，用来回答“哪一片已经执行完、哪一片还没做”。详细机器运行记录仍然放在 `.agent-loop/latest/` 和 `.agent-loop/runs/`，这些目录是运行产物，不提交。

## 关键状态词对照

| 关键词 | 中文含义 | 计入口径 |
|---|---|---|
| `DONE_REVIEWED` | 已审查完成 | 只有能对应当前仓库代码、测试或 commit（提交）证据时，才计入完成。 |
| `DONE_REVIEWED_NO_DIFF` | 已审查完成但无新 diff | 只说明已有能力复核或 baseline gate（基线门禁）已绿；除非后续任务补了真实 diff 或明确接受既有证据，否则不按新增迁移切片计入。 |
| `HALT_NO_CHANGES` | 停止：无有效新增改动 | 本轮没有新 diff（差异补丁），不能按新增迁移切片计入。 |
| `HALT_APPLY_FAILED` | 停止：应用补丁失败 | run（运行）或 review（审查）可能通过，但 worktree（隔离工作树）diff 没有落回主仓库，不能计入实现完成。 |
| `HALT_HUMAN` | 停止：需要人工接管 | agent（代理）超时、审查 blocked（阻塞）或证据不足；必须由后续任务、commit 或人工审计来判断是否已被覆盖。 |
| `contract` | 契约 | 输入输出、错误语义和 envelope（信封结构）稳定；不等于真实 runtime（运行时）或 production wiring（生产接线）。 |
| `proxy` | 代理 | Node 仍保留路由/入口，只把部分能力转发给 Python；不等于 Python 已拥有完整业务运行时。 |
| `runtime bridge` | 运行时桥 | Node 能把一个有边界的运行时操作委托给 Python，并且错误/超时/取消语义有测试覆盖。 |
| `production wiring` | 生产接线 | 接入存储、真实服务边界、观测、fallback（回退）或部署健康检查；smoke（冒烟）通过仍不等于真实外部服务长跑可用。 |

## 90 阶段刷新结论

本次刷新读取了主仓库 `.agent-loop/queue-outcomes.json`（2026-06-22 03:59 左右更新）、90 阶段审计文档、当前 `git log --oneline` 和 HEAD 中可见的代码/测试路径。结论是：**整体 NodeJS 后端迁 Python 不应写成 90%；当前更稳妥的工作数字是约 82%，可描述为 80-84% 区间。**

选择 80-84% 的原因：

- 队列总量已经明显推进：当前 87 个 `backend-python-*` 任务中，66 个 `DONE_REVIEWED`、1 个 `DONE_REVIEWED_NO_DIFF`、16 个 `HALT_HUMAN`、3 个 `HALT_NO_CHANGES`、1 个 `HALT_APPLY_FAILED`。
- 90 阶段证据任务中，HALT audit、route inventory、runtime depth audit、session persistence runtime diff、production wiring smoke 都已经有可审查文档或 commit 证据。
- `session-persistence-runtime-boundary` 仍在旧队列里显示 `DONE_REVIEWED_NO_DIFF`，但后续 `backend-python-session-persistence-runtime-diff-90` 已落地 `6285a5d0`，可按“已补 runtime evidence（运行时证据）”处理。
- `backend-python-production-wiring-smoke-90` 已落地 Web AIGC search/file/vision/audio runtime bridge、telemetry production sink 和相关 safe-failure/provenance 测试；这些只可计入 bounded runtime / synthetic production wiring maturity（生产接线成熟度），不代表真实外部 search、OCR、vision、audio、APM 或 billing 服务已经由 Python 生产接管。
- `docs/backend-python-runtime-depth-audit-90.md` 明确指出 75 候选里的许多 `DONE_REVIEWED` 只是 `contract-only` 或 `proxy-only`，不能直接换算成 runtime completion（运行时完成）。
- HEAD 中仍可见大量 `node-only` route shell（路由壳）、Blueprint 状态机/job/event bus、task lifecycle、auth persistence、audit retention/export、Web AIGC 其他 adapters 等未迁完分母。
- 当前 queue outcomes 中仍保留 16 个 `HALT_HUMAN`。其中一部分已被 HALT audit 判定为 superseded（已覆盖）或 docs-only（仅文档），但旧红灯本身不能直接当完成；必须由后续 landed commit 或审计证据逐项接管。

## 分层进度口径

这些比例只用于把范围说清楚，不要把它们混成一个总数。尤其不能把 SlideRule 某条链路的高进度，误报成整个 NodeJS 后端迁移进度。

| 范围 | 当前判断 | 进度条 | 说明 |
|---|---:|---|---|
| 整体 NodeJS 后端迁 Python | 约 80-84%，工作数字 82% | `[████████░░]` | 90 阶段把 route inventory（路由盘点）、runtime depth（运行时深度）、session persistence（会话持久化）和 production wiring smoke（生产接线冒烟）补上了一层证据，但 route shell、Blueprint 主流程、task lifecycle、auth/audit 生产持久化和部分 Web AIGC adapter 仍是 Node-owned 或 mixed（混合）。 |
| SlideRule V5 子系统迁移 | 约 94-96% | `[█████████░]` | 对话、审议、结构化报告、delivery chain（交付链）、`outcome.visualize`、`ux.preview`、evidence provenance（证据来源）、runtime config（运行配置）、real vector/RAG、A2A invoke、task executor、knowledge admin 等切片已有成片 gate 证据；剩余主要是完整 `orchestrate.plan` 主编排、真实外部服务长跑、部署观测和生产稳定性。 |
| SlideRule V5 Node 到 Python 薄代理链路 | 约 97-99% | `[██████████]` | Python mode、delegation helper、timeout（超时）、health check（健康检查）、contract smoke、delivery/visual/artifact capability 白名单和多条 runtime/proxy contract 已比较完整；这只是 SlideRule 薄代理链路，不是整体 NodeJS 后端百分比。 |
| Python V5 可运行基线 | 约 93-95% | `[█████████░]` | Python 服务、核心 smoke、native LLM capability、vector client、evidence provenance、runtime config、RAG、session persistence、task executor、knowledge admin 和 production wiring smoke 都有测试支撑；真实生产依赖、外部服务凭据、长跑观测仍需继续补。 |
| 90 阶段 route/runtime 深度 | 约 76-82% | `[████████░░]` | 盘点显示 `/api/sliderule`、RAG/vector、MCP/skill、部分 workflow/NL/A2A、task executor 和 knowledge admin 有 contract/proxy/runtime 证据；但 `/api/blueprint` 大路由、auth persistence、permission route management、audit retention/export、task route lifecycle 和大量 Web AIGC 路径仍是 Node-led。 |
| production wiring maturity | 约 80-85% | `[████████░░]` | RAG/vector、deployment live smoke、observability rollup、Web AIGC search/file/vision/audio 和 telemetry sink 有 fake/synthetic smoke 或 degraded/safe-failure 证据；不代表真实 Qdrant/embedding/search/OCR/vision/audio/telemetry/APM 外部服务已经生产长跑。 |
| LLM infra 迁移 | 约 60-68% | `[██████░░░░]` | Python `sliderule_llm` 已支撑 chat、JSON hardening、pool、fallback、telemetry metadata、vector client、stream contract、cost accounting、circuit breaker 和 multimodal contract；完整并发、真实生产计费、跨后端观测和 Node env 细节仍未完全对齐。 |

## 90 阶段证据对照

| 证据层 | 当前结果 | 计入口径 |
|---|---|---|
| queue outcomes（队列结果） | 当前 95 个队列任务，其中 `backend-python-*` 87 个：66 个 `DONE_REVIEWED`、1 个 `DONE_REVIEWED_NO_DIFF`、16 个 `HALT_HUMAN`、3 个 `HALT_NO_CHANGES`、1 个 `HALT_APPLY_FAILED`；按 outcome 看，67 个 `done`、14 个 `crashed`、6 个 `failed`。 | 只能作为批量状态面板。是否计入整体百分比还要看 commit、测试路径、审计分类和是否只是 docs-only。 |
| HALT superseded audit 90 | `docs/backend-python-halt-superseded-audit-90.md` 已落地，分类为 14 个 `superseded`、6 个 `still-open`、2 个 `split-needed`、4 个 `docs-only`。 | 可用于清算旧红灯；旧 `HALT_*` 不能直接当完成。 |
| Node route inventory 90 | `docs/backend-python-node-route-inventory-90.md` 已落地，按 `node-only`、`contract`、`proxy`、`runtime`、`production-wiring` 分层。 | 作为真实分母和缺口表；不把路由盘点本身计入实现完成。 |
| Runtime depth audit 90 | `docs/backend-python-runtime-depth-audit-90.md` 已落地。它把 15 个 75 候选 `DONE_REVIEWED` 切片分为 `runtime-bridge`、`production-wiring`、`contract-only`、`proxy-only`，其中只有 task executor、knowledge admin、deployment live smoke、observability rollup 可按 bounded runtime/prod evidence 计入。 | 这是压低百分比的核心证据：contract/proxy 绿不等于 runtime/prod 完成。 |
| Session persistence diff 90 | `6285a5d0 test(sliderule): cover python session persistence runtime` 已落地，补了 Python mode session store 相关测试证据。 | 可把旧 `DONE_REVIEWED_NO_DIFF` 悬项收口为 runtime evidence，但仍不代表 auth/session 全链路迁移。 |
| Production wiring smoke 90 | 当前 `HEAD` 可见 Web AIGC search/file/vision/audio runtime bridge、telemetry production sink、safe failure 和 provenance 相关测试/服务文件；详见 `docs/backend-python-web-aigc-runtime-evidence-reconcile-88.md`。 | 只计入 bounded runtime / synthetic production wiring maturity；不等同真实外部服务已生产接好。 |
| Auth/permission/audit runtime 90 与 A2A stream 90 | queue outcomes 显示 `DONE_REVIEWED`，任务文档清单已勾选；但当前 HEAD 下部分 gate 中点名的 runtime 测试路径不可见。 | 不能据此把整块 auth/permission/audit 或 A2A stream 写成已生产迁移。需要 reviewer 复核对应 diff 是否真正落地，或后续补齐可见代码证据。 |
| migration status refresh 90 | 之前队列结果是 `HALT_HUMAN`/`failed`，审查指出状态文档仍停在 75 口径。 | 本文件就是本轮回修；它只刷新状态，不计入业务迁移分母。 |

## 计入与不计入清单

| 类型 | 可以计入整体迁移推进的证据 | 不能按完成计入的证据 |
|---|---|---|
| bounded runtime bridge | `task-executor-runtime-bridge`、`knowledge-admin-runtime-bridge`、A2A invoke runtime、Web AIGC search runtime、session persistence runtime diff 等有 commit/测试路径的最小运行时桥。 | 只有 proxy shape（代理形状）或 contract envelope（契约信封）的切片。 |
| production wiring maturity | RAG/vector production boundary、deployment live smoke、observability rollup、production wiring smoke 90 中的 Web AIGC search/file/vision/audio fake-runtime bridge 和 telemetry synthetic sink smoke。 | 真实外部服务、真实密钥、外部 APM、长跑稳定性和生产部署策略未验证时，不能称为完整生产迁移。 |
| docs/audit support | HALT audit、route inventory、runtime depth audit 可提升口径可信度，帮助识别真缺口。 | docs-only、status refresh、inventory 本身不迁业务 runtime。 |
| no-diff / HALT | 后续任务补了真实 diff 或明确接受已有证据后，可以按后续任务计入。 | `DONE_REVIEWED_NO_DIFF`、`HALT_NO_CHANGES`、`HALT_APPLY_FAILED`、`HALT_HUMAN` 本身不计入新增完成。 |
| SlideRule V5 子系统 | 可用于 SlideRule V5 子系统百分比。 | 不能外推为整个 NodeJS backend 已完成同等比例。 |

## 90 阶段当前缺口

| 缺口 | 为什么仍阻碍 88/90% |
|---|---|
| Blueprint 主路由和状态机 | `/api/blueprint` 大路由、job store、event bus、diagnostics、ledger、preview、prompt package、replan/staleness/traceability 等仍是 Node-owned 或 mixed。 |
| Auth/session 生产链路 | 当前可见证据主要覆盖 contract 或 session persistence boundary；用户注册/登录、repository、email code、refresh/logout 和生产持久化仍未整体迁移。 |
| Permission/audit 生产链路 | permission route management、rate-limit runtime、audit retention/export/anomaly/compliance、permission audit hooks 仍需更清楚的 Python runtime 或 production sink 证据。 |
| A2A stream 长链路 | invoke/list/cancel 已有运行时桥或 contract 证据，但 stream runtime、外部 agent safe failure 和 session/registry 生产语义仍未完全坐实。 |
| Task route lifecycle | executor client runtime bridge 可计入；`/api/tasks`、mission store、project/resource auth 和完整 task lifecycle 仍是 Node-owned。 |
| Web AIGC 长尾 adapters | search/file/vision/audio 进展明显；web-qa、image/graph search、static webpage、OCR、dynamic chart、AI PPT、transaction-flow 等仍需逐片审计。 |
| 真实生产外部依赖 | smoke 覆盖 missing config、timeout、degraded 或 safe failure；真实 Qdrant/embedding/search/telemetry/APM 长跑和密钥部署不在本轮完成范围内。 |
| 队列状态清理 | queue outcomes 仍保留旧 `HALT_*` 和本状态刷新旧失败记录；状态文档不能用这些旧行伪装完成。 |

## 下一步建议

如果下一阶段要把整体进度从 80-84% 推到可坐实的 85%/88%，建议优先做这些小切片：

| 顺序 | 建议任务 | 目标 |
|---|---|---|
| 1 | 复核 auth/permission/audit runtime 90 与 A2A stream 90 的落地证据 | 让 queue `DONE_REVIEWED`、task checklist、HEAD 中可见代码/测试路径三者一致；缺文件则补真实 diff 或下调计入口径。 |
| 2 | Blueprint runtime 深水区拆片 | 先迁 selected state/job/stage edit/role runtime 的真实运行时行为，不一次迁完整 Blueprint 大路由。 |
| 3 | Task lifecycle runtime bridge | 在 executor client bridge 之外，补 `/api/tasks`、mission store、event replay、cancel/error 的 Python runtime 或 production boundary。 |
| 4 | Auth/audit production persistence | 不改 schema 的前提下，补 auth session repository、audit sink/export/retention 的 Python production wiring 或明确降级语义。 |
| 5 | Web AIGC adapter 长尾盘点与 runtime bridge | 按 route inventory 中的 node-only path 逐片补 contract、proxy、runtime，再进入 production wiring。 |
| 6 | 生产外部服务长跑 smoke | 在不提交密钥的前提下，补可配置、可跳过、可诊断的外部依赖 smoke 和 observability evidence。 |

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

## 提交前检查

- [ ] 只暂存本次任务相关文件，绝不使用 `git add -A`。
- [ ] 不暂存 `.agent-loop/`、`.tmp/`、`.probes/`、`.env`、日志、缓存、`tws-ai-slide-rule-python/data/`。
- [ ] 不提交真实密钥、数据库密码、Qdrant key、Bearer token。
- [ ] 如果只改文档，至少跑 `node agent-loop/src/check-mojibake.js agent-loop/tasks/...`。
- [ ] 如果改代码，重新跑对应 Python、Node、TypeScript gate。

## Auth/A2A runtime evidence reconcile 88 addendum

This addendum corrects the reviewed 90-stage runtime posture against current
`HEAD`. It is intentionally limited to evidence alignment and does not raise
the overall backend migration percentage to 90%.

Current `HEAD` used by the reconcile:

- `66677676b941a0a923ea422bd22792d1d4f28cf6`
- `66677676 chore(agent-loop): plan backend python 88 queue`

Queue outcomes from `../../.agent-loop/queue-outcomes.json` show:

| Task | Queue status | Updated at | Current count posture |
|---|---|---|---|
| `backend-python-auth-permission-audit-runtime-90` | `DONE_REVIEWED` / `done` | `2026-06-21T17:55:58.608Z` | Mixed. Count only permission check as bounded `runtime-boundary`; auth/session, permission rate-limit, and audit event stay `contract-only` with runtime `evidence-missing`. |
| `backend-python-a2a-stream-runtime-boundary-90` | `DONE_REVIEWED` / `done` | `2026-06-21T18:06:43.872Z` | `contract-only` for stream. Current `HEAD` lacks the gate-named stream runtime test paths. |

HEAD evidence details:

| Slice | Visible evidence | Missing paths | Posture |
|---|---|---|---|
| Auth/session | `tws-ai-slide-rule-python/tests/test_auth_session_contract.py`, `server/tests/auth-session-python-contract.test.ts`; Node auth remains in `server/routes/auth.ts` and `server/auth/middleware.ts`. | `tws-ai-slide-rule-python/tests/test_auth_session_runtime_boundary.py`, `server/tests/auth-session-runtime-boundary.test.ts` | `contract-only`; runtime `evidence-missing`. |
| Permission check | `tws-ai-slide-rule-python/tests/test_permission_check_runtime_boundary.py`, `server/permission/check-engine-python-runtime.test.ts`, `shared/permission/contracts.ts`, `tws-ai-slide-rule-python/middlewares/auth.py`; commit `61097ed0 feat(backend-python): add permission check runtime boundary`. | None among the gate-named permission-check runtime paths. | Bounded `runtime-boundary`; not full permission production migration. |
| Permission rate limit | `tws-ai-slide-rule-python/tests/test_permission_rate_limit_contract.py`, `server/permission/rate-limiter-python-contract.test.ts`, `server/permission/rate-limiter.ts`. | `tws-ai-slide-rule-python/tests/test_permission_rate_limit_runtime_boundary.py`, `server/permission/rate-limiter-python-runtime.test.ts` | `contract-only`; runtime `evidence-missing`. |
| Audit event | `tws-ai-slide-rule-python/tests/test_audit_event_contract.py`, `server/tests/audit-event-python-contract.test.ts`, `shared/audit/contracts.ts`; Node audit remains under `server/audit/*` and `server/routes/audit.ts`. | `tws-ai-slide-rule-python/tests/test_audit_event_runtime_boundary.py`, `server/tests/audit-event-python-runtime.test.ts` | `contract-only`; runtime `evidence-missing`. |
| A2A stream | `tws-ai-slide-rule-python/services/a2a_runtime.py`, `tws-ai-slide-rule-python/tests/test_a2a_runtime_contract.py`, `server/routes/__tests__/a2a-python-runtime-contract.test.ts`, `shared/a2a-protocol.ts`; commits `3eca0bd4` and `7e34c2a9`. Node stream transport remains in `server/routes/a2a.ts`, `server/core/a2a-client.ts`, and `server/core/a2a-server.ts`. | `tws-ai-slide-rule-python/tests/test_a2a_stream_runtime_boundary.py`, `server/routes/__tests__/a2a-python-stream-runtime.test.ts` | `contract-only` for stream; Node transport is not Python runtime/production evidence. |

Auth/A2A detailed report: `docs/backend-python-runtime-evidence-reconcile-88.md`.

## Web AIGC runtime evidence reconcile 88 addendum

This addendum reconciles Web AIGC runtime and telemetry sink evidence against
current `HEAD`. It is limited to the Web AIGC search/file/vision/audio and
telemetry sink paths named by this task and does not update the overall backend
migration percentage.

Current `HEAD` used by the Web AIGC reconcile:

- `80ba0cc7c88d3c2ac13f6c469980d709dd8387a1`
- `80ba0cc7 agent-loop queue checkpoint: backend-python-runtime-evidence-reconcile-88`

HEAD evidence details:

| Slice | Current classification | Current `HEAD` evidence | Remaining gap |
|---|---|---|---|
| Web AIGC search | `runtime` | `server/routes/__tests__/web-aigc.search-python-runtime.test.ts`, `tws-ai-slide-rule-python/tests/test_web_aigc_search_runtime_bridge.py`, `tws-ai-slide-rule-python/services/web_aigc_search_adapter.py`. | Fake-provider runtime only; real web/image/graph/page-fetch providers remain production gaps. |
| Web AIGC file | `runtime` | `server/routes/__tests__/web-aigc.file-python-runtime.test.ts`, `tws-ai-slide-rule-python/tests/test_web_aigc_file_runtime_bridge.py`, `tws-ai-slide-rule-python/services/web_aigc_file_adapter.py`. | Memory-backed fake runtime only; real file persistence, translators, user path IO, and production storage remain gaps. |
| Web AIGC vision/audio | `runtime` | `server/routes/__tests__/web-aigc.vision-audio-python-runtime.test.ts`, `tws-ai-slide-rule-python/tests/test_web_aigc_vision_audio_runtime_bridge.py`, `tws-ai-slide-rule-python/services/web_aigc_vision_audio_adapter.py`, `tws-ai-slide-rule-python/services/web_aigc_media_adapter.py`. | Fake runtime only; real OCR, vision, STT, TTS, audio, and multimodal services remain production gaps. |
| Telemetry sink | `production-wiring` smoke | `server/routes/__tests__/telemetry-python-production-sink.test.ts`, `tws-ai-slide-rule-python/tests/test_telemetry_production_sink.py`, `tws-ai-slide-rule-python/services/telemetry.py`, `shared/telemetry/contracts.ts`. | Synthetic sink only; real external APM/OTLP/Datadog/billing emission remains a production gap. |

Counting rule after this Web AIGC reconcile:

- Do not count adapter contracts as runtime unless the current `HEAD` runtime
  test/service paths exist.
- Do not count fake runtime bridges as real external production service
  ownership.
- Do not count telemetry synthetic sink smoke as real external APM or billing
  emission.
- Keep long-tail Web AIGC routes without Python evidence as `node-only`.

Detailed report: `docs/backend-python-web-aigc-runtime-evidence-reconcile-88.md`.

Counting rule after this reconcile:

- `DONE_REVIEWED` in queue outcomes is a review signal only.
- Mojibake green is not runtime or production evidence.
- Contract/proxy tests are not counted as runtime or production wiring unless
  current `HEAD` has concrete runtime-boundary or production paths.
- The overall backend migration remains in the previously documented 80-84%
  working band, not 90%.
