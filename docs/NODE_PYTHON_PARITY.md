# Node → Python 迁移对等清单（NODE_PYTHON_PARITY）

> 基线：`SLIDERULE_V5_BACKEND=python`（默认），Node 经 `server/sliderule/python-delegation.ts` 薄代理到 :9700。
> 数据来源：`server/routes/`（67 个顶层路由模块 + `blueprint/` 约 70 个子模块 + `node-adapters/` 35 个适配器）、
> `slide-rule-python/app.py` + `routes/`（9 个路由模块，8 个已挂载；sliderule.py 未挂载）、`slide-rule-python/FINAL_MIGRATION_STATUS.md`。

## 一、总览

- **整体对等度**：约 **36–40%**（与 FINAL_MIGRATION_STATUS.md 自评一致）。V5 sliderule 执行面 + agent-loop + a2a 已由 Python 主导；LLM Phase 1 约 80%；真实 RAG 仅 10–15%；V5 之外的全服务器迁移为个位数百分比。
- **Python 已挂载 HTTP 面**（app.py）：`/api/sliderule/*`（sliderule_full）、`/api/blueprint/spec-documents/*`、`/api/blueprint/jobs/*`、`/api/agent-loop/*`、`/api/rag/*`、**`/api/auth/*`、`/api/permissions/*`、`/api/audit/*`（2026-07 新挂载，routes/auth.py / permissions.py / audit.py）**、health/ready/observability + AgentLoop 静态面板。
- **Python services 层仍宽于路由层**（约 115 个 service 文件）。auth_*、permission_*、audit_* 已有 HTTP 皮肤（见七）；task_*、telemetry_*、web_aigc_*_adapter 等仍**没有对应 FastAPI 路由**，即"有内脏没有皮肤"。

### 三个最大缺口
1. ~~真实向量 RAG~~（2026-07 已落地 `services/vector_rag.py`：embedding + 本地余弦索引，凭据缺失时诚实回退关键词；Qdrant 后端可作后续增强）。
2. ~~跨进程实测闭环~~（2026-07 已常态化：`pnpm run smoke:live-delegation` 进 CI，release-guardrails 新增 `python-live-delegation` job——CI 起无 LLM key 的 uvicorn:9700，smoke 先经 Node 薄代理打通 /health 往返，再按 live Python 是否配置 LLM 分支断言 python-llm 真输出或 Python 亲自返回的 502 keyless 证据）；`structure.decompose` live 尚无干净通过记录；未映射能力仍落 generic fallback。
3. **HTTP 面缺口**（2026-07 进一步收窄）：auth / permissions / audit 已挂载薄路由，**Node 侧薄代理已接线**（`server/routes/python-thin-proxy.ts`，AUTH_PYTHON_PROXY / PERMISSIONS_PYTHON_PROXY / AUDIT_PYTHON_PROXY，**默认关**，显式 "true" 开启）；tasks 已挂载 `/api/tasks` 存储+CRUD 核心切片且 **Node 侧薄代理已接线并默认开**（TASKS_PYTHON_PROXY，显式 "false" 关闭；vitest 环境默认走 Node）；telemetry / web-aigc 适配器在 Python 仍只有 service，没有挂载路由，Node 无法对这些面做薄代理收编。

### 建议迁移顺序（先解锁金链路：一句话 → spec → Skill 联动 → 预览/导出）
1. **补齐 V5 execute 实测**：live delegation smoke 常态化（入口 `pnpm run smoke:live-delegation`，需先启动 :9700；**2026-07 已进 CI**：release-guardrails `python-live-delegation` job），structure.decompose 干净通过待补（report.write live 已有通过记录）；未映射 cap 收敛进 `execute_mapped_capability`。
2. **真实向量 RAG**（rag_service + rag.py 换 embedding 检索）——直接提升 evidence/report/risk 三个金链路能力的产出质量。
3. **挂载 Python 侧 skill/mcp 运行时路由**（v5_skill_runtime_graph / mcp_runtime 已存在），消除 `skill.invoke`、`mcp.call` 依赖 Node 的最后一段。
4. **预览/导出面**：blueprint spec-docs 的 review/export 代理开关（`BLUEPRINT_REVIEW_EXPORT_PYTHON_PROXY`）转默认开，挂载 blueprint_jobs.py。
5. ~~auth/permissions/audit 补路由挂载~~（2026-07 已完成：/api/auth /api/permissions /api/audit，X-Internal-Key 鉴权，测试 test_*_routes_http_surface.py）。~~Node 侧接薄代理~~（2026-07 已接线：`python-thin-proxy.ts` + 各路由端点级委托，开关 AUTH_PYTHON_PROXY / PERMISSIONS_PYTHON_PROXY / AUDIT_PYTHON_PROXY **默认关**——安全敏感面，默认翻转为后续决策）。剩余退役前置：node-retained 面（mailer/用户库/权限管理 CRUD/真实审计链）的处置决定 + 默认开关翻转决策（见 index.ts 内 task 55/60 注释）。

图例：✅ 已由 Python 主导（Node 薄代理/已委托）｜🟡 部分/开关控制｜❌ 仅 Node｜🗄️ legacy 分支（仅 `SLIDERULE_V5_BACKEND=legacy` 时加载）

## 二、SlideRule 核心（金链路）

| 能力/路由 | Node 现状 | Python 现状 | 建议 | 备注 |
|---|---|---|---|---|
| /api/sliderule sessions CRUD | ✅ 薄代理（sliderule.ts） | sliderule_full.py 全量 | 迁移到Python（已完成，保留薄代理） | GET/PUT/DELETE 均 delegateToPythonSlideRule |
| /orchestrate-plan | ✅ 薄代理 | ✅ | 迁移到Python（已完成） | 失败时返回 python_unavailable，不再回落 Node 业务 |
| /execute-capability（V5 caps） | ✅ 薄代理 + 🗄️ legacy 动态导入 | execute_mapped_capability 覆盖多数 cap | 迁移到Python | 未映射 cap 落 generic fallback；structure.decompose live 未闭环 |
| /drive-full /drive-marathon /coverage /drive-full-stream | ✅ 薄代理 | ✅（含 stream） | 迁移到Python（已完成） | Python 另有顶层 /api/sliderule/drive-full 宽松鉴权 |
| /respond（legacy 会话应答） | 🗄️ legacy 路径 | 无 | 放弃删除 | 仅 legacy 分支可达 |
| sessions/__clear、__reload 测试钩子 | ❌ 测试用 | 无 | 保留Node薄代理 | 仅测试环境 |
| skills.ts（Skill 注册/版本/指标） | ❌ Node 注册面保留 | skill.invoke 运行时边界 ✅ Python 拥有（node_bridge_runtime.py，2026-07：启动时注入 node-bridge 适配器，执行暂桥接 Node /api/skills/:id/execute） | 进行中（下一步：Python 原生 skill 注册表替换桥接） | 绞杀者模式：换适配器即可切原生，调用方不感知 |
| mcp.ts（mcp.call） | ❌ Node adapter 保留为桥接后端 | mcp.call 运行时边界 ✅ Python 拥有（node-bridge 适配器桥接 /api/mcp/nodes/execute；denied/approval 翻译回 Python 错误语义） | 进行中（下一步：Python 原生 MCP client） | NODE_BRIDGE_RUNTIME_ENABLED / NODE_BRIDGE_BASE_URL 可配 |
| nl-command.ts | ❌ Node（直连 llm-client） | services/nl_command_runtime.py（无路由） | 迁移到Python | 一句话入口相关 |
| health.ts / persistence-health.ts | ✅ health 已代理；persistence ❌ | /health /ready /api/observability | 保留Node薄代理 | persistence-health 可并入 Python observability |

## 三、Agent-Loop

| 能力/路由 | Node 现状 | Python 现状 | 建议 | 备注 |
|---|---|---|---|---|
| /api/agent-loop 全面（runs/queue/settings/stream/artifacts/cancel） | ✅ 纯薄代理（agent-loop.ts），**尚未在 index.ts 挂载**（task 33） | agent_loop.py 全量 + 静态 dashboard + 十余个 agent_loop_* services | 迁移到Python（已完成） | 前端可直连 :9700；Node 代理挂载或直接跳过均可 |

## 四、Blueprint / Autopilot（存档为 legacy）

| 能力/路由 | Node 现状 | Python 现状 | 建议 | 备注 |
|---|---|---|---|---|
| blueprint.ts + blueprint/（brainstorm、spec-tree、agent-crew、stage-edit、jobs、preview…约 70 子模块） | ❌ Node 全量（400+ 文件） | 大量 blueprint_* takeover services；无对应完整路由 | **保留Node原样，不再迁移（存档）** | 产品决策：autopilot 归档；避免沉没成本 |
| spec-documents 生成（generate-one/batch） | ✅ 代理默认开（BLUEPRINT_SPEC_DOCS_PYTHON_PROXY，2026-07 转默认 true；显式 false 关闭；测试环境默认关） | blueprint_spec_docs.py ✅ | 已完成 | Python 失败自动回退 Node/模板 |
| spec-documents review/export | ✅ 代理默认开（BLUEPRINT_REVIEW_EXPORT_PYTHON_PROXY，同上） | ✅（/review /export /artifact-memory/contract） | 已完成 | 4xx 业务失败透传；5xx/不可达自动回退 Node 本地实现 |
| blueprint jobs runtime（start/status/cancel/read） | ❌ Node（jobs/…） | blueprint_jobs.py ✅ **已挂载**（/api/blueprint/jobs，2026-07） | 迁移到Python（Node 侧接代理为下一步） | Python 面已可验证（test_blueprint_job_runtime_proxy.py） |
| socket-relay、agent-reasoning-bridge | ❌ Node（socket） | 无 | 保留Node薄代理 | socket 依赖是 index.ts 暂不能退役的原因之一 |

## 五、A2A / Agents / 协作

| 能力/路由 | Node 现状 | Python 现状 | 建议 | 备注 |
|---|---|---|---|---|
| a2a.ts（stream/cancel/registry/sessions/chat/report/analytics） | ✅ PYTHON_FIRST_COMPAT 薄代理（task 47–51） | services/a2a_runtime.py 等 4 个 | 迁移到Python（已完成） | /invoke 保留 Node 本地执行器兼容壳 |
| agents.ts / guest-agents.ts | ❌ Node | 无 | 保留Node薄代理 | 非金链路，低频管理面 |
| planets.ts / tasks.ts / projects.ts / workflows.ts | 🟡 tasks.ts **CRUD 核心已接 Python 薄代理，`TASKS_PYTHON_PROXY` 默认开**（2026-07，`python-thin-proxy.ts`：显式 "false" 关闭，vitest 环境默认走 Node；委托端点仅 create/list/get/:id/events/:id/cancel；带 projectId / autoDispatch / nl-command 的 create 留在 Node（项目属主校验与 executor 派发 Node-owned）；连接失败/5xx 优雅回退 Node 实现，业务 4xx 透传；测试 tasks.python-proxy.test.ts）；执行面/视图面（projection/session/decisions/operator-actions/artifacts/decision）仍 Node | tasks.ts **CRUD 核心已可承接**（2026-07）：`services/task_store.py`（MissionRecord 契约 JSON 持久化，`data/tasks.json`，`TASK_STORE_FILE` 可配，原子写+锁+坏记录隔离）+ `routes/tasks.py` **已挂载 /api/tasks**（X-Internal-Key）：POST `/`、GET `/`、GET `/:id`、GET `/:id/events`（对齐 Node 字段名：`ok/task/tasks/missionId/events/alreadyFinal/executorForwarded/lifecycle`）、POST `/:id/cancel`（幂等 alreadyFinal），另有 Python 侧 POST `/:id/status`、POST `/:id/events`（Node 无对应 HTTP 端点，对应 runtime mark*/log 内部方法）；lifecycle 封套用 task_lifecycle_runtime 就地投影并按 Node applyLifecycleRuntimeTaskEnvelope 语义应用。**未迁移**：executor 派发/取消转发（executorForwarded 恒 false）、projectId 属主校验（带 projectId 请求按 Node 未配置语义回 500）、GET `/:id/projection`、GET `/:id/session`、GET `/:id/decisions`、POST `/:id/decision`、POST `/:id/operator-actions`、GET `/:id/artifacts*`、workflow retry/autonomy；planets/projects/workflows 仍无路由 | 迁移到Python（~~Node 薄代理接 /api/tasks~~ 2026-07 已完成且默认开；下一步：executor 面） | index.ts 退役前置项（task 55 注释点名 main routes）；测试：test_task_store.py + test_tasks_routes_http_surface.py（38 例）+ Node 侧 tasks.python-proxy.test.ts |
| executor 执行面（index.ts POST /api/executor/events 回调决策） | 🟡 **事件→动作投影已接 Python，`EXECUTOR_EVENTS_PYTHON_PROJECTION` 默认开**（2026-07，`python-thin-proxy.ts` 语义：显式 "false" 关闭，vitest 环境默认走 Node 内联）：仅 **STATE-CHANGING 事件**（job.started/progress/waiting/completed/failed/cancelled + status 兜底 waiting/completed/failed/cancelled）经 `server/routes/executor-events-python-projection.ts` 委托 Python `/api/executor/events/project` 取动作决策，再由 Node 用**原有 runtime 调用**落地（markMissionRunning/waitOnMission/finishMission/failMission/cancelMission + 心跳清除）；**高频流事件（job.log/job.log_stream/job.screenshot）100% 内联**，Socket.IO 透传不增加 HTTP hop；Python 不可达/5xx/封套非法时逐事件回退内联映射，行为与关闭开关逐字节一致。**仍 Node-owned**：HMAC 签名校验（EXECUTOR_CALLBACK_SECRET）、heartbeatMonitor 重置/清除执行、missionRuntime 持久化写入、artifacts/instance/securitySummary/previewSession 归一化、blueprint 前缀 202 短路、Socket.IO emit、executor 派发/取消（executor-client）与 lobster-executor runner | **`services/executor_event_projection.py`**：`mapExecutorEventToAction`（server/core/executor-event-mapper.ts）+ `resolveExecutorCallbackRouting`/`isBlueprintExecutorMissionId`（executor-callback-routing.ts）+ index.ts 内联分支 apply plan（有效进度/detail 回退链/分支顺序/心跳复位与清除）的逐行移植；`routes/executor_events.py` **已挂载 /api/executor/events**（X-Internal-Key）：POST `/project`（畸形投递 fail-closed 400 封套，`source:"python"` + `provenance:"python-executor-event-projection"`）。注意两套决策面并存且如实移植：纯 mapper 含 dedup（duplicate/outOfOrder → duplicate 裁决），内联 apply plan 与 Node 一致**不查** delivery | 迁移到Python（事件→动作投影已完成且默认开；下一步切片：① dedup/乱序裁决真正接入 Node 落地路径（现内联行为不查 delivery，需先补 Node 侧行为决策）② artifacts/payload 归一化 ③ blueprint 回调分支 ④ executor 派发/取消决策面） | 测试：test_executor_event_projection.py + test_executor_events_http_surface.py（47 例）+ Node 侧 executor-events.python-projection.test.ts（14 例）；executor-* 既有套件回归通过 |
| replay.ts / lineage.ts | ❌ Node | services/mission_event_replay.py（无路由） | 保留Node薄代理 | 观测型，后置 |
| reputation.ts / analytics.ts | ❌ Node | 无 | 保留Node薄代理 | marketplace/声誉体系，产品线未定前不迁 |
| export.ts / reports.ts | ❌ Node | 无 | 保留Node薄代理 | 跨框架工作流导出，与金链路导出不同物 |

## 六、计费 / 成本 / 遥测

| 能力/路由 | Node 现状 | Python 现状 | 建议 | 备注 |
|---|---|---|---|---|
| cost.ts（成本观测） | ❌ Node | services/slide_rule_budget.py（无路由） | 迁移到Python | 预算门控与 V5 执行同域，宜随核心走 |
| telemetry.ts | ❌ Node | telemetry.py / telemetry_runtime.py（无路由） | 迁移到Python | service 已在，缺挂载 |

## 七、Admin / 审计 / 认证 / 权限

| 能力/路由 | Node 现状 | Python 现状 | 建议 | 备注 |
|---|---|---|---|---|
| auth.ts | 🟡 Node 业务面保留；**Python 薄代理已接线，`AUTH_PYTHON_PROXY` 默认关**（2026-07，显式 "true" 开启：/register /login /email-code/login 委托 Python identity 决策封套后仍由 Node 签发 session cookie，业务 4xx 透传、连接失败/5xx 回退 Node 本地实现；7 个 GET /__internal/* 面在未注入 deps 时经 HTTP 委托，失败回退显式 node-fallback 封套；测试 auth.python-proxy.test.ts） | 🟡 **/api/auth 已挂载**（2026-07，routes/auth.py）：register / login / email-code/login / identity/execute（identity 桥）+ session/{write,read,refresh,logout,delete}（AUTH_SESSION_STORE_FILE JSON 边界）+ 7 个 `__internal/*` 闭环/takeover 面（audit-closure、token-mailer-session-cutover、session-token-boundary、production-ownership-closure、session-repository-takeover、token-issuance-takeover、mailer-user-store-scope） | 迁移到Python（~~Node 侧接线~~ 2026-07 已完成，默认关；下一步：默认翻转决策 + 真实凭据校验迁移） | 仍 Node-retained：email-code/send（真实 mailer）、/me /refresh /logout（cookie/session 语义）、生产用户库、密码哈希、cookie 签发；identity 为 bounded 契约（test 凭据），真实凭据校验未迁，**故默认关**。测试：test_auth_routes_http_surface.py |
| permissions.ts | 🟡 Node 管理面保留；**Python 薄代理已接线，`PERMISSIONS_PYTHON_PROXY` 默认关**（2026-07，显式 "true" 开启：POST /check /audit-hook /rate-limit/{check,record,reset} /policy/decision 端点级 1:1 委托；关闭时保持现有 Node 面（这些路径 404），业务 4xx 透传，基础设施失败显式 502 python_unavailable（无 Node 业务可回退）；测试 permissions.python-proxy.test.ts） | 🟡 **/api/permissions 已挂载**（2026-07，routes/permissions.py）：check（deny-first 检查运行时）、audit-hook、rate-limit/{check,record,reset}、policy/decision（确定性策略决策切片）、management/evaluate（显式 node_owned 边界）+ 4 个 `__internal/*` 决策面（policy-store-cutover、production-ownership-closure、durable-store-boundary、policy-store-takeover） | 迁移到Python（检查/决策面）；管理面保留Node | 仍 Node-owned：roles/policies/tokens CRUD、grant-temp/revoke/escalate、conflicts/risk、审计 trail/usage/violations/export、templates、web-aigc matrix（permission_management 对管理操作显式返回 unsupported/node_owned）。测试：test_permissions_routes_http_surface.py |
| audit.ts | 🟡 Node 真实审计链保留；**Python 薄代理已接线，`AUDIT_PYTHON_PROXY` 默认关**（2026-07，显式 "true" 开启：POST /sink /retention-export /evidence/classify 端点级 1:1 委托；关闭时保持现有 Node 面（这些路径 404），业务 4xx 透传，基础设施失败显式 502 python_unavailable；测试 audit.python-proxy.test.ts） | 🟡 **/api/audit 已挂载**（2026-07，routes/audit.py）：sink（生产 sink 合成写入 envelope）、retention-export（保留决策 + 导出 manifest）、evidence/classify（安全证据切片 classify/retain/export）+ `__internal/durable-store-retention-takeover` | 迁移到Python（合成/边界面）；真实链保留Node | 仍 Node-owned：hash 链存储、events 查询/搜索、verify/stats、compliance report、anomalies、permission trail、lineage、retention archive（Python 面均为合成安全切片，externalEmit=false）。测试：test_audit_routes_http_surface.py |
| admin.ts / config.ts | ❌ Node | 无 | 保留Node薄代理 | 低频管理面 |
| knowledge-admin.ts | ✅ 经 /api/admin/knowledge/proxy 代理 | services/knowledge_admin_runtime.py | 迁移到Python（已完成） | 失败带 node-knowledge-admin-python-runtime 溯源 |
| feishu.ts | ❌ Node | 无 | 保留Node薄代理 | 外部 IM 桥，独立演进 |

## 八、RAG / 知识

| 能力/路由 | Node 现状 | Python 现状 | 建议 | 备注 |
|---|---|---|---|---|
| rag.ts（query/search/ingest） | ✅ delegate-first，连接失败才回落 Node 兼容 | rag.py + rag_service + **vector_rag.py（2026-07：真实向量检索）** | 已完成 | 配置 LLM_API_KEY 即语义检索（provenance 如实标 vector/keyword）；ingest 可真实入库本地向量索引；无凭据时诚实回退关键词基线 |
| knowledge.ts（知识图谱公开 API） | ❌ Node | 无 | 保留Node薄代理 | 图谱与 RAG 演进合并后再迁 |
| vector-delete.ts / vector-update.ts | ❌ Node | 无（Python 无向量库） | 迁移到Python（随真实向量 RAG 一起） | 现在迁没有落点 |
| graph-search.ts / similarity-match.ts | ❌ Node（node-adapter） | web_aigc_search_adapter.py（无路由） | 迁移到Python（随检索面） | sliderule 证据链可能引用 |

## 九、Web-AIGC 能力路由（一次性能力面，约 30 个）

Python 已有 16 个 `web_aigc_*_adapter` services，但**均无挂载路由**；Node 侧全部经 `node-adapters/` 执行。

| 能力/路由 | Node 现状 | Python 现状 | 建议 | 备注 |
|---|---|---|---|---|
| web-search.ts / web-qa.ts / image-search.ts | ❌ Node | web_aigc_search/web_qa_adapter（无路由） | 迁移到Python | 金链路证据采集会用到 |
| intent-recognition.ts / orchestration-recognition-jump.ts | ❌ Node | web_aigc_orchestration_adapter（无路由） | 迁移到Python | "一句话"入口识别相关 |
| chat.ts / robot-reply.ts / format-output.ts | ❌ Node | 部分 adapter | 保留Node薄代理 | 通用对话面，非 sliderule 专属 |
| file-generation / file-slicing / file-translation / excel-read / long-text-extraction | ❌ Node | web_aigc_file_adapter（无路由） | 保留Node薄代理 | 文档处理按需再迁 |
| ai-ppt / dynamic-chart / vision / voice / audio-recognition / ocr-recognition / static-webpage-read | ❌ Node | 对应 adapter services（无路由） | **放弃候选** | sliderule 不调用的一次性演示能力 |
| open-page / open-report / open-dashboard / get-device-info / get-location-info / transaction-flow | ❌ Node | web_aigc_open/device_location/transaction_flow_adapter | **放弃候选** | 纯前端跳转/设备信息类，价值低 |
| web-aigc-risk-actions.ts / aigc-monitoring.ts | ❌ Node | 无 | 保留Node薄代理 | 风控/监控面，观察期 |

## 十、其他基础设施

| 能力/路由 | Node 现状 | Python 现状 | 建议 | 备注 |
|---|---|---|---|---|
| ue.ts（UE5 本地串流） | ❌ Node | 无 | 放弃删除（或独立仓） | 与主线无关的实验运行时 |
| artifact-utils.ts | ❌ Node（工具函数） | 无 | 保留Node | 非路由，静态资产 MIME 映射 |
| a2a-python-runtime.ts | ✅ 桥接件本体 | — | 保留Node薄代理 | 属于代理基建，随 Node 壳存亡 |

## 十一、统计

- ✅ 已由 Python 主导（Node 薄代理已生效）：**7 个面**（sliderule V5 执行/会话、agent-loop、a2a、rag query、knowledge-admin、health、blueprint spec-docs 开关代理×2 计入🟡）。
- 建议**迁移到Python**（含已完成保持 + 待补挂载）：约 **24 项**，其中高优 5 项（skill/mcp 运行时、真实向量 RAG、spec-docs 代理默认开、blueprint_jobs 挂载、live 委托实测）。
- 建议**保留Node薄代理**（暂不迁）：约 **17 项**（blueprint 存档、agents/guest-agents、reputation/analytics、replay/lineage、admin/config、feishu、chat 系、文件处理系、风控监控、socket-relay）。
- 建议**放弃删除**：约 **15 项**（/respond legacy、ue.ts、一次性 web-aigc 能力：ai-ppt、dynamic-chart、vision、voice、audio/ocr-recognition、static-webpage-read、open-page/report/dashboard、get-device/location-info、transaction-flow）。
- 🗄️ legacy 死分支：sliderule.ts 内所有 `isLegacyNodeBusinessEnabled()` 动态导入路径（orchestrate/execute/respond 的 Node 业务），默认与生产环境永不加载，V5 live 闭环后可物理删除。
