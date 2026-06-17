# 后端 NodeJS 到 Python 迁移：LLM infra 审计

## 执行状态

- 状态：LLM infra 审计结论已写入，并通过 AgentLoop gate-only 复核
- 最近执行：2026-06-17
- 最近确认：2026-06-17
- AgentLoop run id：`2026-06-17T02-40-30-751Z`
- AgentLoop 结果：`DONE_GATE_ONLY`
- AgentLoop 运行模式：`gate-only`
- Grok 已运行：`false`
- Codex 已运行：`false`
- gate 结果：baseline gate 为 green，failure count 为 0
- 注意：`.agent-loop/` 是运行产物，不提交；任务文档只记录人看的摘要状态。

- AgentLoop 本地时间：`2026-06-17 10:40:30 (Asia/Shanghai)`
## 任务清单

- [x] 1. 建立 LLM infra 审计任务入口
  - [x] 1.1 新建本任务文件，明确这是只读审计，不是业务迁移
  - [x] 1.2 写清楚允许范围、禁止事项和必跑 gate
  - [x] 1.3 写清楚 AgentLoop gate-only 命令

- [x] 2. 盘点 Node LLM infra 分母
  - [x] 2.1 扫描 `server/core/ai-config.ts`，列出配置来源、优先级、wire API、timeout、reasoning 参数
  - [x] 2.2 扫描 `server/core/llm-client.ts`，列出 chat/completions、responses、JSON 解析、usage、错误归一化
  - [x] 2.3 扫描 `server/sliderule/pool-json-llm.ts`，列出 primary/pool、parallel/sequential、熔断、fallback 行为
  - [x] 2.4 扫描 `server/routes/blueprint/llm-key-pool.ts`，列出 Blueprint key pool 规则和 env 契约
  - [x] 2.5 扫描直接调用 LLM 的 route/service，列出还有哪些绕过统一入口的调用点

- [x] 3. 盘点 Python LLM infra 现状
  - [x] 3.1 扫描 `tws-ai-slide-rule-python/sliderule_llm/config.py`
  - [x] 3.2 扫描 `tws-ai-slide-rule-python/sliderule_llm/client.py`
  - [x] 3.3 扫描 `tws-ai-slide-rule-python/sliderule_llm/pool.py`
  - [x] 3.4 扫描 `tws-ai-slide-rule-python/tests/test_config.py` 和 `tests/test_su8_live.py`
  - [x] 3.5 标出 Python 已有能力、缺失能力、假 stub 或不该继续依赖的路径

- [x] 4. 形成 LLM infra parity 表
  - [x] 4.1 输出 Node 与 Python 对照表
  - [x] 4.2 列出必须迁移的 env 契约
  - [x] 4.3 列出结构化输出/JSON 解析策略缺口
  - [x] 4.4 列出代理、超时、重试、熔断、fallback 的缺口
  - [x] 4.5 列出密钥治理和日志脱敏风险

- [x] 5. 给出 Phase 1 实施建议
  - [x] 5.1 拆出不超过 3 个后续实现任务
  - [x] 5.2 明确哪些任务适合 AgentLoop 自动修复，哪些必须人工审查
  - [x] 5.3 更新 `sliderule-python-migration-status.md` 或后续总表中的 LLM infra 进度口径
  - [x] 5.4 重新跑 mojibake 检查

## 目标

这一步只做 **LLM infra 盘点**，不迁业务能力、不改生产逻辑。

目标是回答这些问题：

- Node 后端当前到底有哪些 LLM 入口。
- Python 侧 `sliderule_llm` 已经覆盖了哪些入口。
- Python 侧还缺哪些关键能力，导致它不能作为整个后端的 LLM 基础设施。
- 结构化 JSON 输出、reasoning 模型不守 schema、provider fallback、代理、超时、pool、密钥治理这些问题，应该怎么拆成后续任务。
- 如果要把整体 NodeJS 后端迁 Python 从约 10% 推到约 25%，LLM infra 要先补哪几块。

## 范围

只读审计这些区域：

- `server/core/ai-config.ts`
- `server/core/llm-client.ts`
- `server/sliderule/pool-json-llm.ts`
- `server/sliderule/orchestrate-plan.ts`
- `server/sliderule/json-llm-call.ts`
- `server/routes/blueprint/llm-key-pool.ts`
- `server/routes/blueprint/**/policy.ts`
- `server/routes/blueprint/**/service.ts`
- `server/tests/*llm*`
- `shared/llm/`
- `tws-ai-slide-rule-python/sliderule_llm/`
- `tws-ai-slide-rule-python/tests/test_config.py`
- `tws-ai-slide-rule-python/tests/test_su8_live.py`
- `tws-ai-slide-rule-python/PHASE1_LLM_STATUS.md`
- `agent-loop/tasks/sliderule-python-migration-status.md`

允许本轮更新的文件只有：

- `agent-loop/tasks/backend-python-llm-infra-audit.md`
- `agent-loop/tasks/sliderule-python-migration-status.md`，仅限补充 LLM infra 审计结论时使用

## 禁止事项

- 不修改 `client/`。
- 不迁移任何 capability。
- 不修改 Node LLM 实现。
- 不修改 Python LLM 实现。
- 不修改 `.env`。
- 不打印真实 API key、数据库密码、Qdrant key、Bearer token。
- 不启动真实 live LLM，除非后续单独确认。
- 不暂存、不提交。
- 不使用 `git add -A`。
- 不提交 `.agent-loop/`、`tmp/`、`probes/`、日志、cache、`tws-ai-slide-rule-python/data/`。

## 审计输出要求

最终报告必须包含：

- Node LLM infra 资产分组表。
- Python LLM infra 对应实现状态表。
- Node env 与 Python env 对照表。
- 结构化输出/JSON 解析缺口。
- provider/pool/fallback 缺口。
- 代理、超时、重试、熔断缺口。
- 密钥治理和日志脱敏风险。
- 对整体迁移进度的影响。
- 后续 Phase 1 实施任务，不超过 3 个。

## 重点问题

审计时要特别小心这几个点：

- `rcouyi/gemini` 这类 reasoning 模型对严格 JSON schema 不稳定，不能简单把 `question.expand` 的 markdown 策略套到 `orchestrate-plan`。
- Node 侧有 primary LLM、pool LLM、Blueprint key pool、vision/fallback LLM 等多套入口，不能只看 `server/core/llm-client.ts`。
- Python `sliderule_llm` 当前主要服务 SlideRule，不等于全后端 LLM router。
- 配置迁移不能只搬 env 名字，还要保留优先级、wire API、timeout、reasoning effort、stream、代理、错误归一化、usage 统计。
- LLM 失败不能假成功；要能区分 transient、auth、timeout、schema_parse、provider_unavailable。

## 必跑 gate

本任务是只读审计，先用轻量 gate 确认任务文件、AgentLoop 本体和关键词入口可用。

```powershell
cd agent-loop; npm test
```

```powershell
node agent-loop/src/check-mojibake.js agent-loop/tasks agent-loop/src agent-loop/test tws-ai-slide-rule-python/sliderule_llm
```

```powershell
rg -n -e llm-client -e ai-config -e pool-json-llm -e llm-key-pool -e callLLMJsonWithUsage -e callPoolJsonLlm -e LLM_WIRE_API -e LLM_REASONING_EFFORT -e BLUEPRINT_SPEC_DOCS_LLM_POOL server shared tws-ai-slide-rule-python agent-loop/tasks
```

## AgentLoop gate-only 命令

这个命令只做 gate 审计，不自动改代码：

```powershell
node agent-loop/src/loop.js `
  --cwd C:\Users\wangchunji\Documents\cube-pets-office `
  --task agent-loop/tasks/backend-python-llm-infra-audit.md `
  --gate "cd agent-loop; npm test" `
  --gate "node agent-loop/src/check-mojibake.js agent-loop/tasks agent-loop/src agent-loop/test tws-ai-slide-rule-python/sliderule_llm" `
  --gate "rg -n -e llm-client -e ai-config -e pool-json-llm -e llm-key-pool -e callLLMJsonWithUsage -e callPoolJsonLlm -e LLM_WIRE_API -e LLM_REASONING_EFFORT -e BLUEPRINT_SPEC_DOCS_LLM_POOL server shared tws-ai-slide-rule-python agent-loop/tasks" `
  --skip-review `
  --max-iterations 1 `
  --lang zh-CN
```

## 成功标准

- AgentLoop 能以 `DONE_GATE_ONLY` 跑完。
- `## 执行状态` 被自动回写。
- 不产生业务代码 diff。
- 不打印或写入真实密钥。
- Phase 1 后续任务能拆成不超过 3 个小切片。
- LLM infra 进度口径能和整体迁移进度表对齐。

## LLM infra 审计结论

结论先说清楚：**Python 侧已经有一个可用的 SlideRule-local LLM Phase 1 切片，但它还不是整个 NodeJS 后端的 LLM 基础设施替代品。**

当前 Python `sliderule_llm` 已经覆盖了这些低层能力：

- 主 LLM 配置读取：`LLM_*` / `OPENAI_*` 基础变量。
- wire 选择：`chat_completions` 与 `responses`。
- 基础 HTTP 调用：`httpx` 调 chat/completions 或 responses。
- 基础 JSON 解析：去掉 markdown fence 后解析 JSON object。
- 基础 key pool：支持 parallel / sequential，失败时返回 `None`。
- 真实能力调用：`intent.clarify`、`gap.ask`、`question.expand` 已经走 `python-llm`。

但从“整体 NodeJS 后端迁 Python”的分母看，Node 侧 LLM infra 明显更厚。Python 还缺 provider fallback、模型 fallback、重试退避、熔断、并发控制、usage/cost 统计、SSE 解析、vision/fallback 配置、Blueprint spec-doc 形状校验、pool responses wire、代理/NO_PROXY 细节和更完整的错误归一化。

因此本轮审计后，LLM infra 迁移口径建议记录为：**约 15-25%**。这个数字只代表 LLM infra 层，不代表整体后端。整体 NodeJS 后端迁 Python 仍维持 **约 8-12%**，因为大部分后端业务、数据、RAG、部署和非 SlideRule 路由还没有迁。

## Node LLM infra 资产分组表

| 分组 | 主要文件 | 当前能力 | 迁移含义 |
|---|---|---|---|
| 主 LLM 配置 | `server/core/ai-config.ts` | `LLM_*` 优先于 `OPENAI_*`；支持 router model、wire API、reasoning effort、stream、timeout、max context、chat thinking；会按代理环境调整 `NO_PROXY` | Python 不能只抄 env 名，还要保留优先级和运行时副作用 |
| 主 LLM 客户端 | `server/core/llm-client.ts` | 支持 chat/completions、responses、JSON mode、SSE、usage、provider fallback、模型 fallback、重试、冷却、并发限制、telemetry/cost、错误归一化 | 这是全后端 LLM 主干，Python 当前只迁了低配子集 |
| SlideRule JSON 调用 | `server/sliderule/json-llm-call.ts`、`server/core/llm-json-budget.ts` | 对 dialogue JSON 设更高 max tokens；reasoning 模型加预算；空 `content` 时二次放大重试 | Python `call_llm_json()` 还没有等价预算和空形状重试 |
| SlideRule pool | `server/sliderule/pool-json-llm.ts` | 复用 Blueprint key pool；代理环境默认 sequential；支持 parallel；支持 504 短惩罚、transient retry、pool label、skip primary 策略 | Python pool 只有基础 parallel/sequential，还缺稳定性策略 |
| Blueprint key pool | `server/routes/blueprint/llm-key-pool.ts` | 读取 `BLUEPRINT_SPEC_DOCS_LLM_POOL_*`；支持 pool wire API；chat/responses；spec-doc markdown 形状校验和重试 | Python pool 现在固定走 chat/completions，缺 spec-doc 形状 gate |
| Blueprint/Autopilot LLM 分支 | `server/routes/blueprint.ts`、`server/routes/blueprint/**/service.ts`、`server/routes/blueprint/**/policy.ts` | 多个 env-gated LLM 分支：spec docs、spec tree、prompt package、engineering handoff、clarification 等 | 这些不是 SlideRule capability，后续要单独盘点 route 级迁移 |
| 其它 LLM 消费者 | `server/core/agent.ts`、`server/runtime/server-runtime.ts`、`server/core/vision-provider.ts`、`server/routes/chat.ts`、`server/routes/nl-command.ts`、`server/rag/embedding/*` | agent runtime、vision、chat、NL command、embedding 等都直接或间接消费 LLM infra | 说明 LLM infra 是全后端公共底座，不能只迁 SlideRule |

## Python LLM infra 对应实现状态

| Python 文件 | 已有能力 | 缺口 |
|---|---|---|
| `tws-ai-slide-rule-python/sliderule_llm/config.py` | 读取主 LLM env、基础 wire 选择、pool keys/labels/base/model/timeout、pool race mode | 缺 `LLM_ROUTER_MODEL`、`OPENAI_ROUTER_MODEL`、`FALLBACK_LLM_*`、`LLM_MODEL_FALLBACKS`、`LLM_MAX_CONTEXT`、`LLM_CHAT_THINKING_TYPE`、`LLM_MAX_CONCURRENT`、`BLUEPRINT_SPEC_DOCS_LLM_POOL_WIRE_API` |
| `tws-ai-slide-rule-python/sliderule_llm/client.py` | `httpx` 真实调用；chat/responses；基础状态码归一；基础 JSON helper；失败时抛 `LlmError` | 缺 SSE、多模态 content parts、provider fallback、模型 fallback、重试退避、冷却、telemetry/cost、并发限制、finish reason/length 处理、usage 标准化 |
| `tws-ai-slide-rule-python/sliderule_llm/pool.py` | 低层 key pool；parallel/sequential；失败返回 `None` | pool key 调用固定 `chat_completions`；缺 responses wire、504 惩罚、transient retry、代理感知默认 sequential、pool metadata、skip primary 策略、spec-doc 形状校验 |
| `tws-ai-slide-rule-python/tests/test_config.py` | 覆盖基础 wire 选择、env 读取、pool keys/labels 解析 | 还没覆盖 router/fallback/model fallback/NO_PROXY/pool wire/并发限制 |
| `tws-ai-slide-rule-python/tests/test_su8_live.py` | opt-in live 验证主模型、JSON、pool 真实调用 | live 测试不是默认 gate；不能当作稳定 CI 证据 |
| 旧 `services/*.py` 路径 | 一些迁移早期 stub/包装 | 不应作为整体 LLM infra 依据；后续应继续把真实能力收敛到 `sliderule_llm` |

## Node env 与 Python env 对照表

| env 契约 | Node 状态 | Python 状态 | 处理建议 |
|---|---|---|---|
| `LLM_API_KEY` / `OPENAI_API_KEY` | 已支持，`LLM_*` 优先 | 已支持 | 保持 |
| `LLM_BASE_URL` / `OPENAI_BASE_URL` | 已支持，包含 providerName 推导 | 已支持基础 URL | 保持，补 providerName/诊断标签 |
| `LLM_MODEL` / `OPENAI_MODEL` | 已支持 | 已支持 | 保持 |
| `LLM_ROUTER_MODEL` / `OPENAI_ROUTER_MODEL` | 已支持，用于 router model | 缺失 | Phase 1 配置 parity 要补 |
| `LLM_WIRE_API` / `OPENAI_WIRE_API` | 已支持，显式值优先；reasoning 模型可自动 responses | 已支持主 LLM | 保持，并补 pool wire |
| `LLM_REASONING_EFFORT` / `OPENAI_REASONING_EFFORT` | 已支持 | 已支持 | 保持 |
| `LLM_TIMEOUT_MS` / `OPENAI_TIMEOUT_MS` | 已支持 | 已支持 | 保持 |
| `LLM_STREAM` / `OPENAI_STREAM` | 已支持，Node 能解析 SSE | 配置支持，但客户端不解析 SSE | 先固定非 stream，后续补 SSE 或明确禁用 |
| `LLM_CHAT_THINKING_TYPE` / `OPENAI_CHAT_THINKING_TYPE` | 已支持 | 缺失 | Phase 1 配置 parity 要补 |
| `LLM_MAX_CONTEXT` | 已支持 | 缺失 | 先补配置读取，后续再接 prompt budget |
| `LLM_MAX_CONCURRENT` | 已支持 | 缺失 | Python 全后端化前必须补 |
| `LLM_MODEL_FALLBACKS` | 已支持 | 缺失 | 与 provider fallback 同批补 |
| `FALLBACK_LLM_*` | 已支持 | 缺失 | 全后端替代前必须补 |
| `BLUEPRINT_SPEC_DOCS_LLM_POOL_*` | 已支持 keys/labels/base/model/timeout/wire | Python 缺 pool wire | 先补 `BLUEPRINT_SPEC_DOCS_LLM_POOL_WIRE_API` |
| `SLIDERULE_POOL_RACE_MODE` | 支持，未设置时代理环境默认 sequential | 支持显式值，默认策略较薄 | 补代理感知默认值 |
| `SLIDERULE_SKIP_PRIMARY_AFTER_POOL` / `SLIDERULE_REPORT_SKIP_PRIMARY` | 已支持 | 缺失 | 迁 report/structure 类能力前补 |
| `LLM_PROXY_THROUGH` / `NO_PROXY` 行为 | Node 会在代理环境下调整 `NO_PROXY` | Python 依赖 `httpx` 的 `trust_env` | 需要文档化差异，必要时补等价策略 |

## 结构化输出和 JSON 解析缺口

Node 当前对结构化输出做了多层保护：

- `callLLMJson()` / `callLLMJsonWithUsage()` 统一打开 JSON mode 并保留 usage。
- `json-llm-call.ts` 对 dialogue JSON 的空 `content` 做二次重试。
- `llm-json-budget.ts` 对 reasoning / thinking 模型提高 JSON max tokens，避免模型把预算吃在推理里导致正文空。
- `orchestrate-plan.ts` 对 LLM 返回的 plan 做 `validateProposedPlan()`，无效时走 heuristic fallback，而不是假装成功。
- `llm-key-pool.ts` 对 spec-doc markdown 有形状校验，首轮不像文档就加严 prompt 再试。

Python 当前只有基础 JSON helper：去 fence、抽第一个 `{...}`、`json.loads()`。这对 `intent.clarify`、`gap.ask`、`question.expand` 这类 markdown 对话能力已经够用，但对 `orchestrate.plan`、`report.write`、`structure.decompose` 这类强结构输出不够。

后续迁结构化能力时，不能简单沿用“markdown 散文策略”。正确方向是：先补 JSON 预算、空形状重试、schema/shape gate、finish reason 识别和失败原因分层，再迁结构化 capability。

## provider / pool / fallback 缺口

Node 有三层弹性：

- primary provider：主 `LLM_*` / `OPENAI_*`。
- fallback provider：`FALLBACK_LLM_*`。
- pool provider：`BLUEPRINT_SPEC_DOCS_LLM_POOL_*`，给 SlideRule/Blueprint 的低阶并发能力使用。

Python 目前只有：

- primary：`sliderule_llm.client.call_llm()`。
- pool：`sliderule_llm.pool.call_pool()` / `call_pool_json()`。

缺口：

- 没有 fallback provider 链。
- 没有模型 fallback 列表。
- 没有 provider cooldown / global cooldown。
- pool 结果缺少 label/metadata，难以在报告里定位是哪把 key 命中。
- pool 失败后是否跳过 primary 的策略没有迁。
- Blueprint spec-doc pool 的 markdown 形状校验没有迁。

## 代理、超时、重试、熔断缺口

Node 侧已经处理过真实本地网络问题：

- `ai-config.ts` 会在代理环境下处理 `NO_PROXY`，并允许 `LLM_PROXY_THROUGH=1` 反向选择走代理。
- `pool-json-llm.ts` 在检测到代理 env 时默认 sequential，降低并发冲击。
- `llm-client.ts` 有 retry/backoff、provider cooldown、短 cooldown、全 provider unavailable 分类。
- `pool-json-llm.ts` 有 per-key transient retry 和 504 短惩罚。

Python 侧 `httpx.Client(timeout=..., trust_env=True)` 是对的，它能读取 `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY`，但它还没有 Node 那些“产品化运行保护”。如果要把 Python 作为整体后端 LLM 底座，必须补重试、熔断、并发限制和诊断日志。

## 密钥治理和日志脱敏风险

本轮没有读取或打印 `.env` 的真实 key。审计只看源码契约。

后续实现时要保持这些原则：

- 日志只打 provider host、pool label、状态码、错误分类，不打 key 值。
- pool label 可以记录，key 本体不能写入报告。
- live smoke 必须 opt-in，并且不要把响应里的敏感上下文写进长期文档。
- `tws-ai-slide-rule-python/config/settings.py` 里的历史硬编码敏感配置仍然是清理风险点，不能在提交时带入历史。
- `.agent-loop/`、日志、cache、`tws-ai-slide-rule-python/data/` 仍然按运行产物处理，不进入提交。

## 对整体迁移进度的影响

这轮是审计，不是实现，所以不会直接把整体 NodeJS 后端迁 Python 从 10% 推到 25%。

它的价值是把“为什么整体还只有 8-12%”说清楚：SlideRule 对话类能力虽然已经迁了几片，但全后端共享的 LLM infra 仍在 Node 侧。只要 provider fallback、pool、JSON hardening、vision/embedding/Blueprint route 级调用没有 Python 等价物，Python 就还不能接管整个后端。

建议进度口径：

| 层级 | 本轮后判断 | 说明 |
|---|---:|---|
| 整体 NodeJS 后端迁 Python | 约 8-12% | 本轮只读审计，不抬整体比例。 |
| LLM infra 迁移 | 约 15-25% | Python 有真实 Phase 1 低层切片，但离全后端公共底座还差弹性和覆盖。 |
| SlideRule 对话类 LLM 能力 | 中 | `intent.clarify`、`gap.ask`、`question.expand` 已接真 LLM。 |
| 结构化 JSON LLM 能力 | 低 | Python 还缺 JSON hardening，暂不适合迁 `orchestrate.plan` 这类能力。 |

## Phase 1 后续任务建议

### 1. `backend-python-llm-config-parity.md`

目标：补齐 Python LLM 配置契约，不发 live 请求。

范围：

- 增加 `LLM_ROUTER_MODEL` / `OPENAI_ROUTER_MODEL`。
- 增加 `FALLBACK_LLM_*` 配置结构。
- 增加 `LLM_MODEL_FALLBACKS`、`LLM_MAX_CONTEXT`、`LLM_CHAT_THINKING_TYPE`、`LLM_MAX_CONCURRENT`。
- 增加 `BLUEPRINT_SPEC_DOCS_LLM_POOL_WIRE_API`。
- 写纯单测锁住优先级和默认值。

适合 AgentLoop 自动修复：适合。范围小、无网络、容易用 pytest gate 固定。

### 2. `backend-python-llm-client-parity.md`

目标：把 Python client 从“能调用”升级到“能作为后端底座承压”。

范围：

- retry/backoff。
- 错误分类细化：auth、quota、timeout、network、provider unavailable、model/endpoint mismatch、schema parse。
- usage 标准化。
- finish reason / length 处理。
- 可选 SSE 解析，或明确 stream 禁用策略。
- provider fallback 链和模型 fallback。
- 并发限制。

适合 AgentLoop 自动修复：部分适合。单元测试和 mock HTTP 适合；真实 provider 行为和错误口径需要人工审查。

### 3. `backend-python-llm-pool-parity.md`

目标：让 Python pool 对齐 Node 的 SlideRule/Blueprint pool 运行语义。

范围：

- pool wire API 自动选择和显式覆盖。
- 代理环境默认 sequential。
- transient retry / 504 penalty。
- pool label / model metadata。
- `SLIDERULE_SKIP_PRIMARY_AFTER_POOL` / `SLIDERULE_REPORT_SKIP_PRIMARY`。
- spec-doc markdown 形状校验和 retry。

适合 AgentLoop 自动修复：适合先做单测和无网络实现；live smoke 需要人工开关确认。

## 本轮审计依据

已读源码：

- `server/core/ai-config.ts`
- `server/core/llm-client.ts`
- `server/core/llm-json-budget.ts`
- `server/sliderule/json-llm-call.ts`
- `server/sliderule/pool-json-llm.ts`
- `server/sliderule/orchestrate-plan.ts`
- `server/routes/blueprint/llm-key-pool.ts`
- `shared/llm/contracts.ts`
- `tws-ai-slide-rule-python/sliderule_llm/config.py`
- `tws-ai-slide-rule-python/sliderule_llm/client.py`
- `tws-ai-slide-rule-python/sliderule_llm/pool.py`
- `tws-ai-slide-rule-python/tests/test_config.py`
- `tws-ai-slide-rule-python/tests/test_su8_live.py`
- `tws-ai-slide-rule-python/PHASE1_LLM_STATUS.md`

已扫描调用点：

- `server/core/agent.ts`
- `server/runtime/server-runtime.ts`
- `server/core/vision-provider.ts`
- `server/core/ai-ppt-generation-provider.ts`
- `server/routes/chat.ts`
- `server/routes/nl-command.ts`
- `server/routes/blueprint.ts`
- `server/routes/blueprint/**`
- `server/sliderule/**`
- `server/rag/embedding/**`
