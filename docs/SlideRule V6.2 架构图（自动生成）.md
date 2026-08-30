# SlideRule V6.2 架构图（自动生成）

> ⚠ **这个文件是生成的，不要手改。** 改了下次 `--emit` 会覆盖，而且
> `tests/test_architecture.py::Test图与代码同步` 会当场变红。
> 要改架构，改代码或改 `slide-rule-python/architecture.toml`，然后重新生成：
> 
> ```bash
> slide-rule-python/.venv/bin/python slide-rule-python/arch_graph.py --emit
> ```

抄的是 grok-build 的做法：他们**一张架构图都没有**，91 个 crate 在各自
`Cargo.toml` 里显式声明依赖，347 条边由编译器强制，根 `Cargo.toml` 是生成的。
我们没有那个编译器，所以自己写一个——见 `slide-rule-python/arch_graph.py` 模块头。

## 此刻的事实（由代码算出，不是手写）

- 扫描文件 **277** 个，模块 **277** 个
- 内部依赖边 **817** 条，其中 **466** 条写在函数体里（57%）
- 未声明的跨包依赖 **0** 条（基线 0 条）
- 模块级循环依赖 **0** 个（基线 0 个）
- services 内部越层依赖 **0** 条（基线 0 条）
- 没人 import 的模块 **54** 个（基线 54 个）—— ⚠ **不是待删清单**，多数是 Node 边界镜像 / 脚本插座 / 未挂载的基线面，见 `arch_graph.orphans()`

### services 内部分层（抄 grok 的叶子 crate）

| 层 | 模块数 | 可以依赖 | 是什么 |
|---|---|---|---|
| `util` | 119 | （谁都不依赖） | 纯工具：不依赖 services 里任何其它模块 |
| `core` | 58 | util | 核心：模型 / 闸 / 闭环 / 生成件 |
| `flow` | 28 | util、core | 编排：驱动器 / 流水线 / 控制面 / 会话 |

叶子层 `util` 不依赖 services 里任何其它模块——这是它能被所有人安全 import 的全部理由，也是 `import` 不必躲进函数体的前提。

虚线 = 未在 `architecture.toml` 里声明的边（欠账，只许变少）。

```mermaid
flowchart TB
  arch_graph["arch_graph<br/>1 个模块<br/>架构编译器自己"]
  config["config<br/>2 个模块<br/>配置"]
  models["models<br/>3 个模块<br/>数据形状"]
  stdio_utf8["stdio_utf8<br/>1 个模块<br/>顶层叶子：Windows 管道 UTF-8 钉桩"]
  sliderule_llm["sliderule_llm<br/>13 个模块<br/>LLM 通道"]
  middlewares["middlewares<br/>2 个模块<br/>中间件"]
  services["services<br/>205 个模块<br/>业务"]
  routes["routes<br/>12 个模块<br/>HTTP 路由"]
  app["app<br/>1 个模块<br/>装配根"]
  complete_migration["complete_migration<br/>1 个模块<br/>一次性迁移记录"]
  scripts["scripts<br/>36 个模块<br/>运维脚本"]
  app -->|1| config
  app -->|1| models
  app -->|12| routes
  app -->|11 · 其中 3 条在函数体里| services
  app -->|1| stdio_utf8
  complete_migration -->|1| models
  complete_migration -->|3| services
  middlewares -->|1| config
  middlewares -->|2| services
  routes -->|9| config
  routes -->|5| middlewares
  routes -->|3| models
  routes -->|132 · 其中 83 条在函数体里| services
  routes -->|15 · 其中 8 条在函数体里| sliderule_llm
  scripts -->|3| app
  scripts -->|2 · 其中 2 条在函数体里| config
  scripts -->|1 · 其中 1 条在函数体里| models
  scripts -->|58 · 其中 41 条在函数体里| services
  scripts -->|8 · 其中 5 条在函数体里| sliderule_llm
  scripts -->|2| stdio_utf8
  services -->|15 · 其中 7 条在函数体里| config
  services -->|30 · 其中 1 条在函数体里| models
  services -->|60 · 其中 47 条在函数体里| sliderule_llm
  sliderule_llm -->|2 · 其中 2 条在函数体里| config
```

## 循环依赖

Rust 里这一类根本编译不出来；Python 得自己数。**只许变少。**

（当前没有循环依赖）

## 未声明的跨包依赖

（当前没有）

## crate 级：component 依赖图

抄 grok 的 Cargo.toml——他们 90 个 crate、347 条**声明过**的边由编译器焊死。
我们 23 个 component、81 条边，由 `architecture.toml` 声明、判据强制。
**红色虚线 = 参与组间成环的边**（模块级已清零，组级还欠着，见下）。

```mermaid
flowchart LR
  a2a["a2a<br/>4"]
  agent_loop["agent_loop<br/>15"]
  app_store["app_store<br/>5"]
  audit["audit<br/>3"]
  blueprint["blueprint<br/>19"]
  capability_engine["capability_engine<br/>2"]
  diagnostics["diagnostics<br/>6"]
  drive["drive<br/>10"]
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
  platform["platform<br/>19"]
  run_control["run_control<br/>4"]
  spec_first["spec_first<br/>34"]
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
  diagnostics -->|1| a2a
  diagnostics -->|1| evidence
  diagnostics -->|2| model_core
  diagnostics -->|3| platform
  diagnostics -->|1| web_aigc
  drive -->|2| capability_engine
  drive -->|2| evidence
  drive -->|1| identity
  drive -->|1| llm_gateway
  drive -->|21| model_core
  drive -->|2| observability
  drive -->|4| persist
  drive -->|13| platform
  drive -->|1| run_control
  drive -->|3| spec_first
  entrypoint -->|2| agent_loop
  entrypoint -->|2| drive
  entrypoint -->|7| http_routes
  entrypoint -->|4| model_core
  entrypoint -->|1| permission
  entrypoint -->|4| platform
  entrypoint -->|3| spec_first
  entrypoint -->|3| task_exec
  evidence -->|7| llm_gateway
  evidence -->|8| platform
  http_routes -->|25| app_store
  http_routes -->|3| audit
  http_routes -->|1| blueprint
  http_routes -->|2| capability_engine
  http_routes -->|1| diagnostics
  http_routes -->|16| drive
  http_routes -->|5| evidence
  http_routes -->|12| identity
  http_routes -->|22| llm_gateway
  http_routes -->|23| model_core
  http_routes -->|2| observability
  http_routes -->|3| persist
  http_routes -->|13| platform
  http_routes -->|9| spec_first
  http_routes -->|2| task_exec
  identity -->|10| platform
  llm_gateway -->|2| platform
  model_core -->|2| app_store
  model_core -->|5| evidence
  model_core -->|18| llm_gateway
  model_core -->|6| observability
  model_core -->|2| persist
  model_core -->|50| platform
  model_core -->|11| run_control
  model_core -->|15| spec_first
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
  spec_first -->|35| llm_gateway
  spec_first -->|3| observability
  spec_first -->|42| platform
  spec_first -->|1| run_control
  task_exec -->|2| evidence
  task_exec -->|4| platform
```


## services 内部越层依赖

叶子碰了上层，或 core 碰了 flow。**只许变少。**

（当前没有）
