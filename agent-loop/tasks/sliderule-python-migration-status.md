# SlideRule Python 迁移任务状态

这个文件是给人看的迁移总表，用来回答“哪一片已经执行完、哪一片还没做”。详细的机器运行记录仍然放在 `.agent-loop/latest/` 和 `.agent-loop/runs/`，这些目录是运行产物，不提交。

## 状态规则

- `[x]`：已经实现并通过当前记录的 gate 或 live 验证。
- `[ ]`：还没有迁移，或没有足够验证证据。
- `provenance="python-llm"`：Python 真 LLM 输出，不是旧 RAG 罐头。
- `provenance="python-rag"`：仍走旧 Python mapped/RAG 路径，后续需要按能力逐片替换。

## 能力迁移清单

- [x] `intent.clarify`：已迁到 Python 真脑子，返回 `python-llm`。
- [x] `gap.ask`：已迁到 Python 真脑子，返回 `python-llm`。
- [x] `question.expand`：已迁到 Python 真脑子，返回 `python-llm`。
- [x] `critique.generate`：已迁到 Python 真脑子，返回 `python-llm`。
- [x] `synthesis.merge`：已迁到 Python 真脑子，返回 `python-llm`。
- [x] `rebuttal.resolve`：已迁到 Python 真脑子，返回 `python-llm`。
- [x] `counter.argue`：已迁到 Python 真脑子，返回 `python-llm`。
- [x] `structure.decompose`：已迁到 Python 真脑子，返回 `python-llm`。
- [x] `report.write`：已迁到 Python native JSON LLM（Python 原生 JSON 大模型）路径，返回 `python-llm`。
- [x] `risk.analyze`：已迁到 Python 真脑子，返回 `python-llm`。
- [x] `evidence.search`：已迁到 Python 真脑子，返回 `python-llm`，并保留 sources（来源）形状。
- [x] `document.draft`：已迁到 Python 真脑子，返回 `python-llm`。
- [x] `traceability.matrix`：已迁到 Python 真脑子，返回 `python-llm`。
- [x] `task.write`：已迁到 Python 真脑子，返回 `python-llm`。
- [x] `instruction.package`：已迁到 Python 真脑子，返回 `python-llm`。
- [x] `outcome.visualize`：已迁到 Python 真脑子，返回 `python-llm`；`ux.preview` 未迁。
- [x] `handoff.package`：已迁到 Python 真脑子，返回 `python-llm`。
- [ ] `ux.preview`：仍按未迁处理，本轮明确没有顺手迁它。
- [ ] 其它未建任务/未审计的 SlideRule V5 能力：不能按已迁移处理。

## 最近验证记录

### `gap.ask`

- 最近执行：`loop` 结束时会自动回写；也可手动执行 `npm run sync:task-status -- --task agent-loop/tasks/migrate-sliderule-gap-ask.md --include-migration-status`

- AgentLoop 报告：`.agent-loop/latest/final-report.md`
- 预期结果：`DONE_GATE_ONLY` / `runMode=gate-only`

已记录通过的 gate：

- [x] Python pytest：`tests/test_capabilities.py tests/test_config.py tests/test_v5_smoke.py tests/test_v5_contract_expansion.py`
- [x] Node vitest：`sliderule.execute-capability.test.ts` 和 `sliderule.live-delegation.test.ts`
- [x] TypeScript：`pnpm exec tsc --noEmit --pretty false`
- [x] mojibake：`node agent-loop/src/check-mojibake.js ...`
- [x] 手工 live smoke：隔离端口验证 `intent.clarify` / `gap.ask` 返回 `python-llm`

### `intent.clarify`

- 状态：已实现并验证通过
- 结果：Node 在 Python mode 下委托 Python，Python 返回 `python-llm`
- 这条也是 gate-only 验证闭环，不代表 AgentLoop 这轮做了 Grok 自动修复。
- 注意：旧文档里的 `python-rag` 说法已经过时；真脑子路径应记录为 `python-llm`

### `question.expand`

- 状态：已实现并验证通过
- AgentLoop run id：`2026-06-17T02-07-11-436Z`
- AgentLoop 结果：`DONE_GATE_ONLY`
- 运行模式：`gate-only`
- Grok 已运行：`false`
- Codex 已运行：`false`
- 结果：Node 在 Python mode 下委托 Python，Python 返回 `python-llm`
- 说明：这条是对话类能力，沿用 markdown 输出策略；不是结构化 JSON 能力迁移模板。

已记录通过的 gate：

- [x] Python pytest：`tests/test_capabilities.py tests/test_config.py tests/test_v5_smoke.py tests/test_v5_contract_expansion.py`
- [x] Node vitest：`sliderule.execute-capability.test.ts` 和 `sliderule.live-delegation.test.ts` 默认 gate
- [x] TypeScript：`pnpm exec tsc --noEmit --pretty false`
- [x] mojibake：`node agent-loop/src/check-mojibake.js ...`

## 分层进度口径

这些比例只用于把范围说清楚，不要把它们混成一个总数。尤其不能把 SlideRule 某条链路的高进度，误报成整个 NodeJS 后端的迁移进度。

| 范围 | 当前判断 | 说明 |
|---|---:|---|
| 整体 NodeJS 后端迁 Python | 约 10-14% | 大分母仍是整个 NodeJS backend。SlideRule V5 能力覆盖明显前进，但 Blueprint/Autopilot、LLM infra、RAG/vector、auth/admin/audit/permission、executor/tasks 等大块仍在 Node。 |
| SlideRule V5 子系统迁移 | 约 76-82% | 对话、审议、结构化报告、delivery chain（交付链）和主要 Node delegation（Node 委托）已成片通过 gate；剩余重点是 `ux.preview`、live/部署策略、RAG/vector 与边缘能力审计。 |
| SlideRule V5 Node 到 Python 薄代理链路 | 约 92-95% | Python mode、delegation helper、contract smoke、delivery/visual/artifact capability 白名单已比较完整；仍需继续守住 live smoke、错误处理和未迁 capability 边界。 |
| Python V5 可运行基线 | 约 78-83% | Python 服务、核心 smoke、contract expansion、native LLM capability 路径已稳定；RAG/vector、配置清理、部署策略、真实检索与运行观测仍要继续补。 |
| LLM infra 迁移 | 约 20-30% | Python `sliderule_llm` 已支撑 chat、基础 JSON、基础 pool 和当前 SlideRule 能力，但 provider fallback、pool hardening、JSON hardening、telemetry/cost、并发/熔断等全后端底座仍未完全对齐 Node。 |
| 能力覆盖 | 中到高 | 当前已记录的主要 SlideRule V5 `python-llm` 能力包括对话、审议、report、structure、risk/evidence、batch-3 delivery/visual/artifact；未迁和未审计能力仍不能自动视为完成。 |

## 整体迁移进度

### 当前结论

Phase 0 盘点之后，batch-2 和 batch-3 已继续推进：**整体 NodeJS 后端迁 Python 当前按约 10-14% 口径记录**。这是整体后端的大分母口径，不是 SlideRule 单子系统口径；SlideRule V5 单子系统已经明显高于这个比例。

关键原因：

- `server/` 和 `shared/` 的主要资产仍在 Node/TypeScript，尤其是 Blueprint/Autopilot、LLM infra、RAG/vector、auth/admin/audit/permission、executor/tasks、web-aigc 工具路由。
- `tws-ai-slide-rule-python/` 当前主要覆盖 SlideRule V5 baseline 和一批 native LLM capability（原生大模型能力），不是整个后端的 Python 替代服务。
- `intent.clarify`、`gap.ask`、`question.expand`、审议族、`report.write`、`structure.decompose`、`risk.analyze`、`evidence.search`、batch-3 delivery chain（交付链）已是真 LLM 或 Python native JSON LLM。
- 最近 batch-3 是人工接管的小切片迁移，并且每片都跑过 `deliveryGates`；这代表 SlideRule V5 能力覆盖前进，不代表 Grok 自动修复能力或整个后端迁移完成。

Phase 0 盘点任务文档：`agent-loop/tasks/backend-python-phase0-inventory.md`

LLM infra 审计任务文档：`agent-loop/tasks/backend-python-llm-infra-audit.md`

LLM config parity 任务文档：`agent-loop/tasks/backend-python-llm-config-parity.md`

### LLM infra 当前结论

`tws-ai-slide-rule-python/sliderule_llm/` 已经是真实现，不是旧 `services/*.py` 那类罐头 stub。它能做主 LLM 配置、基础 chat/responses 调用、基础 JSON 解析和基础 pool 调用，因此可以支撑当前几片 SlideRule 对话类能力。

2026-06-17 已完成 **LLM config parity 第一片**：

- Python `LlmConfig` 已补 `router_model`、`model_fallbacks`、`max_context`、`max_concurrent`、`provider_name`、`chat_thinking_type`。
- Python 已新增 `FallbackLlmConfig` / `get_fallback_llm_config()`，能读取 `FALLBACK_LLM_*`，但还没有接入真实 fallback provider 链。
- Python `PoolConfig` 已补 `wire_api`，并对齐 Blueprint pool 的 base/model/timeout 默认值和 gpt-5 pool wire 推断。
- `pool.py` 已修复旧 `LlmConfig(...)` 构造路径，避免新增字段导致 pool 运行时报错。
- AgentLoop run：`2026-06-17T02-51-25-969Z`，结果 `DONE_GATE_ONLY`，`20 passed, 1 skipped` + mojibake gate 通过。

但它还不能作为整个后端的 Python LLM 底座。Node 侧仍有这些关键能力没有 Python 等价实现：

- `FALLBACK_LLM_*` provider fallback。
- `LLM_MODEL_FALLBACKS` 模型 fallback。
- provider cooldown、global cooldown、retry/backoff、并发限制。
- SSE / stream 解析、多模态 content parts、vision/fallback 配置。
- usage/cost/telemetry 统计。
- `SLIDERULE_JSON_LLM_MAX_TOKENS`、空 JSON shape retry、finish reason/length 处理。
- `BLUEPRINT_SPEC_DOCS_LLM_POOL_WIRE_API`、pool 504 penalty、pool metadata、spec-doc markdown 形状校验。
- 代理环境下的 `NO_PROXY` / `LLM_PROXY_THROUGH` 等 Node 侧运行细节。

所以 LLM infra 单层可以记为 **约 20-30%**；整体后端仍只按 **约 10-14%** 记录。不要因为 SlideRule V5 的 capability 覆盖提升，就把整个 Node backend 的迁移比例一起抬高。

`agent-loop` 可以用于 NodeJS 到 Python 迁移，而且方向合适。但它的定位应该是：

> NodeJS 到 Python 迁移的切片执行器、gate runner、自动修复工作单元。

不要把它当成：

> 一键把整个 Node 后端迁到 Python 的全自动迁移器。

整体迁移任务太大，边界、测试、架构决策、数据兼容、部署策略都不够单一。如果直接给 AgentLoop “把整个 NodeJS 后端迁到 Python” 这种任务，自动循环很容易改到不该改的地方。

### 适合交给 AgentLoop 的迁移单位

- 一个 endpoint。
- 一个 `capabilityId`。
- 一个 Node 到 Python delegation 白名单扩展。
- 一个 Python parity test。
- 一个 live smoke gate。
- 一个数据、密钥、运行产物清理任务。

### 不适合交给 AgentLoop 的任务

- 把整个 NodeJS 后端迁移到 Python。
- 一次迁多个无关子系统。
- 同时改业务逻辑、部署策略、密钥配置和 UI。
- 没有明确 allowed files、gate、成功标准的开放式迁移。

### 推荐迁移节奏

1. 先跑 audit-only 基线。
   - 不让它改代码。
   - 只跑 gate，确认当前迁移切片是否健康。
   - 用来检查 Python baseline、Node thin proxy、TypeScript、mojibake。

2. 再按 capability 或 route 做小步迁移。
   - 一次只迁一个 capability。
   - 或者只迁一组强相关 capability。
   - 每片都要有独立任务文件。

3. 每个切片必须绑定 gate。
   - Python pytest。
   - Node vitest。
   - TypeScript。
   - 必要时加 live Node 到 Python smoke。
   - 文档或中文报告改动加 mojibake 扫描。

4. 每轮保留人工暂停点。
   - `--pause-before-fix`
   - `--pause-after-iteration`
   - `--guard-tests`
   - `--max-iterations 1` 或 `2`

### 第一批任务建议

| 顺序 | 任务 | 状态 | 原因 |
|---|---|---|---|
| 1 | 建立迁移切片模板 | 已完成 | 固定任务格式，避免每次任务描述漂移。 |
| 2 | 建立 audit-only gate 任务 | 已完成 | 让 AgentLoop 先成为迁移体检工具。 |
| 3 | 迁移 `intent.clarify` | 已完成 | 低风险对话类能力，适合先接 Python 真 LLM。 |
| 4 | 迁移 `gap.ask` | 已完成 | 同属对话类能力，已验证 `python-llm`。 |
| 5 | 迁移 `question.expand` | 已完成 | 同属对话类能力，沿用 markdown 输出策略。 |
| 6 | 迁移 `critique.generate` | 已完成 | 审议族第一片。 |
| 7 | 队列 batch-2（infra + 审议族 + 结构化） | 已完成 | 11/11 `DONE_REVIEWED`，但只代表这些切片通过当前 gate，不代表整个 Node backend 迁移完成。 |
| 8 | 队列 batch-3（delivery + visual + artifact capabilities） | 已完成 | 6/6 已人工接手完成并通过 `deliveryGates`；不代表整个 Node backend 迁移完成。 |

### batch-3 任务

这批不提前打勾。每个任务都必须跑过 `deliveryGates` 后，才能把对应 capability（能力）标为迁移完成。

- [x] `document.draft`：`agent-loop/tasks/migrate-sliderule-document-draft.md`（2026-06-19，人工接手完成，`deliveryGates` 全绿）
- [x] `traceability.matrix`：`agent-loop/tasks/migrate-sliderule-traceability-matrix.md`（2026-06-19，AgentLoop `DONE_REVIEWED` 为空 diff 假完成，人工接手完成，`deliveryGates` 全绿）
- [x] `task.write`：`agent-loop/tasks/migrate-sliderule-task-write.md`（2026-06-19，人工接手完成，`deliveryGates` 全绿）
- [x] `instruction.package`：`agent-loop/tasks/migrate-sliderule-instruction-package.md`（2026-06-19，人工接手完成，`deliveryGates` 全绿）
- [x] `outcome.visualize`：`agent-loop/tasks/migrate-sliderule-outcome-visualize.md`（2026-06-19，人工接手完成，`deliveryGates` 全绿；未迁 `ux.preview`）
- [x] `handoff.package`：`agent-loop/tasks/migrate-sliderule-handoff-package.md`（2026-06-19，人工接手完成，`deliveryGates` 全绿；batch-3 delivery chain 收束）

### 推荐 AgentLoop 命令形态

示例以单个 SlideRule capability 迁移为单位：

```powershell
node agent-loop/src/loop.js `
  --cwd C:\Users\wangchunji\Documents\cube-pets-office `
  --fix-cwd C:\Users\wangchunji\Documents\cube-pets-office `
  --task agent-loop/tasks/migrate-sliderule-question-expand.md `
  --gate "cd tws-ai-slide-rule-python; .\.venv\Scripts\python.exe -m pytest tests/test_capabilities.py tests/test_config.py tests/test_v5_smoke.py tests/test_v5_contract_expansion.py -q --tb=short" `
  --gate "pnpm exec vitest run --config vitest.config.server.ts server/routes/__tests__/sliderule.execute-capability.test.ts server/routes/__tests__/sliderule.live-delegation.test.ts --reporter=dot" `
  --gate "pnpm exec tsc --noEmit --pretty false" `
  --gate "node agent-loop/src/check-mojibake.js agent-loop/tasks tws-ai-slide-rule-python server/routes/__tests__" `
  --pause-before-fix `
  --pause-after-iteration `
  --guard-tests `
  --max-iterations 1 `
  --auto-fix
```

这条命令的意图是：可以自动修，但每轮都要有 gate 和人工暂停点，不让它一路狂奔。

## 下一步候选

batch-3 delivery chain（交付链）已完成，`backend-python-llm-infra-audit` 已形成审计结论。下一片建议回到 LLM infra 的 Phase 1 parity，把底座补硬；不要直接冲 `orchestrate.plan` 这类更大范围的结构化编排能力。

| 顺序 | 建议任务 | 目标 |
|---|---|---|
| 1 | `backend-python-llm-config-parity.md` | 已完成第一片：Python 能读懂 router/fallback/model fallback/max context/chat thinking/pool wire 等 env 契约。 |
| 2 | `backend-python-llm-client-parity.md` | 已建任务 + 红灯测试，在队列第 1 项。 |
| 3 | `backend-python-llm-pool-parity.md` | 已建任务 + 红灯测试，在队列第 2 项。 |
| 4 | `backend-python-llm-json-hardening.md` | 已建任务 + 红灯测试，在队列第 3 项。 |
| 5 | `ux.preview` 审计/迁移任务 | 尚未建为本轮完成任务；`outcome.visualize` 已迁，但 `ux.preview` 明确未迁。 |
| 6 | `orchestrate.plan` / 更大结构化编排能力 | 等 JSON hardening、pool/client parity 更稳后再切，不建议现在直接上。 |

结构化 JSON 类能力不要直接套 `question.expand` 的散文策略。`report.write` 已先迁成 Python native JSON LLM，后续更大的 `orchestrate.plan` 仍应等 JSON hardening、pool/client parity、错误恢复都更稳后再动。

## 提交前检查

- [ ] 只暂存本次任务相关文件，绝不使用 `git add -A`。
- [ ] 不暂存 `.agent-loop/`、`tmp/`、`probes/`、`.env`、日志、缓存、`tws-ai-slide-rule-python/data/`。
- [ ] 不提交真实密钥、数据库密码、Qdrant key、Bearer token。
- [ ] 如果只改文档，至少跑 `node agent-loop/src/check-mojibake.js agent-loop/tasks`。
- [ ] 如果改代码，重新跑对应 Python、Node、TypeScript gate。
