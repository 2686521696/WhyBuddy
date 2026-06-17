# 后端 NodeJS 到 Python 迁移 Phase 0 盘点

## 执行状态

- 最近执行：2026-06-17
- 最近确认：2026-06-17
- AgentLoop run id：`2026-06-17T01-53-42-073Z`
- AgentLoop 本地时间：`2026-06-17 09:53:42 (Asia/Shanghai)`
- AgentLoop 结果：`DONE_GATE_ONLY`
- AgentLoop 运行模式：`gate-only`
- Grok 已运行：`false`
- Codex 已运行：`false`
- gate 结果：baseline gate 为 green，failure count 为 0

## 任务清单

- [x] 1. 建立 Phase 0 盘点任务入口
  - [x] 1.1 新建本任务文件，明确只读盘点目标
  - [x] 1.2 写清楚允许范围、禁止事项和不提交运行产物规则
  - [x] 1.3 写清楚 Phase 0 gate 和 AgentLoop 命令

- [x] 2. 跑通 AgentLoop gate-only 闭环
  - [x] 2.1 运行 `cd agent-loop; npm test`
  - [x] 2.2 运行 mojibake 检查
  - [x] 2.3 运行后端迁移关键词扫描
  - [x] 2.4 确认 AgentLoop 结果为 `DONE_GATE_ONLY`
  - [x] 2.5 确认 `## 执行状态` 已自动回写

- [x] 3. 盘点 Node 后端迁移分母
  - [x] 3.1 扫描 `server/`，按 route、core、service、LLM infra、测试分组
  - [x] 3.2 扫描 `shared/`，标出后端契约、前后端共享类型和不能直接迁移的兼容层
  - [x] 3.3 扫描 `tws-ai-slide-rule-python/`，标出已有 Python 对应实现
  - [x] 3.4 列出只有 Node 实现、只有 Python stub、已有 Python 真实现三类资产

- [x] 4. 形成 Phase 0 盘点结论
  - [x] 4.1 输出 Node 后端资产分组表
  - [x] 4.2 校准整体 NodeJS 后端迁 Python 进度是否仍为约 8-12%
  - [x] 4.3 拆出从 10% 到 25%、40%、70%、100% 的阶段路线
  - [x] 4.4 给出 Phase 1 推荐任务，不超过 3 个

- [x] 5. 更新迁移状态文档
  - [x] 5.1 将 Phase 0 盘点结论补进 `sliderule-python-migration-status.md` 或后续总表
  - [x] 5.2 明确本轮是 `gate-only`，不是 Grok 自动修复，也不是业务迁移完成
  - [x] 5.3 重新跑 mojibake 检查

## Phase 0 盘点结论

本轮结论很直接：**整体 NodeJS 后端迁 Python 仍应按约 8-12% 口径看待，不能因为 SlideRule V5 局部链路已经较成熟，就把整个后端进度抬高。**

原因是整体后端的分母很大：`server/` 约 1191 个文件，其中 `server/routes/` 约 519 个文件、`server/tests/` 约 387 个文件、`server/core/` 约 102 个文件；`shared/` 约 214 个文件，其中 `shared/blueprint/` 约 96 个文件。Python 侧当前主要集中在 `tws-ai-slide-rule-python/`，排除运行目录后约 37 个文件，入口也集中在 `/api/sliderule/*`。

所以当前不是“整体后端迁了一半”，而是：

- SlideRule V5 这条局部链路已经具备 Python 后端、Node 委托、contract 测试和部分真 LLM 能力。
- Blueprint、LLM infra、RAG/vector、auth/admin/audit/permission、web-aigc 工具路由、任务执行器、部署配置等大块仍主要在 Node。
- `agent-loop` 现在适合继续用作切片迁移的 gate runner，不适合直接下达“一次迁完整个后端”的开放式任务。

## Node 后端资产分组表

| 资产组 | Node 现状 | Python 对应 | 迁移状态 | 风险 | 推荐阶段 |
|---|---|---|---|---|---|
| SlideRule V5 路由与能力 | `server/routes/sliderule.ts`，包含 sessions、orchestrate-plan、execute-capability、respond 等路径 | `tws-ai-slide-rule-python/app.py`、`routes/sliderule_full.py`、`sliderule_llm/capabilities.py`、`services/capability_maps.py` | 局部迁移中；Node 在 `SLIDERULE_V5_BACKEND=python` 下可委托一批 V5 capability | 中：能力覆盖和 provenance 仍需逐片校准 | Phase 1 继续 |
| Blueprint / Autopilot 主流程 | `server/routes/blueprint/` 和 `shared/blueprint/` 是最大业务块之一，包含 spec tree、spec docs、effect preview、role runtime、replan、traceability 等 | 暂无同等 Python 服务 | 基本未迁 | 高：业务链路深、契约多、前端依赖强 | Phase 2 |
| LLM infra / provider pool | `server/core/*`、`server/routes/blueprint/llm-key-pool.ts`、`server/sliderule/pool-json-llm.ts` 等 | `sliderule_llm/client.py`、`sliderule_llm/pool.py` 只覆盖 SlideRule Python 侧 | 部分能力可用，但不是全后端 LLM 平台 | 高：模型输出契约、代理、重试、密钥池和结构化解析都要统一 | Phase 1 |
| RAG / vector / knowledge | `server/rag/`、`server/knowledge/`、`shared/rag/` 等 | Python 当前主要是 `services/rag_service.py` 的 baseline，未证明完整 Qdrant/embedding parity | 低到中 | 高：数据兼容、索引、证据 provenance、迁移脚本 | Phase 2 |
| Auth / admin / audit / permission | `server/auth/`、`server/audit/`、`server/permission/` 及对应 routes/shared contracts | 暂无通用 Python 对应 | 基本未迁 | 高：安全、权限、审计不能用 stub 顶替 | Phase 3 |
| web-aigc 工具路由 | `/api/ai-ppt`、`audio-recognition`、`dynamic-chart`、`excel-read`、`file-*`、`image-search`、`ocr-recognition`、`web-search` 等 | 暂无统一 Python 对应 | 基本未迁 | 中到高：每个工具有独立外部依赖和输出契约 | Phase 3 |
| Mission / executor / tasks | `/api/executor/events`、`/api/tasks/smoke/*`、`shared/mission`、`shared/executor` | 暂无通用 Python 对应 | 基本未迁 | 高：状态机、回调签名、运行时事件不能丢 | Phase 3 |
| Shared contracts | `shared/` 内大量前后端共享类型、契约、测试、domain helpers | Python 不能直接“迁移” TypeScript shared，需要生成或重写契约层 | 未建立系统性同步方案 | 高：前端仍依赖 TS 类型，必须先定 contract source of truth | Phase 2 |
| 部署 / 配置 / 密钥 | Node `.env`、provider/env、内部 key、代理、持久化路径 | Python 有基础 settings，但仍存在配置清理和密钥外置待办 | 未成熟 | 高：泄密、环境漂移、启动顺序和健康检查 | Phase 1 |

## Python 对应实现状态

| Python 侧资产 | 已覆盖 | 未覆盖或待确认 |
|---|---|---|
| `app.py` | FastAPI 服务、`/health`、挂载 `/api/sliderule/*`、`drive-full` | 不是通用后端入口；只服务 SlideRule V5 baseline |
| `routes/sliderule_full.py` | sessions、orchestrate-plan、execute-capability、drive-turn、coverage | 没有 Blueprint、auth、admin、web-aigc、executor 等通用后端路由 |
| `sliderule_llm/capabilities.py` | `intent.clarify`、`gap.ask` 已走真 LLM，返回 `python-llm` | `question.expand` 等对话类还未接真 LLM；结构化 JSON 类能力仍要另定策略 |
| `services/capability_maps.py` | 多个 V5 capability 有 `python-rag` baseline 输出，如 `report.write`、`structure.decompose`、`traceability.matrix`、`handoff.package` | 这些是 mapped/RAG baseline，不等于全部真脑子或历史 Node parity |
| Python tests | `test_capabilities.py`、`test_v5_contract_expansion.py`、`test_v5_smoke.py` 等验证了当前 SlideRule 切片 | 还没有整体后端 route-family parity test matrix |

## 资产状态分类

| 分类 | 当前例子 | 判断 |
|---|---|---|
| 已有 Python 真实现 | `intent.clarify`、`gap.ask` | 真 LLM 路径，`provenance="python-llm"`，适合继续按同类 capability 扩展 |
| 已有 Python baseline / mapped 实现 | `report.write`、`structure.decompose`、`traceability.matrix`、`handoff.package` 等 | 能跑 contract，但多为 `python-rag` baseline，需要逐片审计是不是足够替代 Node |
| 只有 Node 实现 | Blueprint 主流程、web-aigc 工具路由、auth/admin/audit/permission、executor/tasks、多数 shared domain helpers | 这些才是把整体迁移从 10% 往上推的主要分母 |
| 共享契约，不应直接按后端代码迁移 | `shared/blueprint/*`、`shared/executor/*`、`shared/mission/*`、`shared/rag/*` | 需要先决定 TS/Python contract 的同步方式，否则会造成前后端语义漂移 |
| 配置/部署成熟度不足 | Python settings、内部 key、RAG/vector、持久化、启动健康检查 | 迁移百分比不能只看代码文件，要把这些纳入完成条件 |

## 分层进度校准

| 范围 | Phase 0 校准 | 理由 |
|---|---:|---|
| 整体 NodeJS 后端迁 Python | 约 8-12% | Python 侧主要覆盖 SlideRule 局部；Node 仍有大量 route family、core、shared contract 和测试资产 |
| SlideRule V5 子系统迁移 | 约 58-62% | Python baseline、Node 委托、部分 contract 和两片真 LLM capability 已建立 |
| SlideRule V5 Node 到 Python 薄代理链路 | 约 85% | `SLIDERULE_V5_BACKEND=python`、`python-delegation.ts`、execute-capability 委托链路已较成熟 |
| Python V5 可运行基线 | 约 70% | FastAPI + smoke/contract 可跑，但 RAG/vector、配置清理、部署策略仍未完成 |
| 能力覆盖 | 低到中 | 只有 `intent.clarify`、`gap.ask` 明确是真 LLM；其它多为 baseline/mapped |
| LLM infra 迁移状态 | 约 15-25% | Python 有 SlideRule LLM client/pool 基础，但未覆盖 Node 全局 provider pool、schema retry、代理和治理 |
| 数据、配置、部署成熟度 | 约 10-20% | Python 当前仍偏单服务 baseline，没有形成全后端部署替代方案 |

## 阶段路线

| 阶段 | 目标进度口径 | 要完成什么 | 不算完成的情况 |
|---|---:|---|---|
| Phase 0 | 约 10% | 分母盘点、gate-only 跑通、明确哪些是 SlideRule 局部进度 | 只跑通 SlideRule 不能算整体上升 |
| Phase 1 | 约 25% | 完成 SlideRule 对话类能力、LLM infra Python audit、配置/密钥清理、Python 启动与 smoke 稳定 | 只有新增 prompt，没有 contract/live gate |
| Phase 2 | 约 40% | 选一个大 route family 做 Python parity，建议 Blueprint/Autopilot 先从只读或纯服务层切片开始 | 只搬文件、不保留 TS contract 和前端兼容 |
| Phase 3 | 约 70% | RAG/vector、auth/admin/audit/permission、executor/tasks、web-aigc 工具族分批迁移并有双跑/回退 | Python 只有 stub 或假成功 |
| Phase 4 | 100% | Node 只剩静态托管或被移除；Python 拥有路由、契约、数据、部署、监控、回滚和安全策略 | 没有生产切换、回滚和历史数据兼容 |

## Phase 1 推荐任务

先不要追求“一口气 50%”。下一步最多开 3 个任务：

1. `migrate-sliderule-question-expand.md`：继续迁对话类 capability，沿用 markdown 输出和 `python-llm` 断言。
2. `backend-python-llm-infra-audit.md`：盘点 Node LLM infra 到 Python 的最小替代层，重点是 provider pool、代理、结构化输出、重试和密钥治理。
3. `blueprint-python-phase0-inventory.md`：单独盘点 Blueprint/Autopilot route family，拆出第一个可迁的纯服务层切片。

这三个任务里，`question.expand` 最快见效；`LLM infra audit` 最能提升整体迁移的真实基础；`Blueprint phase0` 是把整体进度从 10% 往 25% 推的最大分母准备。

## 目标

先跑通 Phase 0，只做整体后端迁移盘点，不改业务代码。

这一步的目标不是把功能迁到 Python，而是把“整体 NodeJS 后端迁 Python”的分母列清楚：

- 哪些 Node 后端资产已经有 Python 对应实现。
- 哪些资产只有 Node 实现。
- 哪些资产目前只是 SlideRule 局部迁移。
- 哪些资产属于共享契约或前端依赖，不能简单按后端迁移计算。
- 下一波最值得迁移的后端 tranche 是什么。

## 范围

只读审计这些区域：

- `server/`
- `shared/`
- `tws-ai-slide-rule-python/`
- `agent-loop/tasks/sliderule-python-migration-status.md`
- 相关测试文件

允许本轮更新的文件只有：

- `agent-loop/tasks/backend-python-phase0-inventory.md`
- `agent-loop/tasks/sliderule-python-migration-status.md`，仅限补充 Phase 0 结论时使用

## 禁止事项

- 不迁移任何 capability。
- 不修改 `client/`。
- 不修改 Node 业务实现。
- 不修改 Python 业务实现。
- 不暂存、不提交。
- 不使用 `git add -A`。
- 不提交 `.agent-loop/`、`tmp/`、`probes/`、`.env`、日志、cache、`tws-ai-slide-rule-python/data/`。
- 不加入或打印真实密钥、数据库密码、Qdrant key、Bearer token。

## 盘点输出要求

最终报告必须包含：

- Node 后端资产分组表。
- Python 对应实现状态。
- 当前整体迁移百分比是否仍应保持在约 8-12%。
- 从 10% 往 25%、40%、70%、100% 推进的阶段路线。
- Phase 1 推荐任务，不超过 3 个。

报告必须分层，不要把这些比例混成一个总数：

- 整体 NodeJS 后端迁 Python。
- SlideRule V5 子系统迁移。
- Node 到 Python 薄代理链路。
- Python V5 可运行基线。
- 能力覆盖。
- LLM infra 迁移状态。
- 数据、配置、部署成熟度。

## 必跑 gate

Phase 0 是只读盘点，先用轻量 gate 确认 AgentLoop 本体、迁移状态文档和关键测试入口可用。

```powershell
cd agent-loop; npm test
```

```powershell
node agent-loop/src/check-mojibake.js agent-loop/tasks agent-loop/src agent-loop/test
```

```powershell
rg -n -e intent\.clarify -e gap\.ask -e question\.expand -e report\.write -e structure\.decompose -e provenance -e SLIDERULE_V5_BACKEND -e python-delegation server shared tws-ai-slide-rule-python agent-loop/tasks
```

## AgentLoop 命令

从仓库根目录运行：

```powershell
node agent-loop/src/loop.js `
  --cwd C:\Users\wangchunji\Documents\cube-pets-office `
  --task agent-loop/tasks/backend-python-phase0-inventory.md `
  --gate "cd agent-loop; npm test" `
  --gate "node agent-loop/src/check-mojibake.js agent-loop/tasks agent-loop/src agent-loop/test" `
  --gate "rg -n -e intent\.clarify -e gap\.ask -e question\.expand -e report\.write -e structure\.decompose -e provenance -e SLIDERULE_V5_BACKEND -e python-delegation server shared tws-ai-slide-rule-python agent-loop/tasks" `
  --skip-review `
  --max-iterations 1 `
  --lang zh-CN
```

## 成功标准

- AgentLoop 能以 `DONE_GATE_ONLY` 跑完。
- final report 是中文可读。
- `## 执行状态` 被自动回写。
- 不产生业务代码 diff。
- 运行产物只留在 `.agent-loop/`，不提交。
- Phase 0 给出下一步迁移分母和优先级。
