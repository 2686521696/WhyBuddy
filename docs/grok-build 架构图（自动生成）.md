# grok-build 架构图（自动生成）

> ⚠ **这份文件是 `scripts/arch-graph-grok.py --emit` 生成的，别手改。**
> grok-build 自己一张架构图都没有：边写在各 crate 的 `Cargo.toml` 里，
> cargo 编译器强制。本文件只是把那些声明画出来，方便和 WhyBuddy 对照。
> grok-build 源码不进本仓。

- 对照物路径：`C:\Users\wangchunji\Documents\grok-build`
- `SOURCE_REV`：`28439e8a8712c363321cf6ff0c2d70cd058d2a7d`
- workspace members **94**，读到 crate **94**
- 内部运行时依赖边 **325**（含 build-dependencies，不含 dev-dependencies）
- crate 级循环依赖 **0** 个（Rust 编不过，应当是 0）

## 分层（目录就是层）

| 层 | crate 数 | .rs 文件 | 是什么 |
|---|---:|---:|---|
| `build` | 1 | 3 | 构建期：proto 代码生成 |
| `codegen` | 77 | 2624 | 产品：agent / tools / shell / pager / workspace |
| `common` | 11 | 159 | 跨产品叶子：tool-runtime / protocol / tracing / compaction |
| `prod` | 1 | 11 | 生产侧小包：cli-chat-proxy-types |
| `third_party` | 4 | 66 | vendor：mermaid 渲染、dagre、graphlib |

```mermaid
flowchart TB
  build["build<br/>1 个 crate"]
  codegen["codegen<br/>77 个 crate"]
  common["common<br/>11 个 crate"]
  prod["prod<br/>1 个 crate"]
  third_party["third_party<br/>4 个 crate"]
  codegen -->|1| build
  codegen -->|32| common
  codegen -->|5| prod
  codegen -->|1| third_party
  common -->|1| codegen
```

## 编排环（对照 WhyBuddy 时看这一张）

grok 的「魂」不在 pager 的 700 个 rs 文件里，在这一簇：
`AgentDefinition` → 闭集工具 → `xai-workflow` 脚本编排 → shell 会话。
`xai-workflow` 若画出零内部 crate 依赖，说明它是叶子引擎——脚本编排
不该反向依赖某个具体 Agent。

```mermaid
flowchart LR
  c_xai_grok_agent["xai-grok-agent<br/>Agent builder, definition parsing, and s…"]
  c_xai_grok_tools["xai-grok-tools<br/>Grok tools library"]
  c_xai_grok_tools_api["xai-grok-tools-api<br/>Protobuf API definitions for Grok tools"]
  c_xai_tool_runtime["xai-tool-runtime<br/>Unified Tool trait, dispatch trait, erro…"]
  c_xai_tool_protocol["xai-tool-protocol<br/>Wire-protocol types for the xAI Computer…"]
  c_xai_tool_types["xai-tool-types<br/>Canonical tool-description types for the…"]
  c_xai_workflow["xai-workflow<br/>Rhai-scripted dynamic workflow engine: s…"]
  c_xai_grok_shell["xai-grok-shell<br/>xai-grok-shell"]
  c_xai_agent_lifecycle["xai-agent-lifecycle<br/>xai-agent-lifecycle"]
  c_xai_chat_state["xai-chat-state<br/>Actor-based chat state management for xA…"]
  c_xai_grok_hooks["xai-grok-hooks<br/>Runtime hook system for Grok — file-base…"]
  c_xai_grok_mcp["xai-grok-mcp<br/>MCP integration crate. Quarantines rmcp …"]
  c_xai_grok_subagent_resolution["xai-grok-subagent-resolution<br/>Shared subagent definition, runtime, pro…"]
  c_xai_computer_hub_core["xai-computer-hub-core<br/>Transport, ToolRegistry, and resolver ab…"]
  c_xai_computer_hub_sdk["xai-computer-hub-sdk<br/>SDK for the xAI Computer Hub: connection…"]
  c_xai_computer_hub_mcp_adapter["xai-computer-hub-mcp-adapter<br/>Bridge between MCP servers and the xAI C…"]
  c_xai_grok_config["xai-grok-config<br/>Shared config loading for Grok — grok_ho…"]
  c_xai_grok_workspace["xai-grok-workspace<br/>Core host-local workspace library (FS, V…"]
  c_xai_grok_sandbox["xai-grok-sandbox<br/>OS-level sandboxing for Grok Build using…"]
  c_xai_prompt_queue["xai-prompt-queue<br/>Shared prompt-queue wire types for xai-g…"]
  c_xai_grok_session_events["xai-grok-session-events<br/>Typed per-session event log written as J…"]
  c_xai_computer_hub_core --> c_xai_tool_protocol
  c_xai_computer_hub_core --> c_xai_tool_runtime
  c_xai_computer_hub_core --> c_xai_tool_types
  c_xai_computer_hub_mcp_adapter --> c_xai_computer_hub_sdk
  c_xai_computer_hub_mcp_adapter --> c_xai_tool_protocol
  c_xai_computer_hub_mcp_adapter --> c_xai_tool_runtime
  c_xai_computer_hub_mcp_adapter --> c_xai_tool_types
  c_xai_computer_hub_sdk --> c_xai_computer_hub_core
  c_xai_computer_hub_sdk --> c_xai_tool_protocol
  c_xai_computer_hub_sdk --> c_xai_tool_runtime
  c_xai_computer_hub_sdk --> c_xai_tool_types
  c_xai_grok_agent --> c_xai_grok_config
  c_xai_grok_agent --> c_xai_grok_hooks
  c_xai_grok_agent --> c_xai_grok_tools
  c_xai_grok_agent --> c_xai_tool_types
  c_xai_grok_hooks --> c_xai_grok_config
  c_xai_grok_hooks --> c_xai_grok_tools
  c_xai_grok_mcp --> c_xai_grok_config
  c_xai_grok_mcp --> c_xai_grok_session_events
  c_xai_grok_mcp --> c_xai_grok_tools
  c_xai_grok_mcp --> c_xai_tool_protocol
  c_xai_grok_mcp --> c_xai_tool_runtime
  c_xai_grok_mcp --> c_xai_tool_types
  c_xai_grok_sandbox --> c_xai_grok_config
  c_xai_grok_shell --> c_xai_agent_lifecycle
  c_xai_grok_shell --> c_xai_chat_state
  c_xai_grok_shell --> c_xai_computer_hub_sdk
  c_xai_grok_shell --> c_xai_grok_agent
  c_xai_grok_shell --> c_xai_grok_config
  c_xai_grok_shell --> c_xai_grok_hooks
  c_xai_grok_shell --> c_xai_grok_mcp
  c_xai_grok_shell --> c_xai_grok_sandbox
  c_xai_grok_shell --> c_xai_grok_session_events
  c_xai_grok_shell --> c_xai_grok_subagent_resolution
  c_xai_grok_shell --> c_xai_grok_tools
  c_xai_grok_shell --> c_xai_grok_workspace
  c_xai_grok_shell --> c_xai_prompt_queue
  c_xai_grok_shell --> c_xai_tool_protocol
  c_xai_grok_shell --> c_xai_tool_runtime
  c_xai_grok_shell --> c_xai_tool_types
  c_xai_grok_shell --> c_xai_workflow
  c_xai_grok_subagent_resolution --> c_xai_grok_agent
  c_xai_grok_subagent_resolution --> c_xai_grok_tools
  c_xai_grok_subagent_resolution --> c_xai_tool_types
  c_xai_grok_tools --> c_xai_computer_hub_core
  c_xai_grok_tools --> c_xai_computer_hub_sdk
  c_xai_grok_tools --> c_xai_grok_config
  c_xai_grok_tools --> c_xai_grok_sandbox
  c_xai_grok_tools --> c_xai_grok_tools_api
  c_xai_grok_tools --> c_xai_tool_protocol
  c_xai_grok_tools --> c_xai_tool_runtime
  c_xai_grok_tools --> c_xai_tool_types
  c_xai_grok_tools_api --> c_xai_tool_protocol
  c_xai_grok_workspace --> c_xai_computer_hub_mcp_adapter
  c_xai_grok_workspace --> c_xai_computer_hub_sdk
  c_xai_grok_workspace --> c_xai_grok_agent
  c_xai_grok_workspace --> c_xai_grok_config
  c_xai_grok_workspace --> c_xai_grok_hooks
  c_xai_grok_workspace --> c_xai_grok_mcp
  c_xai_grok_workspace --> c_xai_grok_sandbox
  c_xai_grok_workspace --> c_xai_grok_session_events
  c_xai_grok_workspace --> c_xai_grok_tools
  c_xai_grok_workspace --> c_xai_grok_tools_api
  c_xai_grok_workspace --> c_xai_tool_protocol
  c_xai_grok_workspace --> c_xai_tool_runtime
  c_xai_grok_workspace --> c_xai_tool_types
  c_xai_tool_protocol --> c_xai_tool_types
  c_xai_tool_runtime --> c_xai_grok_tools_api
  c_xai_tool_runtime --> c_xai_tool_protocol
  c_xai_tool_runtime --> c_xai_tool_types
```

## 被依赖最多的 crate（叶子越往上越值钱）

| crate | 入度 | 出度 | .rs | 层 | 一句话 |
|---|---:|---:|---:|---|---|
| `xai-tty-utils` | 19 | 0 | 8 | codegen | Lightweight process-spawning utilities for TTY safety — detach from controlling terminal, suppress interactive pagers, process-group lifecycle |
| `xai-grok-config` | 18 | 4 | 27 | codegen | Shared config loading for Grok — grok_home, effective config (requirements > user > managed), TOML merge |
| `xai-grok-version` | 17 | 0 | 2 | codegen | Lockstepped grok CLI version. |
| `xai-grok-tools` | 15 | 17 | 254 | codegen | Grok tools library |
| `xai-grok-extra-ca` | 13 | 0 | 9 | codegen | TLS policy for the grok CLI: rustls backend pin, process crypto provider, shared root store, and opt-in GROK_EXTRA_CA_BUNDLE roots |
| `xai-tool-types` | 11 | 0 | 6 | common | Canonical tool-description types for the xAI platform |
| `xai-tool-protocol` | 10 | 1 | 22 | common | Wire-protocol types for the xAI Computer Hub |
| `xai-grok-telemetry` | 9 | 12 | 55 | codegen | Telemetry engine: product events + Mixpanel emission + Sentry error reporting for Grok Build sessions |
| `xai-grok-auth` | 8 | 0 | 5 | codegen | Auth dependency-inversion seam: HttpAuth + AuthCredentialProvider traits |
| `xai-token-estimation` | 8 | 0 | 1 | codegen | Pure shared token-estimation primitives. |
| `xai-tool-runtime` | 8 | 3 | 18 | common | Unified Tool trait, dispatch trait, error taxonomy, notifications, and search index for the xAI Computer Hub |
| `xai-acp-lib` | 6 | 0 | 8 | codegen |  |
| `xai-computer-hub-sdk` | 6 | 5 | 22 | common | SDK for the xAI Computer Hub: connection pool, transparent reconnect, tool harness, and tool-server runtime. |
| `xai-file-utils` | 6 | 5 | 12 | codegen | Local data collection: upload queueing and blob storage |
| `xai-grok-sampling-types` | 6 | 3 | 16 | codegen | Pure data types for the xAI sampling / chat-completion API layer |

## 依赖别人最多的 crate（组合根 / 大块）

| crate | 出度 | 入度 | .rs | 层 |
|---|---:|---:|---:|---|
| `xai-grok-shell` | 53 | 4 | 603 | codegen |
| `xai-grok-workspace` | 33 | 6 | 94 | codegen |
| `xai-grok-pager` | 29 | 2 | 791 | codegen |
| `xai-grok-tools` | 17 | 15 | 254 | codegen |
| `xai-grok-pager-bin` | 14 | 0 | 3 | codegen |
| `xai-grok-telemetry` | 12 | 9 | 55 | codegen |
| `xai-grok-mcp` | 10 | 3 | 13 | codegen |
| `xai-grok-pager-render` | 10 | 1 | 72 | codegen |
| `xai-grok-agent` | 7 | 5 | 31 | codegen |
| `xai-grok-memory` | 7 | 1 | 17 | codegen |
| `xai-grok-shell-terminal` | 7 | 1 | 11 | codegen |
| `xai-grok-http` | 6 | 3 | 1 | codegen |
| `xai-grok-pager-minimal` | 6 | 1 | 12 | codegen |
| `xai-grok-shared` | 6 | 3 | 8 | codegen |
| `xai-grok-shell-base` | 6 | 1 | 10 | codegen |

## 体积最大的 crate

形状不是均匀切小，是**两个巨石 + 一大批叶子**。巨石内部缠没关系，
叶子被 cargo 焊死不可能反过来依赖巨石。

| crate | .rs | 入度 | 出度 |
|---|---:|---:|---:|
| `xai-grok-pager` | 791 | 2 | 29 |
| `xai-grok-shell` | 603 | 4 | 53 |
| `xai-grok-tools` | 254 | 15 | 17 |
| `xai-grok-workspace` | 94 | 6 | 33 |
| `xai-fast-worktree` | 73 | 3 | 4 |
| `xai-grok-pager-render` | 72 | 1 | 10 |
| `xai-grok-telemetry` | 55 | 9 | 12 |
| `xai-grok-workspace-types` | 50 | 4 | 0 |

## 叶子 crate（出度 0，谁都能安全依赖）

共 **38** 个：

`ordered_hashmap`, `prod-mc-cli-chat-proxy-types`, `ptyctl`, `xai-acp-lib`, `xai-agent-lifecycle`, `xai-circuit-breaker`, `xai-crash-handler`, `xai-fsnotify`, `xai-fuzzy-file-search`, `xai-gix-status`, `xai-grok-auth`, `xai-grok-compaction`, `xai-grok-env`, `xai-grok-extra-ca`, `xai-grok-home`, `xai-grok-markdown-core`, `xai-grok-models`, `xai-grok-paths`, `xai-grok-secrets`, `xai-grok-session-events`, `xai-grok-status-line`, `xai-grok-version`, `xai-grok-workspace-types`, `xai-hooks-plugins-types`, `xai-interjection-core`, `xai-prompt-queue`, `xai-proto-build`, `xai-ratatui-inline`, `xai-ratatui-textarea`, `xai-sqlite-journal`, `xai-system-power`, `xai-test-utils`, `xai-token-estimation`, `xai-tool-types`, `xai-tracing`, `xai-tracing-macros`, `xai-tty-utils`, `xai-workflow`

## 入度 0（没被其它 crate 依赖：组合根 / bin / 尚未挂上）

共 **4** 个：

`ptyctl-cli`, `xai-grok-pager-bin`, `xai-grok-pager-pty-harness`, `xai-test-utils`

## 循环依赖

（当前没有。这是 cargo 的底线，不是我们数出来的美德。）

## `common` 内部

```mermaid
flowchart TB
  c_xai_circuit_breaker["xai-circuit-breaker<br/>19 rs · in 2"]
  c_xai_computer_hub_core["xai-computer-hub-core<br/>15 rs · in 2"]
  c_xai_computer_hub_mcp_adapter["xai-computer-hub-mcp-adapter<br/>5 rs · in 1"]
  c_xai_computer_hub_sdk["xai-computer-hub-sdk<br/>22 rs · in 6"]
  c_xai_grok_compaction["xai-grok-compaction<br/>34 rs · in 3"]
  c_xai_interjection_core["xai-interjection-core<br/>4 rs · in 2"]
  c_xai_test_utils["xai-test-utils<br/>6 rs · in 0"]
  c_xai_tool_protocol["xai-tool-protocol<br/>22 rs · in 10"]
  c_xai_tool_runtime["xai-tool-runtime<br/>18 rs · in 8"]
  c_xai_tool_types["xai-tool-types<br/>6 rs · in 11"]
  c_xai_tracing["xai-tracing<br/>8 rs · in 2"]
  c_xai_computer_hub_core --> c_xai_tool_protocol
  c_xai_computer_hub_core --> c_xai_tool_runtime
  c_xai_computer_hub_core --> c_xai_tool_types
  c_xai_computer_hub_mcp_adapter --> c_xai_computer_hub_sdk
  c_xai_computer_hub_mcp_adapter --> c_xai_tool_protocol
  c_xai_computer_hub_mcp_adapter --> c_xai_tool_runtime
  c_xai_computer_hub_mcp_adapter --> c_xai_tool_types
  c_xai_computer_hub_sdk --> c_xai_computer_hub_core
  c_xai_computer_hub_sdk --> c_xai_tool_protocol
  c_xai_computer_hub_sdk --> c_xai_tool_runtime
  c_xai_computer_hub_sdk --> c_xai_tool_types
  c_xai_computer_hub_sdk --> c_xai_tracing
  c_xai_tool_protocol --> c_xai_tool_types
  c_xai_tool_runtime --> c_xai_tool_protocol
  c_xai_tool_runtime --> c_xai_tool_types
```

## `third_party` 内部

```mermaid
flowchart TB
  c_dagre_rust["dagre_rust<br/>24 rs · in 1"]
  c_graphlib_rust["graphlib_rust<br/>6 rs · in 2"]
  c_mermaid_to_svg["mermaid-to-svg<br/>35 rs · in 1"]
  c_ordered_hashmap["ordered_hashmap<br/>1 rs · in 2"]
  c_dagre_rust --> c_graphlib_rust
  c_dagre_rust --> c_ordered_hashmap
  c_graphlib_rust --> c_ordered_hashmap
  c_mermaid_to_svg --> c_dagre_rust
  c_mermaid_to_svg --> c_graphlib_rust
```

## `codegen` 内部

codegen 成员太多，图上只保留入度最高的一批和体积 ≥200 rs 的巨石；完整名单见下表。

```mermaid
flowchart TB
  c_ptyctl["ptyctl<br/>8 rs · in 2"]
  c_xai_acp_lib["xai-acp-lib<br/>8 rs · in 6"]
  c_xai_codebase_graph["xai-codebase-graph<br/>28 rs · in 2"]
  c_xai_compaction_transcript["xai-compaction-transcript<br/>1 rs · in 2"]
  c_xai_fast_worktree["xai-fast-worktree<br/>73 rs · in 3"]
  c_xai_file_utils["xai-file-utils<br/>12 rs · in 6"]
  c_xai_grok_agent["xai-grok-agent<br/>31 rs · in 5"]
  c_xai_grok_announcements["xai-grok-announcements<br/>1 rs · in 3"]
  c_xai_grok_auth["xai-grok-auth<br/>5 rs · in 8"]
  c_xai_grok_config["xai-grok-config<br/>27 rs · in 18"]
  c_xai_grok_config_types["xai-grok-config-types<br/>8 rs · in 4"]
  c_xai_grok_env["xai-grok-env<br/>1 rs · in 4"]
  c_xai_grok_extra_ca["xai-grok-extra-ca<br/>9 rs · in 13"]
  c_xai_grok_hooks["xai-grok-hooks<br/>15 rs · in 3"]
  c_xai_grok_http["xai-grok-http<br/>1 rs · in 3"]
  c_xai_grok_mcp["xai-grok-mcp<br/>13 rs · in 3"]
  c_xai_grok_pager["xai-grok-pager<br/>791 rs · in 2"]
  c_xai_grok_paths["xai-grok-paths<br/>1 rs · in 5"]
  c_xai_grok_sampler["xai-grok-sampler<br/>30 rs · in 3"]
  c_xai_grok_sampling_types["xai-grok-sampling-types<br/>16 rs · in 6"]
  c_xai_grok_sandbox["xai-grok-sandbox<br/>16 rs · in 6"]
  c_xai_grok_session_events["xai-grok-session-events<br/>4 rs · in 4"]
  c_xai_grok_shared["xai-grok-shared<br/>8 rs · in 3"]
  c_xai_grok_shell["xai-grok-shell<br/>603 rs · in 4"]
  c_xai_grok_status_line["xai-grok-status-line<br/>6 rs · in 3"]
  c_xai_grok_telemetry["xai-grok-telemetry<br/>55 rs · in 9"]
  c_xai_grok_tools["xai-grok-tools<br/>254 rs · in 15"]
  c_xai_grok_tools_api["xai-grok-tools-api<br/>5 rs · in 3"]
  c_xai_grok_version["xai-grok-version<br/>2 rs · in 17"]
  c_xai_grok_workspace["xai-grok-workspace<br/>94 rs · in 6"]
  c_xai_grok_workspace_types["xai-grok-workspace-types<br/>50 rs · in 4"]
  c_xai_hooks_plugins_types["xai-hooks-plugins-types<br/>1 rs · in 3"]
  c_xai_ratatui_inline["xai-ratatui-inline<br/>10 rs · in 3"]
  c_xai_ratatui_textarea["xai-ratatui-textarea<br/>14 rs · in 3"]
  c_xai_sqlite_journal["xai-sqlite-journal<br/>1 rs · in 4"]
  c_xai_token_estimation["xai-token-estimation<br/>1 rs · in 8"]
  c_xai_tty_utils["xai-tty-utils<br/>8 rs · in 19"]
  c_xai_codebase_graph --> c_xai_grok_paths
  c_xai_compaction_transcript --> c_xai_grok_sampling_types
  c_xai_fast_worktree --> c_xai_sqlite_journal
  c_xai_fast_worktree --> c_xai_tty_utils
  c_xai_file_utils --> c_xai_grok_auth
  c_xai_file_utils --> c_xai_grok_extra_ca
  c_xai_file_utils --> c_xai_grok_version
  c_xai_grok_agent --> c_xai_grok_config
  c_xai_grok_agent --> c_xai_grok_hooks
  c_xai_grok_agent --> c_xai_grok_sampling_types
  c_xai_grok_agent --> c_xai_grok_tools
  c_xai_grok_agent --> c_xai_token_estimation
  c_xai_grok_agent --> c_xai_tty_utils
  c_xai_grok_announcements --> c_xai_grok_tools
  c_xai_grok_config --> c_xai_grok_version
  c_xai_grok_config --> c_xai_tty_utils
  c_xai_grok_config_types --> c_xai_grok_announcements
  c_xai_grok_config_types --> c_xai_grok_config
  c_xai_grok_config_types --> c_xai_grok_mcp
  c_xai_grok_hooks --> c_xai_grok_config
  c_xai_grok_hooks --> c_xai_grok_extra_ca
  c_xai_grok_hooks --> c_xai_grok_tools
  c_xai_grok_http --> c_xai_grok_auth
  c_xai_grok_http --> c_xai_grok_extra_ca
  c_xai_grok_http --> c_xai_grok_sampler
  c_xai_grok_http --> c_xai_grok_telemetry
  c_xai_grok_http --> c_xai_grok_version
  c_xai_grok_http --> c_xai_grok_workspace
  c_xai_grok_mcp --> c_xai_grok_config
  c_xai_grok_mcp --> c_xai_grok_extra_ca
  c_xai_grok_mcp --> c_xai_grok_session_events
  c_xai_grok_mcp --> c_xai_grok_telemetry
  c_xai_grok_mcp --> c_xai_grok_tools
  c_xai_grok_mcp --> c_xai_grok_version
  c_xai_grok_mcp --> c_xai_grok_workspace_types
  c_xai_grok_pager --> c_xai_acp_lib
  c_xai_grok_pager --> c_xai_fast_worktree
  c_xai_grok_pager --> c_xai_file_utils
  c_xai_grok_pager --> c_xai_grok_agent
  c_xai_grok_pager --> c_xai_grok_announcements
  c_xai_grok_pager --> c_xai_grok_config
  c_xai_grok_pager --> c_xai_grok_sandbox
  c_xai_grok_pager --> c_xai_grok_shell
  c_xai_grok_pager --> c_xai_grok_status_line
  c_xai_grok_pager --> c_xai_grok_telemetry
  c_xai_grok_pager --> c_xai_grok_tools
  c_xai_grok_pager --> c_xai_grok_version
  c_xai_grok_pager --> c_xai_grok_workspace
  c_xai_grok_pager --> c_xai_hooks_plugins_types
  c_xai_grok_pager --> c_xai_ratatui_inline
  c_xai_grok_pager --> c_xai_ratatui_textarea
  c_xai_grok_pager --> c_xai_token_estimation
  c_xai_grok_pager --> c_xai_tty_utils
  c_xai_grok_sampler --> c_xai_grok_auth
  c_xai_grok_sampler --> c_xai_grok_extra_ca
  c_xai_grok_sampler --> c_xai_grok_sampling_types
  c_xai_grok_sampler --> c_xai_grok_version
  c_xai_grok_sampling_types --> c_xai_grok_tools
  c_xai_grok_sandbox --> c_xai_grok_config
  c_xai_grok_shared --> c_xai_grok_config_types
  c_xai_grok_shared --> c_xai_grok_status_line
  c_xai_grok_shared --> c_xai_grok_tools
  c_xai_grok_shared --> c_xai_tty_utils
  c_xai_grok_shell --> c_xai_acp_lib
  c_xai_grok_shell --> c_xai_codebase_graph
  c_xai_grok_shell --> c_xai_compaction_transcript
  c_xai_grok_shell --> c_xai_fast_worktree
  c_xai_grok_shell --> c_xai_file_utils
  c_xai_grok_shell --> c_xai_grok_agent
  c_xai_grok_shell --> c_xai_grok_announcements
  c_xai_grok_shell --> c_xai_grok_auth
  c_xai_grok_shell --> c_xai_grok_config
  c_xai_grok_shell --> c_xai_grok_config_types
  c_xai_grok_shell --> c_xai_grok_extra_ca
  c_xai_grok_shell --> c_xai_grok_hooks
  c_xai_grok_shell --> c_xai_grok_http
  c_xai_grok_shell --> c_xai_grok_mcp
  c_xai_grok_shell --> c_xai_grok_paths
  c_xai_grok_shell --> c_xai_grok_sampler
  c_xai_grok_shell --> c_xai_grok_sampling_types
  c_xai_grok_shell --> c_xai_grok_sandbox
  c_xai_grok_shell --> c_xai_grok_session_events
  c_xai_grok_shell --> c_xai_grok_shared
  c_xai_grok_shell --> c_xai_grok_status_line
  c_xai_grok_shell --> c_xai_grok_telemetry
  c_xai_grok_shell --> c_xai_grok_tools
  c_xai_grok_shell --> c_xai_grok_version
  c_xai_grok_shell --> c_xai_grok_workspace
  c_xai_grok_shell --> c_xai_hooks_plugins_types
  c_xai_grok_shell --> c_xai_token_estimation
  c_xai_grok_shell --> c_xai_tty_utils
  c_xai_grok_telemetry --> c_xai_file_utils
  c_xai_grok_telemetry --> c_xai_grok_auth
  c_xai_grok_telemetry --> c_xai_grok_config
  c_xai_grok_telemetry --> c_xai_grok_env
  c_xai_grok_telemetry --> c_xai_grok_extra_ca
  c_xai_grok_telemetry --> c_xai_grok_sampler
  c_xai_grok_telemetry --> c_xai_grok_session_events
  c_xai_grok_telemetry --> c_xai_grok_version
  c_xai_grok_telemetry --> c_xai_token_estimation
  c_xai_grok_telemetry --> c_xai_tty_utils
  c_xai_grok_tools --> c_xai_file_utils
  c_xai_grok_tools --> c_xai_grok_auth
  c_xai_grok_tools --> c_xai_grok_config
  c_xai_grok_tools --> c_xai_grok_env
  c_xai_grok_tools --> c_xai_grok_extra_ca
  c_xai_grok_tools --> c_xai_grok_sandbox
  c_xai_grok_tools --> c_xai_grok_tools_api
  c_xai_grok_tools --> c_xai_grok_version
  c_xai_grok_tools --> c_xai_grok_workspace_types
  c_xai_grok_tools --> c_xai_token_estimation
  c_xai_grok_tools --> c_xai_tty_utils
  c_xai_grok_workspace --> c_xai_acp_lib
  c_xai_grok_workspace --> c_xai_codebase_graph
  c_xai_grok_workspace --> c_xai_fast_worktree
  c_xai_grok_workspace --> c_xai_file_utils
  c_xai_grok_workspace --> c_xai_grok_agent
  c_xai_grok_workspace --> c_xai_grok_auth
  c_xai_grok_workspace --> c_xai_grok_config
  c_xai_grok_workspace --> c_xai_grok_config_types
  c_xai_grok_workspace --> c_xai_grok_env
  c_xai_grok_workspace --> c_xai_grok_extra_ca
  c_xai_grok_workspace --> c_xai_grok_hooks
  c_xai_grok_workspace --> c_xai_grok_mcp
  c_xai_grok_workspace --> c_xai_grok_paths
  c_xai_grok_workspace --> c_xai_grok_sandbox
  c_xai_grok_workspace --> c_xai_grok_session_events
  c_xai_grok_workspace --> c_xai_grok_telemetry
  c_xai_grok_workspace --> c_xai_grok_tools
  c_xai_grok_workspace --> c_xai_grok_tools_api
  c_xai_grok_workspace --> c_xai_grok_version
  c_xai_grok_workspace --> c_xai_grok_workspace_types
  c_xai_grok_workspace --> c_xai_tty_utils
```

## 全部 crate

| crate | 层 | .rs | 入度 | 出度 | 路径 | 一句话 |
|---|---|---:|---:|---:|---|---|
| `dagre_rust` | third_party | 24 | 1 | 2 | `third_party/dagre_rust` | Dagre layout in Rust (vendored, library-only) |
| `graphlib_rust` | third_party | 6 | 2 | 1 | `third_party/graphlib_rust` | Dagre's graphlib in Rust (vendored, library-only) |
| `mermaid-to-svg` | third_party | 35 | 1 | 2 | `third_party/mermaid-to-svg` | Convert Mermaid diagram source to SVG via a dagre layout port (vendored, library-only) |
| `ordered_hashmap` | third_party | 1 | 2 | 0 | `third_party/ordered_hashmap` | Ordered HashMap preserving insertion order (vendored, library-only) |
| `prod-mc-cli-chat-proxy-types` | prod | 11 | 5 | 0 | `prod/mc/cli-chat-proxy-types` | Lightweight request/response types for cli-chat-proxy API |
| `ptyctl` | codegen | 8 | 2 | 0 | `crates/codegen/ptyctl` | Headless PTY controller built on alacritty_terminal |
| `ptyctl-cli` | codegen | 6 | 0 | 1 | `crates/codegen/ptyctl-cli` | CLI for ptyctl headless PTY controller |
| `xai-acp-lib` | codegen | 8 | 6 | 0 | `crates/codegen/xai-acp-lib` |  |
| `xai-agent-lifecycle` | codegen | 15 | 1 | 0 | `crates/codegen/xai-agent-lifecycle` |  |
| `xai-chat-state` | codegen | 18 | 1 | 4 | `crates/codegen/xai-chat-state` | Actor-based chat state management for xAI agents |
| `xai-circuit-breaker` | common | 19 | 2 | 0 | `crates/common/xai-circuit-breaker` |  |
| `xai-codebase-graph` | codegen | 28 | 2 | 1 | `crates/codegen/xai-codebase-graph` | High-performance code graph generation using tree-sitter queries |
| `xai-compaction-transcript` | codegen | 1 | 2 | 1 | `crates/codegen/xai-compaction-transcript` | Markdown rendering of compacted conversation segments and the on-disk segment-store naming convention |
| `xai-computer-hub-core` | common | 15 | 2 | 3 | `crates/common/xai-computer-hub-core` | Transport, ToolRegistry, and resolver abstractions for the xAI Computer Hub |
| `xai-computer-hub-mcp-adapter` | common | 5 | 1 | 4 | `crates/common/xai-computer-hub-mcp-adapter` | Bridge between MCP servers and the xAI Computer Hub, registering MCP-discovered tools as native hub tools. |
| `xai-computer-hub-sdk` | common | 22 | 6 | 5 | `crates/common/xai-computer-hub-sdk` | SDK for the xAI Computer Hub: connection pool, transparent reconnect, tool harness, and tool-server runtime. |
| `xai-crash-handler` | codegen | 6 | 2 | 0 | `crates/codegen/xai-crash-handler` | Cross-platform crash handler (Unix signals + Windows SEH) with startup crash detection |
| `xai-fast-worktree` | codegen | 73 | 3 | 4 | `crates/codegen/xai-fast-worktree` | High-performance git worktree creation using CoW cloning |
| `xai-file-utils` | codegen | 12 | 6 | 5 | `crates/codegen/xai-file-utils` | Local data collection: upload queueing and blob storage |
| `xai-fsnotify` | codegen | 19 | 2 | 0 | `crates/codegen/xai-fsnotify` | Local-filesystem event source: single causal stream of semantic FsEvents |
| `xai-fuzzy-file-search` | codegen | 1 | 1 | 0 | `crates/codegen/xai-fuzzy-file-search` | Fuzzy file search over a directory tree: an ignore-aware walker feeding a nucleo matcher, plus a background daemon |
| `xai-gix-status` | codegen | 1 | 2 | 0 | `crates/codegen/xai-gix-status` | Shared gix status helpers: thread budget under RLIMIT_NPROC so produce-worker spawn cannot abort under panic=abort |
| `xai-grok-active-sessions` | codegen | 2 | 2 | 1 | `crates/codegen/xai-grok-active-sessions` | Crash-recovery registry of open TUI sessions, stored as a lock-guarded JSON file under the grok home |
| `xai-grok-agent` | codegen | 31 | 5 | 7 | `crates/codegen/xai-grok-agent` | Agent builder, definition parsing, and system prompt assembly |
| `xai-grok-announcements` | codegen | 1 | 3 | 1 | `crates/codegen/xai-grok-announcements` | Shared announcement types, persistence, and formatting for Grok CLI apps |
| `xai-grok-auth` | codegen | 5 | 8 | 0 | `crates/codegen/xai-grok-auth` | Auth dependency-inversion seam: HttpAuth + AuthCredentialProvider traits |
| `xai-grok-bundle` | codegen | 1 | 1 | 2 | `crates/codegen/xai-grok-bundle` | Checksum-tracked on-disk cache for the published subagent bundle (personas, roles, agents, skills) |
| `xai-grok-compaction` | common | 34 | 3 | 0 | `crates/common/xai-grok-compaction` | Shared, transport-agnostic compaction engine for Grok chat and Grok Build. |
| `xai-grok-config` | codegen | 27 | 18 | 4 | `crates/codegen/xai-grok-config` | Shared config loading for Grok — grok_home, effective config (requirements > user > managed), TOML merge |
| `xai-grok-config-types` | codegen | 8 | 4 | 3 | `crates/codegen/xai-grok-config-types` | Leaf configuration value types for the grok CLI, extracted from xai-grok-shell for dependency inversion. |
| `xai-grok-diag-server` | codegen | 1 | 1 | 1 | `crates/codegen/xai-grok-diag-server` | In-guest diagnostics HTTP server (/ready, /statusz, /logs) for the standalone workspace-server |
| `xai-grok-env` | codegen | 1 | 4 | 0 | `crates/codegen/xai-grok-env` | Backend environment presets for the Grok CLI crate family: endpoint URL defaults and env-var test support. |
| `xai-grok-extra-ca` | codegen | 9 | 13 | 0 | `crates/codegen/xai-grok-extra-ca` | TLS policy for the grok CLI: rustls backend pin, process crypto provider, shared root store, and opt-in GROK_EXTRA_CA_BUNDLE roots |
| `xai-grok-foreign-sessions` | codegen | 15 | 2 | 1 | `crates/codegen/xai-grok-foreign-sessions` | Bounded, metadata-only discovery of foreign coding-agent sessions |
| `xai-grok-home` | codegen | 1 | 2 | 0 | `crates/codegen/xai-grok-home` | Single source of truth for resolving the grok home directory ($GROK_HOME or <home>/.grok) |
| `xai-grok-hooks` | codegen | 15 | 3 | 3 | `crates/codegen/xai-grok-hooks` | Runtime hook system for Grok — file-based discovery, command execution, and policy enforcement |
| `xai-grok-http` | codegen | 1 | 3 | 6 | `crates/codegen/xai-grok-http` | Shared reqwest HTTP clients and User-Agent construction for the grok CLI. |
| `xai-grok-markdown` | codegen | 27 | 2 | 2 | `crates/codegen/xai-grok-markdown` | Streaming markdown renderer for terminal UIs |
| `xai-grok-markdown-core` | codegen | 1 | 1 | 0 | `crates/codegen/xai-grok-markdown-core` | Headless markdown analysis sharing Grok Build's exact pulldown-cmark config. |
| `xai-grok-mcp` | codegen | 13 | 3 | 10 | `crates/codegen/xai-grok-mcp` | MCP integration crate. Quarantines rmcp + reqwest 0.13 (rmcp 2.1 requires reqwest >= 0.13.2 while the rest of the workspace uses reqwest 0.12) and owns the MCP credential store and OAuth flow orchestrator. |
| `xai-grok-memory` | codegen | 17 | 1 | 7 | `crates/codegen/xai-grok-memory` |  |
| `xai-grok-mermaid` | codegen | 7 | 1 | 2 | `crates/codegen/xai-grok-mermaid` | Render Mermaid diagram source to a rasterized PNG behind a swappable engine trait |
| `xai-grok-models` | codegen | 1 | 2 | 0 | `crates/codegen/xai-grok-models` | Default model IDs for the grok CLI, loaded from the embedded default_models.json. |
| `xai-grok-pager` | codegen | 791 | 2 | 29 | `crates/codegen/xai-grok-pager` |  |
| `xai-grok-pager-bin` | codegen | 3 | 0 | 14 | `crates/codegen/xai-grok-pager-bin` |  |
| `xai-grok-pager-diff` | codegen | 1 | 2 | 1 | `crates/codegen/xai-grok-pager-diff` | Diff hunk construction for the Grok Build TUI |
| `xai-grok-pager-minimal` | codegen | 12 | 1 | 6 | `crates/codegen/xai-grok-pager-minimal` |  |
| `xai-grok-pager-pty-harness` | codegen | 45 | 0 | 3 | `crates/codegen/xai-grok-pager-pty-harness` | Shared PTY harness + scenario library for xai-grok-pager e2e tests and benchmarks. |
| `xai-grok-pager-render` | codegen | 72 | 1 | 10 | `crates/codegen/xai-grok-pager-render` |  |
| `xai-grok-paths` | codegen | 1 | 5 | 0 | `crates/codegen/xai-grok-paths` | Type-safe path wrappers for absolute and relative UTF-8 paths |
| `xai-grok-plugin-marketplace` | codegen | 11 | 2 | 4 | `crates/codegen/xai-grok-plugin-marketplace` |  |
| `xai-grok-sampler` | codegen | 30 | 3 | 4 | `crates/codegen/xai-grok-sampler` | Actor-based sampling/inference layer for xAI grok (HTTP streaming + retry, no shell coupling) |
| `xai-grok-sampling-types` | codegen | 16 | 6 | 3 | `crates/codegen/xai-grok-sampling-types` | Pure data types for the xAI sampling / chat-completion API layer |
| `xai-grok-sandbox` | codegen | 16 | 6 | 1 | `crates/codegen/xai-grok-sandbox` | OS-level sandboxing for Grok Build using kernel primitives (Landlock/Seatbelt) via nono |
| `xai-grok-secrets` | codegen | 2 | 2 | 0 | `crates/codegen/xai-grok-secrets` | Regex sanitizer for Grok Build outbound data (Sentry / Mixpanel / product-event scrubbing) |
| `xai-grok-session-events` | codegen | 4 | 4 | 0 | `crates/codegen/xai-grok-session-events` | Typed per-session event log written as JSON lines |
| `xai-grok-session-search` | codegen | 10 | 1 | 3 | `crates/codegen/xai-grok-session-search` | SQLite FTS5 index over local grok sessions: lease-guarded bootstrap, debounced incremental upserts, and BM25 ranked query |
| `xai-grok-shared` | codegen | 8 | 3 | 6 | `crates/codegen/xai-grok-shared` |  |
| `xai-grok-shell` | codegen | 603 | 4 | 53 | `crates/codegen/xai-grok-shell` |  |
| `xai-grok-shell-base` | codegen | 10 | 1 | 6 | `crates/codegen/xai-grok-shell-base` | Foundation modules for the grok shell crate family: environment presets, CPU profiling, and process/filesystem utilities. |
| `xai-grok-shell-session-support` | codegen | 2 | 1 | 3 | `crates/codegen/xai-grok-shell-session-support` | Session-support modules for the grok shell crate family: managed MCP gateway catalog/call caching and file-access tracking. |
| `xai-grok-shell-terminal` | codegen | 11 | 1 | 7 | `crates/codegen/xai-grok-shell-terminal` | Local, ACP, and PTY terminal runners extracted from xai-grok-shell so they compile in parallel. |
| `xai-grok-status-line` | codegen | 6 | 3 | 0 | `crates/codegen/xai-grok-status-line` | The status-line contract: the `[ui.status_line]` config a user writes and the payload the agent sends clients. |
| `xai-grok-subagent-resolution` | codegen | 7 | 1 | 4 | `crates/codegen/xai-grok-subagent-resolution` | Shared subagent definition, runtime, prompt, and resume resolution |
| `xai-grok-telemetry` | codegen | 55 | 9 | 12 | `crates/codegen/xai-grok-telemetry` | Telemetry engine: product events + Mixpanel emission + Sentry error reporting for Grok Build sessions |
| `xai-grok-test-support` | codegen | 14 | 1 | 2 | `crates/codegen/xai-grok-test-support` | Shared test-support for grok-build crates: mock inference server, SSE generators, ACP stdio client, headless runner, env sandbox |
| `xai-grok-tools` | codegen | 254 | 15 | 17 | `crates/codegen/xai-grok-tools` | Grok tools library |
| `xai-grok-tools-api` | codegen | 5 | 3 | 2 | `crates/codegen/xai-grok-tools-api` | Protobuf API definitions for Grok tools |
| `xai-grok-update` | codegen | 16 | 2 | 5 | `crates/codegen/xai-grok-update` |  |
| `xai-grok-version` | codegen | 2 | 17 | 0 | `crates/codegen/xai-grok-version` | Lockstepped grok CLI version. |
| `xai-grok-voice` | codegen | 18 | 1 | 2 | `crates/codegen/xai-grok-voice` | Voice dictation (streaming STT) for Grok Build CLI |
| `xai-grok-workspace` | codegen | 94 | 6 | 33 | `crates/codegen/xai-grok-workspace` | Core host-local workspace library (FS, VCS, execution, discovery) for xai-grok-shell and remote sampler |
| `xai-grok-workspace-client` | codegen | 1 | 1 | 4 | `crates/codegen/xai-grok-workspace-client` | Lightweight typed client for hub-proxied workspace.* RPCs (shared by xai-grok-shell proxy mode and other consumers) |
| `xai-grok-workspace-daemon` | codegen | 3 | 1 | 2 | `crates/codegen/xai-grok-workspace-daemon` | Process lifecycle for the workspace-server daemon: self-daemonization, single-instance pidfile locking, and preview-proxy child supervision |
| `xai-grok-workspace-types` | codegen | 50 | 4 | 0 | `crates/codegen/xai-grok-workspace-types` | Wire types for the xAI workspace API (request/chunk/event enums shared by client and server) |
| `xai-hooks-plugins-types` | codegen | 1 | 3 | 0 | `crates/codegen/xai-hooks-plugins-types` | Shared DTO types for hooks/plugins ACP extensions (wire format only) |
| `xai-hunk-tracker` | codegen | 17 | 2 | 1 | `crates/codegen/xai-hunk-tracker` | Track file hunks (diffs) with agent/external attribution |
| `xai-interjection-core` | common | 4 | 2 | 0 | `crates/common/xai-interjection-core` | Shared mid-turn interjection buffer and formatting for the client and server agent loops |
| `xai-mixpanel` | codegen | 1 | 1 | 1 | `crates/codegen/xai-mixpanel` | Lightweight Mixpanel HTTP tracking client (replaces mixpanel-rs to avoid pulling reqwest 0.11) |
| `xai-prompt-queue` | codegen | 3 | 2 | 0 | `crates/codegen/xai-prompt-queue` | Shared prompt-queue wire types for xai-grok-shell and xai-grok-pager |
| `xai-proto-build` | build | 3 | 1 | 0 | `crates/build/xai-proto-build` | Build protobuf |
| `xai-ratatui-inline` | codegen | 10 | 3 | 0 | `crates/codegen/xai-ratatui-inline` |  |
| `xai-ratatui-textarea` | codegen | 14 | 3 | 0 | `crates/codegen/xai-ratatui-textarea` |  |
| `xai-sqlite-journal` | codegen | 1 | 4 | 0 | `crates/codegen/xai-sqlite-journal` | Filesystem-aware SQLite journal-mode selection: WAL on local disks, rollback journal on network mounts where WAL's mmap'd -shm is unsafe |
| `xai-system-power` | codegen | 4 | 1 | 0 | `crates/codegen/xai-system-power` | Cross-platform system sleep/wake (suspend) notifications — used to defer work across a suspend boundary |
| `xai-test-utils` | common | 6 | 0 | 0 | `crates/common/xai-test-utils` | Shared test utilities: hermetic git, optional runfiles helpers |
| `xai-token-estimation` | codegen | 1 | 8 | 0 | `crates/codegen/xai-token-estimation` | Pure shared token-estimation primitives. |
| `xai-tool-protocol` | common | 22 | 10 | 1 | `crates/common/xai-tool-protocol` | Wire-protocol types for the xAI Computer Hub |
| `xai-tool-runtime` | common | 18 | 8 | 3 | `crates/common/xai-tool-runtime` | Unified Tool trait, dispatch trait, error taxonomy, notifications, and search index for the xAI Computer Hub |
| `xai-tool-types` | common | 6 | 11 | 0 | `crates/common/xai-tool-types` | Canonical tool-description types for the xAI platform |
| `xai-tracing` | common | 8 | 2 | 0 | `crates/common/xai-tracing` |  |
| `xai-tracing-macros` | codegen | 3 | 1 | 0 | `crates/codegen/xai-tracing-macros` | Tracing-based utility macros for timestamped logging and timing |
| `xai-tty-utils` | codegen | 8 | 19 | 0 | `crates/codegen/xai-tty-utils` | Lightweight process-spawning utilities for TTY safety — detach from controlling terminal, suppress interactive pagers, process-group lifecycle |
| `xai-workflow` | codegen | 8 | 1 | 0 | `crates/codegen/xai-workflow` | Rhai-scripted dynamic workflow engine: scripts orchestrate agents through a host channel |
