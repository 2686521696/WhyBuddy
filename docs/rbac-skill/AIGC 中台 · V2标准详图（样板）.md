# AIGC 中台 · V2 标准详图（样板）

> 本系统在 V2 中为**执行点（PEP）**。保留它真正独有的：Agent 编排执行、节点能力池、LLM/RAG/工具运行时。
> V2 相对 V1 的关键改动：
> - **P0-1**：`RBAC_GATE / RETRIEVAL_AUTH`（知识库/文档/片段级权限过滤）的**判定委托 PDP**。
> - **P0-3**：`Model Datasource / 数据节点`读写业务数据，绑定数据中台 SSOT。
> - **P0-2/P1-7**：实例/节点/模型事件进**平台总线**；配置变更被**全局依赖图**失效；决策证据进**统一 Trace**。
> - **P2-9**：`SKILL_CONFIG` 已改名 `TOOL_SKILL_CONFIG`，与「Skill 能力」区分。

```mermaid
flowchart TB

subgraph INGRESS["01 接入、身份与租户"]
direction LR
  ROUTER["● AIGC Routes LLM/Flow/Knowledge/Vector"]:::core
  AUTH{"● JWT + 租户隔离"}:::gate
  RBAC_GATE{"● 鉴权入口（委托 PDP）"}:::gate
  RATE_LIMIT{"◆ AI 多级限流"}:::gate
end

subgraph CONTROL["02 配置与资产控制平面（独有）"]
direction LR
  ORCH_DEF["● 编排定义 Flow nodes+edges"]:::policy
  ORCH_VERSION["● 编排版本 草稿/发布/恢复"]:::ledger
  NODE_REGISTRY["● Node Registry + Schema"]:::policy
  MODEL_CONFIG["● Model Config Provider/参数"]:::policy
  PROMPT_TEMPLATE["● Prompt Template + 版本"]:::policy
  KB_DEF["● Knowledge Base 分块策略"]:::policy
  VECTOR_COLLECTION["● Vector Collection 维度/度量"]:::policy
  ONTOLOGY["● Ontology 概念/关系"]:::policy
  MCP_PLUGIN["● MCP Plugin Center"]:::policy
  TOOL_SKILL_CONFIG["● Tool-Skill Config（原 SKILL_CONFIG·已改名）"]:::policy
  TOOL_POLICY["◆ Tool Policy 白名单/预算"]:::policy
  FLOW_PUBLISH_GATE{"◆ Flow Publish Gate 版本冻结/依赖校验"}:::gate
  ACTIVE_ORCH["● Active Orchestration"]:::done
end

subgraph EXEC["03 编排执行控制平面（核心·独有）"]
direction LR
  INPUT_GUARD{"◆ Input Guard 注入检测"}:::gate
  FLOW_FACTORY["● Flow Instance Factory 冻结版本"]:::core
  FLOW_INSTANCE[("● Flow Instance 状态/当前节点")]:::state
  ORCHESTRATOR["● Flow Executor 调度节点/推进边"]:::core
  NODE_EXECUTOR["● Node Executor Dispatcher"]:::core
  NODE_POOL["● 节点能力池<br/>交互/LLM/知识/工具/多模态/向量 50+ 节点"]:::cap
  FLOW_CONTROL["● Flow Control 条件/循环/暂停"]:::core
  HUMAN_WAIT["● Await User Input"]:::await
  FLOW_RESULT["● Flow Result outputs/logs/artifacts"]:::report
end

subgraph EXECTOP["05 LLM / RAG / 工具执行拓扑（独有）"]
direction LR
  PROMPT_RENDERER["● Prompt Renderer"]:::core
  MODEL_ROUTER["● Model Router + Token Budget"]:::core
  CHAT_SERVICE["● LLM Chat/Embedding Service"]:::core
  PROVIDER_ADAPTER["● Provider Adapter 统一协议/熔断"]:::core
  QUERY_PIPELINE["● RAG Query retrieve→rerank→generate"]:::core
  RETRIEVAL_AUTH{"◆ 检索权限过滤（委托 PDP）"}:::gate
  TOOL_ROUTER["● Tool Router Skill/Agent/MCP/API"]:::core
  TOOL_SANDBOX["◆ Tool Sandbox 超时/网络边界"]:::trust
end

subgraph RUNTIME["06 运行时（独有）"]
direction LR
  MYSQL[("● MySQL 编排/版本/知识/配置")]:::runtime
  REDIS[("● Redis 会话/限流/锁")]:::runtime
  QDRANT[("● Qdrant 向量检索")]:::runtime
  QUEUE["● Bull Queue 异步节点/索引/同步"]:::bus
end

OUTPUT["09 输出<br/>对话/编排结果/RAG答案/多模态产物"]:::report

KERNEL_PDP{"① PDP（外部）"}:::kernel
KERNEL_SSOT[("② 数据模型 SSOT（外部）")]:::kernel
KERNEL_BUS["③ 平台事件总线（外部）"]:::kernel
KERNEL_DEP["④ 全局失效引擎（外部）"]:::kernel
KERNEL_TRACE["⑤ 统一 Trace（外部）"]:::kernel
KERNEL_COMPOSE{"⑥ 应用中心 组装根（外部）"}:::kernel

%% 接入
ROUTER --> AUTH
AUTH --> RBAC_GATE
RBAC_GATE --> RATE_LIMIT

%% 配置发布
ORCH_DEF --> ORCH_VERSION
NODE_REGISTRY --> ORCH_DEF
MODEL_CONFIG --> ORCH_DEF
PROMPT_TEMPLATE --> ORCH_DEF
MCP_PLUGIN --> TOOL_POLICY
TOOL_SKILL_CONFIG --> TOOL_POLICY
ORCH_VERSION --> FLOW_PUBLISH_GATE
FLOW_PUBLISH_GATE --> ACTIVE_ORCH

%% 执行
RATE_LIMIT --> INPUT_GUARD
INPUT_GUARD --> FLOW_FACTORY
ACTIVE_ORCH --> FLOW_FACTORY
FLOW_FACTORY --> FLOW_INSTANCE
FLOW_INSTANCE --> ORCHESTRATOR
ORCHESTRATOR --> NODE_EXECUTOR
NODE_EXECUTOR --> NODE_POOL
NODE_POOL --> FLOW_CONTROL
FLOW_CONTROL --> HUMAN_WAIT
FLOW_CONTROL --> FLOW_RESULT

%% 拓扑
NODE_POOL --> PROMPT_RENDERER
PROMPT_RENDERER --> MODEL_ROUTER
MODEL_ROUTER --> CHAT_SERVICE
CHAT_SERVICE --> PROVIDER_ADAPTER
NODE_POOL --> QUERY_PIPELINE
QUERY_PIPELINE --> RETRIEVAL_AUTH
RETRIEVAL_AUTH --> QDRANT
NODE_POOL --> TOOL_ROUTER
TOOL_POLICY --> TOOL_ROUTER
TOOL_ROUTER --> TOOL_SANDBOX

%% 运行时
FLOW_INSTANCE --> MYSQL
FLOW_INSTANCE --> REDIS
ORCHESTRATOR -.异步.-> QUEUE
FLOW_RESULT --> OUTPUT

%% 与内核（V2 关键改动）
RBAC_GATE -.①鉴权委托.-> KERNEL_PDP
RETRIEVAL_AUTH -.①检索权限.-> KERNEL_PDP
NODE_POOL -.②数据节点读写.-> KERNEL_SSOT
FLOW_INSTANCE -.③实例/节点/模型事件.-> KERNEL_BUS
ORCH_VERSION -.③发布事件.-> KERNEL_BUS
KERNEL_DEP -.④配置变更失效.-> ACTIVE_ORCH
FLOW_PUBLISH_GATE -.⑤闭包校验.-> KERNEL_DEP
MODEL_ROUTER -.⑤路由/工具决策证据.-> KERNEL_TRACE
KERNEL_COMPOSE ==> ORCH_DEF

classDef kernel fill:#fef3c7,stroke:#d97706,color:#78350f,stroke-width:1.5px
classDef core fill:#e0e7ff,stroke:#4f46e5,color:#312e81,stroke-width:1.5px
classDef cap fill:#ede9fe,stroke:#7c3aed,color:#4c1d95,stroke-width:1.5px
classDef policy fill:#fae8ff,stroke:#c026d3,color:#701a75,stroke-width:1.5px
classDef gate fill:#fde68a,stroke:#d97706,color:#78350f,stroke-width:1.5px
classDef ledger fill:#ccfbf1,stroke:#0f766e,color:#134e4a,stroke-width:1.5px
classDef runtime fill:#f5f5f4,stroke:#78716c,color:#292524,stroke-width:1.5px
classDef state fill:#f1f5f9,stroke:#64748b,color:#0f172a,stroke-width:1.5px
classDef bus fill:#fef9c3,stroke:#ca8a04,color:#713f12,stroke-width:1.5px
classDef report fill:#dcfce7,stroke:#16a34a,color:#14532d,stroke-width:1.5px
classDef trust fill:#cffafe,stroke:#0891b2,color:#164e63,stroke-width:1.5px
classDef await fill:#e0f2fe,stroke:#0284c7,color:#0c4a6e,stroke-width:1.5px
classDef done fill:#dcfce7,stroke:#16a34a,color:#14532d,stroke-width:1.5px
```
