---
inclusion: manual
---

# Web-AIGC 58 Spec Agent 分派矩阵

## 文档目标

本文把当前 `58` 个 `web-aigc` 迁移 spec，逐项分配到 `11` 个并行 Agent 工作流中。

目标是做到三件事：

1. 每个 spec 都有明确负责人
2. 每个 Agent 都有清晰 ownership
3. 并行执行时知道谁先做、谁后做、谁会冲突

## Agent 总览

| Agent | 名称 | 主要职责 | 推荐波次 |
| --- | --- | --- | --- |
| Agent 0 | 总控与收口 | Gate、共享契约、冲突协调、合并顺序 | 全程 |
| Agent 1 | 平台主干 A | 领域模型、运行时内核 | Wave 0-1 |
| Agent 2 | 平台主干 B | mission 投影、session / instance | Wave 1 |
| Agent 3 | 平台主干 C | 审计、可观测、安全治理 | Wave 3-4 |
| Agent 4 | 对话与问答 | dialogue / QA / LLM | Wave 1-2 |
| Agent 5 | 人工输入与会话分支 | user input / HITL / command | Wave 1-2 |
| Agent 6 | 检索与内容处理 | search / extraction / translation / file | Wave 2 |
| Agent 7 | 多模态与输出 | OCR / ASR / image / PPT / chart | Wave 1-2 |
| Agent 8 | 工具、Agent 与外部调用 | MCP / auto_agent / API / notification | Wave 1 / 4 |
| Agent 9 | 控制流与图中台 | start / end / condition / loop / jump | Wave 3 |
| Agent 10 | 高风险写操作与宿主动作 | vector 写路径 / transaction / page actions | Wave 1 / 4 |

## Agent 0：总控与收口

### 职责

- 维护总计划与 Gate
- 收口共享术语、共享契约
- 决定放行下一波执行
- 处理热点文件冲突
- 组织最终合并与回归

### 允许写入

- `.kiro/steering/*`
- 必要时协调热点文件

### 不直接承接 spec

Agent 0 不直接承接功能 spec，主要负责治理与收口。

## Agent 1：平台主干 A

### 承接 spec

- `web-aigc-platform-domain-model`
- `web-aigc-platform-runtime-engine`

### 关键 ownership

- `shared/workflow-runtime.ts`
- `shared/workflow-kernel.ts`
- `server/core/workflow-engine.ts`
- `server/routes/workflows.ts`

### 依赖关系

- 无前置平台依赖
- 是所有节点 Agent 的核心前置

### Gate

- G0 术语与契约冻结
- G1 Runtime Kernel 可被节点调用

## Agent 2：平台主干 B

### 承接 spec

- `web-aigc-platform-mission-projection`
- `web-aigc-platform-session-instance`

### 关键 ownership

- `shared/workflow-input.ts`
- `shared/mission/contracts.ts`
- `server/tasks/*`
- `server/memory/session-store.ts`
- `server/routes/tasks.ts`

### 依赖关系

- 依赖 Agent 1 的 runtime contract

### Gate

- G2 Mission / Session 投影打通

## Agent 3：平台主干 C

### 承接 spec

- `web-aigc-platform-observability-audit`
- `web-aigc-platform-security-governance`

### 关键 ownership

- `shared/audit/*`
- `shared/permission/*`
- `server/audit/*`
- `server/permission/*`
- `server/routes/audit.ts`
- `server/routes/permissions.ts`
- `server/routes/lineage.ts`
- `server/routes/replay.ts`

### 依赖关系

- 依赖 Agent 1、2 的实例与任务投影结构

### Gate

- G3 审计与权限门禁打通

## Agent 4：对话与问答能力簇

### 承接 spec

- `web-aigc-node-dialogue`
- `web-aigc-node-robot_reply`
- `web-aigc-node-knowledge_qa`
- `web-aigc-node-web_qa`
- `web-aigc-node-llm`

### 关键 ownership

- `server/routes/chat.ts`
- `server/routes/knowledge.ts`
- `server/routes/rag.ts`
- `server/routes/skills.ts` 的最小调用侧扩展
- 对应 `node adapter` 新目录

### 依赖关系

- 依赖 Agent 1 runtime kernel
- `knowledge_qa` / `web_qa` 依赖检索底座
- `llm` 与审计、成本治理有弱依赖

### 推荐次序

1. `web-aigc-node-dialogue`
2. `web-aigc-node-knowledge_qa`
3. `web-aigc-node-llm`
4. `web-aigc-node-robot_reply`
5. `web-aigc-node-web_qa`

## Agent 5：人工输入与会话分支能力簇

### 承接 spec

- `web-aigc-node-user_input`
- `web-aigc-node-selection`
- `web-aigc-node-confirm_judge`
- `web-aigc-node-param_collection`
- `web-aigc-node-intent_recognition`
- `web-aigc-node-command_list`
- `web-aigc-node-recommended_commands`

### 关键 ownership

- `server/routes/tasks.ts` 的子模块扩展
- `client/src/components/tasks/*`
- `client/src/lib/tasks-store.ts`
- `client/src/lib/mission-client.ts`
- 对应 `node adapter` 新目录

### 依赖关系

- 强依赖 Agent 2 的 session / mission projection
- 部分依赖 Agent 1 的 waiting / resume runtime 语义

### 推荐次序

1. `web-aigc-node-user_input`
2. `web-aigc-node-selection`
3. `web-aigc-node-confirm_judge`
4. `web-aigc-node-param_collection`
5. `web-aigc-node-intent_recognition`
6. `web-aigc-node-command_list`
7. `web-aigc-node-recommended_commands`

## Agent 6：检索与内容处理能力簇

### 承接 spec

- `web-aigc-node-document_search`
- `web-aigc-node-fragment_search`
- `web-aigc-node-graph_search`
- `web-aigc-node-web_search`
- `web-aigc-node-qa_search`
- `web-aigc-node-long_text_extraction`
- `web-aigc-node-file_slicing`
- `web-aigc-node-file_translation`
- `web-aigc-node-excel_read`
- `web-aigc-node-static_webpage_read`
- `web-aigc-node-file_generation`
- `web-aigc-node-similarity_match`

### 关键 ownership

- `server/routes/rag.ts`
- `server/routes/knowledge.ts`
- 内容处理相关新模块
- artifact / file service 新模块

### 依赖关系

- 依赖 Agent 1 runtime contract
- 与 Agent 4 共享部分检索底座，但应避免互相改主文件

### 推荐次序

1. `web-aigc-node-document_search`
2. `web-aigc-node-fragment_search`
3. `web-aigc-node-graph_search`
4. `web-aigc-node-web_search`
5. `web-aigc-node-qa_search`
6. `web-aigc-node-long_text_extraction`
7. `web-aigc-node-file_slicing`
8. `web-aigc-node-file_translation`
9. `web-aigc-node-excel_read`
10. `web-aigc-node-static_webpage_read`
11. `web-aigc-node-file_generation`
12. `web-aigc-node-similarity_match`

## Agent 7：多模态与输出能力簇

### 承接 spec

- `web-aigc-node-audio_recognition`
- `web-aigc-node-ocr_recognition`
- `web-aigc-node-image_search`
- `web-aigc-node-ai_ppt`
- `web-aigc-node-dynamic_chart`

### 关键 ownership

- `server/routes/voice.ts`
- `server/routes/vision.ts`
- artifact / export / output 相关新模块

### 依赖关系

- 依赖 Agent 1 runtime contract
- `audio_recognition` / `ocr_recognition` 可进入第一波
- `ai_ppt` / `dynamic_chart` 适合第二波

### 推荐次序

1. `web-aigc-node-audio_recognition`
2. `web-aigc-node-ocr_recognition`
3. `web-aigc-node-image_search`
4. `web-aigc-node-ai_ppt`
5. `web-aigc-node-dynamic_chart`

## Agent 8：工具、Agent 与外部调用能力簇

### 承接 spec

- `web-aigc-node-mcp`
- `web-aigc-node-auto_agent`
- `web-aigc-node-internal_api`
- `web-aigc-node-passthrough_api`
- `web-aigc-node-message_notification`

### 关键 ownership

- `server/routes/a2a.ts`
- `server/routes/skills.ts`
- `server/routes/guest-agents.ts`
- 工具适配器新目录
- API adapter 新目录

### 依赖关系

- `mcp` / `auto_agent` 可在 Wave 1 启动
- `internal_api` / `passthrough_api` / `message_notification` 必须等 Agent 3 的 G3

### 推荐次序

1. `web-aigc-node-mcp`
2. `web-aigc-node-auto_agent`
3. `web-aigc-node-internal_api`
4. `web-aigc-node-passthrough_api`
5. `web-aigc-node-message_notification`

## Agent 9：控制流与图中台能力簇

### 承接 spec

- `web-aigc-node-start`
- `web-aigc-node-end`
- `web-aigc-node-condition`
- `web-aigc-node-loop`
- `web-aigc-node-flow_jump`
- `web-aigc-node-variable_assignment`
- `web-aigc-node-format_output`
- `web-aigc-node-orchestration_recognition_jump`

### 关键 ownership

- 控制流 runtime 子模块
- transition / branch / variable adapter 新目录
- 必要时由 Agent 1 协调写入 `server/core/workflow-engine.ts`

### 依赖关系

- 强依赖 Agent 1 runtime kernel
- `condition` / `loop` / `flow_jump` 必须语义统一

### 推荐次序

1. `web-aigc-node-start`
2. `web-aigc-node-end`
3. `web-aigc-node-format_output`
4. `web-aigc-node-variable_assignment`
5. `web-aigc-node-condition`
6. `web-aigc-node-flow_jump`
7. `web-aigc-node-loop`
8. `web-aigc-node-orchestration_recognition_jump`

## Agent 10：高风险写操作与宿主动作能力簇

### 承接 spec

- `web-aigc-node-vector_query`
- `web-aigc-node-vector_insert`
- `web-aigc-node-vector_update`
- `web-aigc-node-vector_delete`
- `web-aigc-node-transaction_flow`
- `web-aigc-node-open_page`
- `web-aigc-node-open_report`
- `web-aigc-node-open_dashboard`
- `web-aigc-node-get_device_info`
- `web-aigc-node-get_location_info`

### 关键 ownership

- `server/memory/vector-store.ts`
- `server/routes/rag.ts`
- 前端宿主动作适配模块
- 事务动作 / 风险动作服务

### 依赖关系

- `vector_query` 可较早启动
- `vector_insert` / `vector_update` / `vector_delete` / `transaction_flow` 必须在 G3 之后
- 页面打开类与设备类节点应晚于宿主导航稳定后推进

### 推荐次序

1. `web-aigc-node-vector_query`
2. `web-aigc-node-open_page`
3. `web-aigc-node-open_report`
4. `web-aigc-node-open_dashboard`
5. `web-aigc-node-get_device_info`
6. `web-aigc-node-get_location_info`
7. `web-aigc-node-vector_insert`
8. `web-aigc-node-vector_update`
9. `web-aigc-node-vector_delete`
10. `web-aigc-node-transaction_flow`

## 波次分派总表

| Wave | 主要 Agent | spec 数量 | 目标 |
| --- | --- | --- | --- |
| Wave 0 | Agent 1 | 2 | 冻结领域模型与运行时内核 |
| Wave 1 | Agent 1、2、4、5、7、8、10 | 11-14 | 跑通最小闭环 |
| Wave 2 | Agent 4、5、6、7 | 20+ | 扩高价值节点族 |
| Wave 3 | Agent 3、9 | 10 | 补齐平台语义与治理面 |
| Wave 4 | Agent 3、8、10 | 12 | 收高风险动作与宿主集成 |

## 高冲突交叉表

| 冲突热点 | 涉及 Agent | 处理策略 |
| --- | --- | --- |
| `server/core/workflow-engine.ts` | 1、9 | Agent 1 单点收口 |
| `server/routes/tasks.ts` | 2、5 | Agent 2 持有主文件，Agent 5 走子模块 |
| `server/routes/rag.ts` | 4、6、10 | 优先新增子 service，主入口集中合并 |
| `server/routes/knowledge.ts` | 4、6 | Agent 4 主持，Agent 6 提供下游模块 |
| `server/routes/audit.ts` | 3、8、10 | Agent 3 独占主入口 |
| `server/routes/permissions.ts` | 3、8、10 | Agent 3 独占主入口 |
| `server/routes/voice.ts` / `vision.ts` | 7、10 | Agent 7 主持 |

## 夜间并行建议

如果要自动跑一晚，建议启动顺序如下：

1. Agent 1、2、3 先启动，先把平台接口和 Gate 压住
2. 30-60 分钟后放行 Agent 4、5、7、8、10 的第一批低风险节点
3. 2-3 小时后放行 Agent 6 的内容处理簇
4. 平台主干稳定后再放行 Agent 9
5. 最后才放行 Agent 10 的写操作部分

## 结束标准

当下面三件事同时成立，说明这份矩阵真的可执行：

1. 每个 spec 都已挂到唯一主责 Agent
2. 每个热点文件都有唯一主 owner
3. 每一波放行都有明确 Gate，而不是凭感觉推进
