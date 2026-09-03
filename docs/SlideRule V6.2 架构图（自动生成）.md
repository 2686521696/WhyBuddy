# SlideRule V6.2 架构图（自动生成）

> ⚠ **这个文件是生成的，不要手改。** 改了下次 `--emit` 会覆盖，而且
> `tests/test_architecture.py::Test图与代码同步` 会当场变红。
> 要改架构，改代码或改 `slide-rule-python/architecture.toml`，然后重新生成：
> 
> ```bash
> slide-rule-python/.venv/bin/python slide-rule-python/arch_graph.py --emit
> ```

抄的是 grok-build 的做法：他们**一张架构图都没有**，边写在各 crate 的
`Cargo.toml` 里由 cargo 强制。对照物的现算数字见
`docs/grok-build 架构图（自动生成）.md`（`scripts/arch-graph-grok.py --emit`）。
我们没有那个编译器，所以自己写一个——见 `slide-rule-python/arch_graph.py` 模块头。

## 此刻的事实（由代码算出，不是手写）

- 扫描文件 **286** 个，模块 **286** 个
- 内部依赖边 **870** 条，其中 **491** 条写在函数体里（56%；基线 485，只许变少）
- 未声明的跨包依赖 **0** 条（基线 0 条）
- 模块级循环依赖 **0** 个（基线 0 个）
- services 内部越层依赖 **0** 条（基线 0 条）
- 没人 import 的模块 **54** 个（基线 54 个）—— ⚠ **不是待删清单**，其中 4 个是跨语言入口（见全仓图，不是没人用）

权威图只留自动生成的：本文件、`docs/WhyBuddy TS 架构图（自动生成）.md`、
`docs/WhyBuddy 全仓架构图（自动生成）.md`、`docs/grok-build 架构图（自动生成）.md`。
V5.x～V6.0 手画是历史实验室笔记，禁止再打新 ⚑。

目标形状是**两个大块 + 一批叶子**（util 叶子多于 flow 编排），
不是把 services 切成 90 个平均文件。
产品图**不搬**：`xai-grok-pager`、`xai-grok-mcp`、`xai-grok-subagent`、`xai-grok-sandbox`、`xai-grok-agent`
（pager / MCP / 子代理 / sandbox / grok-agent 提示词）。

### services 内部分层（抄 grok 的叶子 crate）

| 层 | 模块数 | 可以依赖 | 是什么 |
|---|---|---|---|
| `util` | 125 | （谁都不依赖） | 纯工具：不依赖 services 里任何其它模块 |
| `core` | 59 | util | 核心：模型 / 闸 / 闭环 / 生成件 |
| `flow` | 30 | util、core | 编排：驱动器 / 流水线 / 控制面 / 会话 |

叶子层 `util` 不依赖 services 里任何其它模块——这是它能被所有人安全 import 的全部理由，也是 `import` 不必躲进函数体的前提。

### services 三层（从 import 算出，不是表）

表只报数。这张 mermaid 才是层间真实边。虚线 = 越层（欠账，只许变少）。

```mermaid
flowchart TB
  util["util<br/>125 个模块<br/>纯工具：不依赖 services 里任何其它模块"]
  core["core<br/>59 个模块<br/>核心：模型 / 闸 / 闭环 / 生成件"]
  flow["flow<br/>30 个模块<br/>编排：驱动器 / 流水线 / 控制面 / 会话"]
  core -->|142| util
  flow -->|103| core
  flow -->|106| util
```

虚线 = 未在 `architecture.toml` 里声明的边（欠账，只许变少）。

```mermaid
flowchart TB
  arch_graph["arch_graph<br/>1 个模块<br/>架构编译器自己"]
  config["config<br/>2 个模块<br/>配置"]
  models["models<br/>3 个模块<br/>数据形状"]
  stdio_utf8["stdio_utf8<br/>1 个模块<br/>顶层叶子：Windows 管道 UTF-8 钉桩"]
  sliderule_llm["sliderule_llm<br/>13 个模块<br/>LLM 通道"]
  middlewares["middlewares<br/>2 个模块<br/>中间件"]
  services["services<br/>214 个模块<br/>业务"]
  routes["routes<br/>12 个模块<br/>HTTP 路由"]
  app["app<br/>1 个模块<br/>装配根"]
  complete_migration["complete_migration<br/>1 个模块<br/>一次性迁移记录"]
  scripts["scripts<br/>36 个模块<br/>运维脚本"]
  app -->|1| config
  app -->|1| models
  app -->|12| routes
  app -->|12 · 其中 3 条在函数体里| services
  app -->|1| stdio_utf8
  complete_migration -->|1| models
  complete_migration -->|3| services
  middlewares -->|1| config
  middlewares -->|2| services
  routes -->|9| config
  routes -->|5| middlewares
  routes -->|3| models
  routes -->|133 · 其中 84 条在函数体里| services
  routes -->|15 · 其中 8 条在函数体里| sliderule_llm
  scripts -->|3| app
  scripts -->|2 · 其中 2 条在函数体里| config
  scripts -->|1 · 其中 1 条在函数体里| models
  scripts -->|58 · 其中 41 条在函数体里| services
  scripts -->|8 · 其中 5 条在函数体里| sliderule_llm
  scripts -->|2| stdio_utf8
  services -->|15 · 其中 7 条在函数体里| config
  services -->|30 · 其中 1 条在函数体里| models
  services -->|62 · 其中 48 条在函数体里| sliderule_llm
  sliderule_llm -->|2 · 其中 2 条在函数体里| config
```

## 编排环（从活路径生成）

对照 grok-build 的 spine（shell → agent → tools，`xai-workflow` 是叶子）。
我们的活路径是 `rehearsal_control._handoff_factory` → `drive_full_factory` →
`v5_full_driver` → `v5_capability_executor` → `run_spec_first`。
⚠ `component.run_control` 是 pause/cancel 叶子，不是这张图。
handoff 标在边上，当且仅当 `_handoff_factory` 函数体里真的调用了
`start_drive_full_factory_run`（import 在不算数）。

```mermaid
flowchart LR
  services_rehearsal_control["services.rehearsal_control<br/>控制面闭集工具环"]
  services_drive_full_factory["services.drive_full_factory<br/>工厂点火信封"]
  services_v5_full_driver["services.v5_full_driver<br/>主循环驱动"]
  services_v5_capability_executor["services.v5_capability_executor<br/>能力执行器（活路径调 run_spec_first）"]
  services_spec_first_pipeline["services.spec_first_pipeline<br/>spec-first 七步"]
  services_drive_full_factory -->|1| services_v5_full_driver
  services_rehearsal_control -->|handoff 1| services_drive_full_factory
  services_rehearsal_control -->|2| services_v5_full_driver
  services_v5_capability_executor -->|5| services_spec_first_pipeline
  services_v5_full_driver -->|3| services_spec_first_pipeline
  services_v5_full_driver -->|5| services_v5_capability_executor
```

## 循环依赖

Rust 里这一类根本编译不出来；Python 得自己数。**只许变少。**

（当前没有循环依赖）

## 未声明的跨包依赖

（当前没有）

## crate 级：component 依赖图

抄 grok 的 Cargo.toml——边写在 crate 上，由编译器焊死。
现算数字见 `docs/grok-build 架构图（自动生成）.md`。
我们 24 个 component、87 条边，由 `architecture.toml` 声明、判据强制。
**红色虚线 = 参与组间成环的边**（模块级已清零，组级还欠着，见下）。

```mermaid
flowchart LR
  a2a["a2a<br/>4"]
  agent_loop["agent_loop<br/>15"]
  app_store["app_store<br/>5"]
  audit["audit<br/>3"]
  blueprint["blueprint<br/>19"]
  capability_engine["capability_engine<br/>2"]
  control["control<br/>1"]
  diagnostics["diagnostics<br/>6"]
  drive["drive<br/>9"]
  entrypoint["entrypoint<br/>1"]
  evidence["evidence<br/>11"]
  http_routes["http_routes<br/>8"]
  identity["identity<br/>7"]
  llm_gateway["llm_gateway<br/>16"]
  model_core["model_core<br/>26"]
  observability["observability<br/>5"]
  ops_scripts["ops_scripts<br/>37"]
  permission["permission<br/>8"]
  persist["persist<br/>2"]
  platform["platform<br/>23"]
  run_control["run_control<br/>4"]
  spec_first["spec_first<br/>38"]
  task_exec["task_exec<br/>19"]
  web_aigc["web_aigc<br/>16"]
  agent_loop -->|1| identity
  agent_loop -->|6| platform
  app_store -->|6| identity
  app_store -->|2| platform
  blueprint -->|2| platform
  capability_engine -->|5| evidence
  capability_engine -->|1| llm_gateway
  capability_engine -->|2| platform
  capability_engine -->|1| spec_first
  control -->|handoff 7| drive
  control -->|1| evidence
  control -->|1| llm_gateway
  control -->|3| model_core
  control -->|5| platform
  control -->|3| spec_first
  diagnostics -->|1| a2a
  diagnostics -->|1| evidence
  diagnostics -->|2| model_core
  diagnostics -->|3| platform
  diagnostics -->|1| web_aigc
  drive -->|2| capability_engine
  drive -->|1| evidence
  drive -->|1| identity
  drive -->|18| model_core
  drive -->|2| observability
  drive -->|5| persist
  drive -->|11| platform
  drive -->|1| run_control
  drive -->|2| spec_first
  entrypoint -->|2| agent_loop
  entrypoint -->|2| drive
  entrypoint -->|7| http_routes
  entrypoint -->|4| model_core
  entrypoint -->|1| permission
  entrypoint -->|4| platform
  entrypoint -->|4| spec_first
  entrypoint -->|3| task_exec
  evidence -->|7| llm_gateway
  evidence -->|9| platform
  http_routes -->|25| app_store
  http_routes -->|3| audit
  http_routes -->|1| blueprint
  http_routes -->|2| capability_engine
  http_routes -->|1| control
  http_routes -->|1| diagnostics
  http_routes -->|15| drive
  http_routes -->|5| evidence
  http_routes -->|12| identity
  http_routes -->|22| llm_gateway
  http_routes -->|23| model_core
  http_routes -->|2| observability
  http_routes -->|3| persist
  http_routes -->|14| platform
  http_routes -->|9| spec_first
  http_routes -->|2| task_exec
  identity -->|10| platform
  llm_gateway -->|2| platform
  model_core -->|2| app_store
  model_core -->|5| evidence
  model_core -->|18| llm_gateway
  model_core -->|6| observability
  model_core -->|2| persist
  model_core -->|56| platform
  model_core -->|11| run_control
  model_core -->|21| spec_first
  observability -->|2| llm_gateway
  observability -->|1| persist
  observability -->|3| platform
  ops_scripts -->|10| app_store
  ops_scripts -->|3| entrypoint
  ops_scripts -->|3| evidence
  ops_scripts -->|1| identity
  ops_scripts -->|8| llm_gateway
  ops_scripts -->|16| model_core
  ops_scripts -->|9| platform
  ops_scripts -->|24| spec_first
  permission -->|1| identity
  permission -->|1| platform
  persist -->|10| platform
  run_control -->|1| platform
  spec_first -->|3| app_store
  spec_first -->|37| llm_gateway
  spec_first -->|3| observability
  spec_first -->|55| platform
  spec_first -->|2| run_control
  task_exec -->|2| evidence
  task_exec -->|4| platform
```


## services 内部越层依赖

叶子碰了上层，或 core 碰了 flow。**只许变少。**

（当前没有）
