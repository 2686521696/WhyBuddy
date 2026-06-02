# WhyBuddy Architecture Subgraphs

## 01. 用户入口与项目驾驶舱图

```mermaid
%%{init: {'theme':'base','flowchart': {'curve': 'basis', 'htmlLabels': true}, 'themeVariables': {
  'background':'transparent',
  'primaryColor':'#ffffff',
  'primaryTextColor':'#111827',
  'primaryBorderColor':'#e5e7eb',
  'secondaryColor':'#ffffff',
  'tertiaryColor':'#ffffff',
  'lineColor':'#d1d5db',
  'defaultLinkColor':'#d1d5db',
  'clusterBkg':'transparent',
  'clusterBorder':'#d1d5db',
  'mainBkg':'#ffffff',
  'nodeBorder':'#e5e7eb',
  'fontSize':'16px',
  'fontFamily':'Arial, PingFang SC, Microsoft YaHei, sans-serif'
}} }%%
flowchart LR
    U[User / Operator<br/>用户 / 操作者] --> HOME[Office / Project Cockpit<br/>首页 / 任务中心 / 项目驾驶舱]
    U --> COMPOSER[Project Scoped Composer<br/>项目级输入框 / 指令面板]
    U --> LAUNCH[Launch Panel<br/>Goal / Destination 输入]
    U --> MARKET_UI[Agent Marketplace UI<br/>浏览 / 购买 / 集成 Agent]
    FEI[Feishu User<br/>飞书用户] --> FEISHU[Feishu Bridge<br/>飞书入口 / 线程同步]
    ADMIN[Admin<br/>管理员] --> ADMIN_CONSOLE[Admin Console<br/>全局角色门禁 / 审计支持]
    subgraph HUB[驾驶舱中枢]
      PROJECT_CTX[Project Context Hub<br/>当前项目上下文]
      TASK_CENTER[Task Center<br/>任务中心 / Job 列表]
      WORKSPACE[Workspace Router<br/>工作区路由]
    end
    HOME --> PROJECT_CTX
    HOME --> TASK_CENTER
    HOME --> WORKSPACE
    COMPOSER --> PROJECT_CTX
    LAUNCH --> PROJECT_CTX
    PROJECT_CTX --> DEST[Destination Model<br/>目标建模入口]
    MARKET_UI --> MARKET[Marketplace Platform<br/>Agent 市场平台]
    FEISHU --> SYNC[Thread / Message Sync<br/>线程消息同步]
    ADMIN_CONSOLE --> AUDIT[Audit & Support Ops<br/>审计 / 支持运营]
    DEST --> WORKSPACE
    MARKET --> WORKSPACE
    SYNC --> HOME
    AUDIT --> HOME
    WORKSPACE --> NEXT[Autopilot / Blueprint / Workbench<br/>后续系统功能]
```

## 02. 目标澄清与路线规划图

```mermaid
%%{init: {'theme':'base','flowchart': {'curve': 'basis', 'htmlLabels': true}, 'themeVariables': {
  'background':'transparent',
  'primaryColor':'#ffffff',
  'primaryTextColor':'#111827',
  'primaryBorderColor':'#e5e7eb',
  'secondaryColor':'#ffffff',
  'tertiaryColor':'#ffffff',
  'lineColor':'#d1d5db',
  'defaultLinkColor':'#d1d5db',
  'clusterBkg':'transparent',
  'clusterBorder':'#d1d5db',
  'mainBkg':'#ffffff',
  'nodeBorder':'#e5e7eb',
  'fontSize':'16px',
  'fontFamily':'Arial, PingFang SC, Microsoft YaHei, sans-serif'
}} }%%
flowchart LR
    COMPOSER[Project Scoped Composer<br/>项目级输入] --> DEST[Destination Model<br/>目标模型与解析器]
    LAUNCH[Launch Panel<br/>Goal / Destination 输入] --> DEST
    DEST --> CLARIFY[Clarification Workflow<br/>结构化澄清]
    CLARIFY --> GOAL_LOCK[Destination Card & Goal Lock<br/>目标锁定 / 准备度信号]
    GOAL_LOCK --> ROUTE_MODEL[Route Planner & Route Model<br/>路线模型]
    ROUTE_MODEL --> ROUTE_REC[Route Recommendation<br/>多路线推荐与选择]
    ROUTE_REC --> ROUTE_SET[RouteSet<br/>主路径 + 备选路径]
    ROUTE_SET --> REPLAN[Drive State Timeline & Replan<br/>驾驶状态 / 重规划]
    REPLAN --> TAKEOVER[Takeover Control Panel<br/>人工接管 / 决策点]
    TAKEOVER -.人工介入 / 修正.-> ROUTE_MODEL
    GOAL_LOCK -.准备度不足.-> CLARIFY
    ROUTE_SET --> AP[Autopilot Blueprint<br/>进入蓝图主流程]
```

## 03. Autopilot Blueprint 主流程图

```mermaid
%%{init: {'theme':'base','flowchart': {'curve': 'basis', 'htmlLabels': true}, 'themeVariables': {
  'background':'transparent',
  'primaryColor':'#ffffff',
  'primaryTextColor':'#111827',
  'primaryBorderColor':'#e5e7eb',
  'secondaryColor':'#ffffff',
  'tertiaryColor':'#ffffff',
  'lineColor':'#d1d5db',
  'defaultLinkColor':'#d1d5db',
  'clusterBkg':'transparent',
  'clusterBorder':'#d1d5db',
  'mainBkg':'#ffffff',
  'nodeBorder':'#e5e7eb',
  'fontSize':'16px',
  'fontFamily':'Arial, PingFang SC, Microsoft YaHei, sans-serif'
}} }%%
flowchart LR
    ROUTE_SET[RouteSet<br/>主路径 + 备选路径] --> AP_MASTER[Project Autopilot Blueprint Master<br/>输入→澄清→沙盒推导→RouteSet→SPEC Tree→3D→交付]
    AP_MASTER --> GEN_API[Blueprint Generation API & Job Contract<br/>异步 Job / 状态 / 事件契约]
    GEN_API --> JOB[BlueprintGenerationJob<br/>pending / running / waiting / completed / failed]
    JOB --> STAGE[Autopilot Stage Driver<br/>阶段状态协调]
    STAGE --> SPEC_TREE[SPEC Tree Workbench<br/>规格树资产]
    STAGE --> SPEC_DOC[Spec Document Generator<br/>需求 / 设计 / 任务文档]
    STAGE --> PROMPT_PACK[Implementation Prompt Packager<br/>工程提示词包]
    STAGE --> EFFECT_PREVIEW[Effect Preview Generator<br/>效果预演]
    STAGE --> HANDOFF[Engineering Landing Bridge<br/>工程落地交接]
    SPEC_TREE --> AP_OUT[Autopilot Stage Output<br/>路线 / SPEC / 文档 / 预演 / Prompt / 工程交付]
    SPEC_DOC --> AP_OUT
    PROMPT_PACK --> AP_OUT
    EFFECT_PREVIEW --> AP_OUT
    HANDOFF --> AP_OUT
    AP_OUT --> COCKPIT[Autopilot Cockpit / Workbench<br/>前端工作台]
```

## 04. Runtime / Mission / Workflow 编排图

```mermaid
%%{init: {'theme':'base','flowchart': {'curve': 'basis', 'htmlLabels': true}, 'themeVariables': {
  'background':'transparent',
  'primaryColor':'#ffffff',
  'primaryTextColor':'#111827',
  'primaryBorderColor':'#e5e7eb',
  'secondaryColor':'#ffffff',
  'tertiaryColor':'#ffffff',
  'lineColor':'#d1d5db',
  'defaultLinkColor':'#d1d5db',
  'clusterBkg':'transparent',
  'clusterBorder':'#d1d5db',
  'mainBkg':'#ffffff',
  'nodeBorder':'#e5e7eb',
  'fontSize':'16px',
  'fontFamily':'Arial, PingFang SC, Microsoft YaHei, sans-serif'
}} }%%
flowchart LR
    AP_MASTER[Autopilot Blueprint] --> RUNTIME_ORCH[Autopilot Runtime Orchestration<br/>Destination / Route / Fleet / Takeover 投影]
    RUNTIME_ORCH --> MISSION_MAP[Mission Model → Autopilot Model Mapping<br/>Mission 与 Autopilot 映射]
    MISSION_MAP --> MISSION_RT[Mission Runtime<br/>receive → understand → plan → provision → execute → finalize]
    RUNTIME_ORCH --> WORKFLOW_ENGINE[Workflow Engine<br/>十阶段管道]
    ROUTE_SET[RouteSet] --> WORKFLOW_ENGINE
    WORKFLOW_ENGINE --> WEB_AIGC_RT[Web-AIGC Runtime Engine<br/>图节点调度 / waiting input / retry / escalate]
    WEB_AIGC_RT --> INSTANCE[Session / Workflow Instance<br/>运行实例]
    INSTANCE --> WAIT_RESUME[Wait / Resume / Approval<br/>暂停、人工输入、恢复]
    INSTANCE --> RETRY_ESC[Retry / Escalate Governance<br/>重试、升级、终止]
    TAKEOVER[Takeover Control Panel] --> WAIT_RESUME
    RETRY_ESC -.失败 / 升级.-> TAKEOVER
    MISSION_RT --> EXEC[Executor Integration<br/>执行器]
    WORKFLOW_ENGINE --> EXEC
```

## 05. 多 Agent 协作总图

```mermaid
%%{init: {'theme':'base','flowchart': {'curve': 'basis', 'htmlLabels': true}, 'themeVariables': {
  'background':'transparent',
  'primaryColor':'#ffffff',
  'primaryTextColor':'#111827',
  'primaryBorderColor':'#e5e7eb',
  'secondaryColor':'#ffffff',
  'tertiaryColor':'#ffffff',
  'lineColor':'#d1d5db',
  'defaultLinkColor':'#d1d5db',
  'clusterBkg':'transparent',
  'clusterBorder':'#d1d5db',
  'mainBkg':'#ffffff',
  'nodeBorder':'#e5e7eb',
  'fontSize':'16px',
  'fontFamily':'Arial, PingFang SC, Microsoft YaHei, sans-serif'
}} }%%
flowchart LR
    STAGE[Autopilot Stage Driver<br/>阶段状态协调] --> DG{Decision Gate<br/>是否头脑风暴}
    DG -->|brainstorm=false| ROLE_AGENT[Autopilot Role Autonomous Agent<br/>角色自主执行]
    DG -->|brainstorm=true| BRAINSTORM[Multi-Agent Brainstorm<br/>Decision Gate + Orchestrator + Crew Members]
    subgraph ROLES[Role Registry / Crew]
      DECIDER[Decider<br/>决策者]
      PLANNER[Planner<br/>规划师]
      ARCH[Architect<br/>架构师]
      EXEC[Executor<br/>执行者]
      AUD[Auditor<br/>审计员]
      UIP[UI Previewer<br/>UI 预览师]
    end
    BRAINSTORM --> COLLAB[Collaboration Mode<br/>discussion / vote / division / audit]
    BRAINSTORM --> ROLES
    ROLE_AGENT --> SYNTH[Synthesizer<br/>多角色结果综合]
    ROLES --> SYNTH
    COLLAB --> SYNTH
    SYNTH --> STAGE_OUT[Stage Output<br/>阶段输出]
    STAGE_OUT --> EVENTS[EventBus / Store / Replay<br/>下游链路]
```

## 06. 多 Agent Brainstorm 细节图

```mermaid
%%{init: {'theme':'base','flowchart': {'curve': 'basis', 'htmlLabels': true}, 'themeVariables': {
  'background':'transparent',
  'primaryColor':'#ffffff',
  'primaryTextColor':'#111827',
  'primaryBorderColor':'#e5e7eb',
  'secondaryColor':'#ffffff',
  'tertiaryColor':'#ffffff',
  'lineColor':'#d1d5db',
  'defaultLinkColor':'#d1d5db',
  'clusterBkg':'transparent',
  'clusterBorder':'#d1d5db',
  'mainBkg':'#ffffff',
  'nodeBorder':'#e5e7eb',
  'fontSize':'16px',
  'fontFamily':'Arial, PingFang SC, Microsoft YaHei, sans-serif'
}} }%%
flowchart LR
    U[用户输入产品需求 / 产品目标] --> AP[Autopilot Pipeline<br/>任务编排流程]
    AP --> SC[Stage Context<br/>当前阶段上下文]
    SC --> DG{Decision Gate<br/>LLM 自主决策}
    DG -->|不需要头脑风暴| SA[Single Agent Linear Path<br/>单路单 Agent 执行]
    DG -->|需要头脑风暴| BO[Brainstorm Orchestrator<br/>多智能体协作调度器]
    BO --> MODE[Collaboration Mode<br/>discussion / vote / division / audit]
    BO --> RR[Role Registry<br/>角色注册表]
    MODE --> BS[Brainstorm Session<br/>多分支推理会话]
    RR --> D[Decider]
    RR --> P[Planner]
    RR --> A[Architect]
    RR --> E[Executor]
    RR --> AU[Auditor]
    RR --> UI[UI Previewer]
    BS --> D
    BS --> P
    BS --> A
    BS --> E
    BS --> AU
    BS --> UI
    D --> TP[Tool Proxy<br/>统一工具代理]
    P --> TP
    A --> TP
    E --> TP
    AU --> TP
    UI --> TP
    TP --> DOCKER[Docker Sandbox]
    TP --> MCP[MCP Tools]
    TP --> GH[GitHub API]
    TP --> SK[Registered Skills]
    D --> SYN[Synthesizer<br/>协作结果综合]
    P --> SYN
    A --> SYN
    E --> SYN
    AU --> SYN
    UI --> SYN
    SYN --> RESULT[Final Stage Output<br/>决策 / 方案 / 信心分 / 分歧意见]
    RESULT --> SA_OUT[阶段输出]
    BO -->|brainstorm.* events| EB[BlueprintEventBus<br/>统一运行时事件总线]
    TP -->|tool.completed / tool.failed| EB
    SYN -->|session.completed| EB
    EB --> SOCKET[Socket.IO Relay<br/>实时推送 Job Room]
    SOCKET --> STORE[BlueprintRealtimeStore<br/>brainstormGraph Slice]
    STORE --> NODES[Branch Nodes<br/>推理节点]
    STORE --> EDGES[Branch Edges<br/>父子关系]
    STORE --> META[Session Metadata<br/>角色 / Token / 状态]
    NODES --> WG[Brainstorm Wall Graph<br/>dagre + Canvas2D]
    EDGES --> WG
    META --> WG
    WG --> TEX[Three.js CanvasTexture<br/>3D 墙面纹理]
    TEX --> WALL[3D Wall Mind Map<br/>实时多分支推理树]
    BO --> MS[Artifact Memory Store<br/>会话持久化]
    RESULT --> MS
    MS --> REPLAY[Replay API<br/>GET /api/blueprint/jobs/:id/brainstorm/:sessionId]
    REPLAY --> STORE
    DG -.失败 / 超时.-> DEG[Graceful Degradation<br/>降级事件]
    BO -.LLM / Docker / Token 异常.-> DEG
    TP -.工具不可达.-> DEG
    DEG -.fallback.-> SA
    DEG --> EB
```

## 07. 角色系统与动态组织图

```mermaid
%%{init: {'theme':'base','flowchart': {'curve': 'basis', 'htmlLabels': true}, 'themeVariables': {
  'background':'transparent',
  'primaryColor':'#ffffff',
  'primaryTextColor':'#111827',
  'primaryBorderColor':'#e5e7eb',
  'secondaryColor':'#ffffff',
  'tertiaryColor':'#ffffff',
  'lineColor':'#d1d5db',
  'defaultLinkColor':'#d1d5db',
  'clusterBkg':'transparent',
  'clusterBorder':'#d1d5db',
  'mainBkg':'#ffffff',
  'nodeBorder':'#e5e7eb',
  'fontSize':'16px',
  'fontFamily':'Arial, PingFang SC, Microsoft YaHei, sans-serif'
}} }%%
flowchart LR
    WORKFLOW[Workflow Engine<br/>工作流引擎] --> DYN_ORG[Dynamic Organization<br/>CEO / Manager / Worker 动态组织]
    DYN_ORG --> ROLE_SYS[Dynamic Role System<br/>角色模型 / 角色编组]
    ROLE_SYS --> ROLE_CONTAINER[Autopilot Role Container Loader<br/>角色容器加载]
    ROLE_CONTAINER --> ROLE_AGENT[Autopilot Role Autonomous Agent<br/>角色自主执行]
    AP_MASTER[Autopilot Blueprint] --> CREW_FABRIC[Blueprint Agent Crew Fabric<br/>角色团队织网]
    CREW_FABRIC --> STAGE_ACT[Agent Crew Stage Activation<br/>阶段激活]
    STAGE_ACT --> ROLE_AGENT
    ROLE_SYS --> DECIDER[Decider]
    ROLE_SYS --> PLANNER[Planner]
    ROLE_SYS --> ARCH[Architect]
    ROLE_SYS --> EXEC[Executor]
    ROLE_SYS --> AUD[Auditor]
    ROLE_SYS --> UIP[UI Previewer]
    A2A[A2A Protocol<br/>Cube Agent ↔ CrewAI / LangGraph / Claude] --> ROLE_AGENT
    A2A --> SWARM[Autonomous Swarm<br/>群体协作]
    SWARM --> CREW_FABRIC
    ROLE_AGENT --> OUTPUT[Stage Result / Agent Output<br/>阶段结果]
```

## 08. 工具代理与能力桥图

```mermaid
%%{init: {'theme':'base','flowchart': {'curve': 'basis', 'htmlLabels': true}, 'themeVariables': {
  'background':'transparent',
  'primaryColor':'#ffffff',
  'primaryTextColor':'#111827',
  'primaryBorderColor':'#e5e7eb',
  'secondaryColor':'#ffffff',
  'tertiaryColor':'#ffffff',
  'lineColor':'#d1d5db',
  'defaultLinkColor':'#d1d5db',
  'clusterBkg':'transparent',
  'clusterBorder':'#d1d5db',
  'mainBkg':'#ffffff',
  'nodeBorder':'#e5e7eb',
  'fontSize':'16px',
  'fontFamily':'Arial, PingFang SC, Microsoft YaHei, sans-serif'
}} }%%
flowchart LR
    ROLE_AGENT[Role Agent / Crew Member] --> TOOL_PROXY[Tool Proxy<br/>Docker / MCP / GitHub / Skills 统一代理]
    BRAINSTORM[Multi-Agent Brainstorm] --> TOOL_PROXY
    TOOL_PROXY --> CAP_BRIDGE[Blueprint Runtime Capability Bridge<br/>统一能力注册 / 调度 / 证据]
    CAP_BRIDGE --> DOCKER[Docker Capability Bridge<br/>沙盒命令 / 仓库分析 / 渲染 / 测试]
    CAP_BRIDGE --> MCP[MCP Capability Bridge<br/>外部工具调用]
    CAP_BRIDGE --> GH[GitHub Ingestion / GitHub API<br/>仓库读取 / 分析 / 提交上下文]
    CAP_BRIDGE --> SKILL[Plugin / Skill System<br/>注册技能与节点]
    CAP_BRIDGE --> NODE_POOL[Web-AIGC Node Pool<br/>LLM / OCR / Search / Vector / File / Flow Nodes]
    DOCKER --> SECURE_SANDBOX[Secure Sandbox<br/>容器级隔离]
    SECURE_SANDBOX --> PREVIEW[Sandbox Live Preview<br/>浏览器预览 / Docker Live Workstation]
    PREVIEW --> EFFECT[Effect Preview Generator<br/>效果预演]
    WORKFLOW[Workflow Engine] --> EXEC[Executor Integration<br/>远端执行器 / 本地执行器]
    MISSION[Mission Runtime] --> EXEC
    EXEC --> K8S[K8s Agent Operator<br/>集群部署与调度]
    GH --> SPEC_TREE[SPEC Tree Workbench]
    GH --> SPEC_DOC[Spec Document Generator]
```

## 09. Web-AIGC 节点池图

```mermaid
%%{init: {'theme':'base','flowchart': {'curve': 'basis', 'htmlLabels': true}, 'themeVariables': {
  'background':'transparent',
  'primaryColor':'#ffffff',
  'primaryTextColor':'#111827',
  'primaryBorderColor':'#e5e7eb',
  'secondaryColor':'#ffffff',
  'tertiaryColor':'#ffffff',
  'lineColor':'#d1d5db',
  'defaultLinkColor':'#d1d5db',
  'clusterBkg':'transparent',
  'clusterBorder':'#d1d5db',
  'mainBkg':'#ffffff',
  'nodeBorder':'#e5e7eb',
  'fontSize':'16px',
  'fontFamily':'Arial, PingFang SC, Microsoft YaHei, sans-serif'
}} }%%
flowchart TB
    NODE_POOL[Web-AIGC Node Pool<br/>节点池总入口]
    NODE_POOL --> START[start / end]
    NODE_POOL --> LLM[llm / auto_agent / robot_reply]
    NODE_POOL --> INTENT[intent_recognition / orchestration_recognition_jump]
    NODE_POOL --> PARAM[param_collection / user_input / selection / confirm_judge]
    NODE_POOL --> FLOW[condition / loop / flow_jump / variable_assignment]
    NODE_POOL --> SEARCH[web_search / image_search / document_search / qa_search / graph_search / fragment_search]
    NODE_POOL --> VECTOR[vector_insert / vector_query / vector_update / vector_delete]
    NODE_POOL --> FILE[excel_read / file_generation / file_slicing / file_translation / long_text_extraction]
    NODE_POOL --> MEDIA[ocr_recognition / audio_recognition / ai_ppt / dynamic_chart]
    NODE_POOL --> API[internal_api / passthrough_api / mcp / transaction_flow]
    NODE_POOL --> UI[open_page / open_dashboard / open_report / static_webpage_read / recommended_commands]
    NODE_POOL --> NOTIFY[message_notification / command_list / get_location_info / get_device_info]
    RT[Web-AIGC Runtime Engine<br/>图节点调度] --> NODE_POOL
```

## 10. 权限安全与成本治理图

```mermaid
%%{init: {'theme':'base','flowchart': {'curve': 'basis', 'htmlLabels': true}, 'themeVariables': {
  'background':'transparent',
  'primaryColor':'#ffffff',
  'primaryTextColor':'#111827',
  'primaryBorderColor':'#e5e7eb',
  'secondaryColor':'#ffffff',
  'tertiaryColor':'#ffffff',
  'lineColor':'#d1d5db',
  'defaultLinkColor':'#d1d5db',
  'clusterBkg':'transparent',
  'clusterBorder':'#d1d5db',
  'mainBkg':'#ffffff',
  'nodeBorder':'#e5e7eb',
  'fontSize':'16px',
  'fontFamily':'Arial, PingFang SC, Microsoft YaHei, sans-serif'
}} }%%
flowchart LR
    ROLE_AGENT[Role Agent / Crew Member] --> PERMISSION[Agent Permission Model<br/>Agent-Resource-Action 权限矩阵]
    WEB_AIGC_RT[Web-AIGC Runtime Engine] --> PERMISSION
    PERMISSION --> CAP_TOKEN[CapabilityToken<br/>运行时权限令牌]
    CAP_TOKEN --> SECURE_SANDBOX[Secure Sandbox<br/>容器级隔离]
    BRAINSTORM[Multi-Agent Brainstorm] --> COST_GOV[Cost Governance<br/>成本预算 / Token 预算]
    COST_GOV --> COST_OBS[Cost Observability<br/>费用观测]
    PERMISSION --> AUDIT_CHAIN[Audit Chain<br/>审计链]
    SUPPORT[Admin Audit & Support Ops<br/>管理后台审计与支持] --> AUDIT_CHAIN
    TENANT[Multi-Tenant Architecture<br/>租户隔离] --> PROJECT_ISO[Personal Project Ownership<br/>项目所有权 / 数据隔离]
    PROJECT_ISO --> API[Blueprint Generation API]
    TENANT --> MARKET_UI[Agent Marketplace UI]
    COST_OBS --> ALERT[Budget Alert<br/>预算预警]
    ALERT -.预算约束.-> DG[Decision Gate]
```

## 11. 数据记忆与证据回放图

```mermaid
%%{init: {'theme':'base','flowchart': {'curve': 'basis', 'htmlLabels': true}, 'themeVariables': {
  'background':'transparent',
  'primaryColor':'#ffffff',
  'primaryTextColor':'#111827',
  'primaryBorderColor':'#e5e7eb',
  'secondaryColor':'#ffffff',
  'tertiaryColor':'#ffffff',
  'lineColor':'#d1d5db',
  'defaultLinkColor':'#d1d5db',
  'clusterBkg':'transparent',
  'clusterBorder':'#d1d5db',
  'mainBkg':'#ffffff',
  'nodeBorder':'#e5e7eb',
  'fontSize':'16px',
  'fontFamily':'Arial, PingFang SC, Microsoft YaHei, sans-serif'
}} }%%
flowchart LR
    GEN_API[Blueprint Generation API] --> DOMAIN[Blueprint Domain & Asset Store<br/>项目域模型 / 资产索引]
    JOB[Blueprint Job] --> ARTIFACT[Blueprint Artifact Memory & Replay<br/>产物记忆 / 时间线 / Provenance Graph]
    SPEC_TREE[SPEC Tree] --> ARTIFACT
    SPEC_DOC[Spec Document] --> ARTIFACT
    PROMPT_PACK[Prompt Pack] --> ARTIFACT
    EFFECT[Effect Preview] --> ARTIFACT
    BRAINSTORM[Multi-Agent Brainstorm] --> ARTIFACT
    MEMORY[Memory System<br/>短期 / 中期 / 长期记忆] --> VECTOR[Vector DB RAG Pipeline<br/>Ingestion → Chunk → Embedding → VectorStore → Retriever]
    VECTOR --> KG[Knowledge Graph<br/>结构化依赖与实体关系]
    ARTIFACT --> LINEAGE[Data Lineage Tracking<br/>来源 / 派生 / 版本]
    LINEAGE --> EVIDENCE[Evidence Artifact Replay & Trust Chain<br/>证据链 / 驾驶记录仪]
    ARTIFACT --> REPLAY[Replay & Debug Surface<br/>回放调试台]
    EVIDENCE --> REPLAY
    COLLAB[Collaboration Replay<br/>协作过程回放] --> REPLAY
    STATE[State Persistence Recovery<br/>状态持久化与恢复] --> JOB
    STATE --> INSTANCE[Workflow Instance]
    REPLAY -.经验回填.-> MEMORY
```

## 12. 事件总线与前端实时 Store 图

```mermaid
%%{init: {'theme':'base','flowchart': {'curve': 'basis', 'htmlLabels': true}, 'themeVariables': {
  'background':'transparent',
  'primaryColor':'#ffffff',
  'primaryTextColor':'#111827',
  'primaryBorderColor':'#e5e7eb',
  'secondaryColor':'#ffffff',
  'tertiaryColor':'#ffffff',
  'lineColor':'#d1d5db',
  'defaultLinkColor':'#d1d5db',
  'clusterBkg':'transparent',
  'clusterBorder':'#d1d5db',
  'mainBkg':'#ffffff',
  'nodeBorder':'#e5e7eb',
  'fontSize':'16px',
  'fontFamily':'Arial, PingFang SC, Microsoft YaHei, sans-serif'
}} }%%
flowchart LR
    STAGE[Autopilot Stage Driver] --> EVENT_BUS[BlueprintEventBus / RuntimeEventStream<br/>统一运行时事件流]
    BRAINSTORM[Multi-Agent Brainstorm] -->|brainstorm.*| EVENT_BUS
    CAP_BRIDGE[Capability Bridge] -->|capability.*| EVENT_BUS
    MISSION_RT[Mission Runtime] -->|mission_event| EVENT_BUS
    WORKFLOW[Workflow Engine] -->|stage_change / message| EVENT_BUS
    ROLE_AGENT[Role Agent] --> MSG_BUS[MessageBus<br/>Agent 间消息总线]
    MSG_BUS --> EVENT_BUS
    EVENT_BUS --> SOCKET[Socket.IO Relay<br/>job room / mission_event / stage_change]
    SOCKET --> FRONT_STORE[BlueprintRealtimeStore<br/>蓝图实时 Store]
    SOCKET --> AUTO_VM[Autopilot Frontend View Model<br/>destinationDraft / routePlan / selectedRoute / driveState / fleet / takeoverQueue / evidenceTimeline]
    SOCKET --> TASK_STORE[Tasks Store / Mission Store<br/>任务状态 / 六阶段状态]
    SOCKET --> TELEMETRY[Telemetry Store<br/>LLM / Token / Cost / Duration]
    FRONT_STORE --> BRAIN_GRAPH[brainstormGraph Slice<br/>BranchNodes + BranchEdges + Session Metadata]
    BRAIN_GRAPH --> ARTIFACT[Artifact Memory Store]
```

## 13. 前端工作台信息架构图

```mermaid
%%{init: {'theme':'base','flowchart': {'curve': 'basis', 'htmlLabels': true}, 'themeVariables': {
  'background':'transparent',
  'primaryColor':'#ffffff',
  'primaryTextColor':'#111827',
  'primaryBorderColor':'#e5e7eb',
  'secondaryColor':'#ffffff',
  'tertiaryColor':'#ffffff',
  'lineColor':'#d1d5db',
  'defaultLinkColor':'#d1d5db',
  'clusterBkg':'transparent',
  'clusterBorder':'#d1d5db',
  'mainBkg':'#ffffff',
  'nodeBorder':'#e5e7eb',
  'fontSize':'16px',
  'fontFamily':'Arial, PingFang SC, Microsoft YaHei, sans-serif'
}} }%%
flowchart LR
    FRONT_STORE[BlueprintRealtimeStore] --> COCKPIT[Autopilot Cockpit<br/>三列布局 / 工作台节奏]
    AUTO_VM[Autopilot Frontend View Model] --> COCKPIT
    COCKPIT --> RIGHT_RAIL[Right Rail Stage Panels<br/>阶段卡片 / Narrative Swiper / Data Hook]
    COCKPIT --> WORKBENCH[Advanced Workbench Inline<br/>规格树 / 文档 / 预演 / Prompt 包]
    WORKBENCH --> DOC_RENDERER[Streaming Doc Renderer<br/>流式文档渲染]
    WORKBENCH --> MERMAID_RENDER[Mermaid Diagram Rendering<br/>架构图 / 流程图渲染]
    WORKBENCH --> SPEC_EXPORT[Spec Document Export<br/>导出规格文档]
    COCKPIT --> STAGE_PROGRESS[Stage Progress Indicator<br/>阶段进度]
    STAGE_PROGRESS --> VERSION_HISTORY[Stage Version History<br/>阶段版本历史]
    TAKEOVER[Takeover Control Panel] --> HUMAN[Human-in-the-loop Surface<br/>人工接管界面]
    HUMAN --> WAIT[Wait / Resume / Approval]
```

## 14. 3D 场景与墙面渲染图

```mermaid
%%{init: {'theme':'base','flowchart': {'curve': 'basis', 'htmlLabels': true}, 'themeVariables': {
  'background':'transparent',
  'primaryColor':'#ffffff',
  'primaryTextColor':'#111827',
  'primaryBorderColor':'#e5e7eb',
  'secondaryColor':'#ffffff',
  'tertiaryColor':'#ffffff',
  'lineColor':'#d1d5db',
  'defaultLinkColor':'#d1d5db',
  'clusterBkg':'transparent',
  'clusterBorder':'#d1d5db',
  'mainBkg':'#ffffff',
  'nodeBorder':'#e5e7eb',
  'fontSize':'16px',
  'fontFamily':'Arial, PingFang SC, Microsoft YaHei, sans-serif'
}} }%%
flowchart LR
    FRONT_STORE[BlueprintRealtimeStore] --> SCENE_FUSION[Autopilot Scene Fusion<br/>3D 场景与蓝图信号融合]
    TASK_STORE[Tasks Store / Mission Store] --> SCENE_FUSION
    BRAIN_GRAPH[brainstormGraph Slice] --> BRAIN_WALL[Brainstorm Wall Graph<br/>dagre + Canvas2D 思维导图]
    SCENE_FUSION --> PET[PetWorkers<br/>角色工作状态]
    SCENE_FUSION --> ISLAND[MissionIsland<br/>任务岛 / 当前 Job]
    SCENE_FUSION --> STAGE_FLOW[SceneStageFlow<br/>阶段流]
    SCENE_FUSION --> WALL_HUD[Blueprint Wall Process Graph HUD<br/>墙面流程图 HUD]
    WALL_HUD --> CANVAS[Three.js CanvasTexture<br/>贴到 3D 墙面大屏]
    BRAIN_WALL --> CANVAS
    CANVAS --> HOLO[Holographic UI<br/>全息 UI]
    HOLO --> HOME[Office / Project Cockpit]
    FRONT_STORE --> UE_SYNC[UE State Sync Bridge<br/>前端 ↔ UE 双向状态同步]
    UE_SYNC --> UE_LOCAL[UE Local Streaming Runtime<br/>本地 UE5 + Pixel Streaming]
    UE_CMD[UE Scene Command Protocol<br/>镜头 / 角色 / 场景命令] --> UE_LOCAL
    UE_LOCAL --> UE_RECORD[UE Recording & Replay Export<br/>录制与回放导出]
    UE_RECORD --> REPLAY[Replay & Debug Surface]
```

## 15. Marketplace / 生态 / 发布观测图

```mermaid
%%{init: {'theme':'base','flowchart': {'curve': 'basis', 'htmlLabels': true}, 'themeVariables': {
  'background':'transparent',
  'primaryColor':'#ffffff',
  'primaryTextColor':'#111827',
  'primaryBorderColor':'#e5e7eb',
  'secondaryColor':'#ffffff',
  'tertiaryColor':'#ffffff',
  'lineColor':'#d1d5db',
  'defaultLinkColor':'#d1d5db',
  'clusterBkg':'transparent',
  'clusterBorder':'#d1d5db',
  'mainBkg':'#ffffff',
  'nodeBorder':'#e5e7eb',
  'fontSize':'16px',
  'fontFamily':'Arial, PingFang SC, Microsoft YaHei, sans-serif'
}} }%%
flowchart LR
    MARKET_UI[Agent Marketplace UI] --> MARKET[Agent Marketplace Platform<br/>发布 / 购买 / 订阅 / 集成]
    MARKET --> PACKAGE[Agent Package<br/>源码 / 元数据 / 依赖 / 文档]
    PACKAGE --> SEC_AUDIT[Marketplace Security Audit<br/>安全审核]
    SEC_AUDIT --> LICENSE[License / Purchase / Revenue<br/>许可证 / 购买 / 收益]
    LICENSE --> REP[Agent Reputation<br/>评分 / 可用性 / 评价]
    PACKAGE --> DEP[Dependency Graph<br/>Agent / MCP / Model 依赖]
    MARKET --> HEALTH[Agent Health Check<br/>可用性 / 性能 / 错误率]
    MARKET --> ROLE_SYS[Dynamic Role System]
    DEP --> MCP[MCP Capability Bridge]
    CROSS[Cross Framework Export<br/>跨框架导出] --> A2A[A2A Protocol<br/>Cube Agent ↔ CrewAI / LangGraph / Claude]
    A2A --> MARKET
    TELEMETRY[Telemetry Store] --> DASH[Telemetry Dashboard<br/>LLM 次数 / Token / 费用 / Agent 瓶颈 / Mission 耗时]
    WEB_AIGC_RT[Web-AIGC Runtime Engine] --> OBS[Web-AIGC Observability & Audit<br/>运行时审计]
    EVENT_BUS[BlueprintEventBus] --> OBS
    DASH --> COST_ALERT[Budget Alert<br/>预算预警]
    PERF[Performance & Stability<br/>性能稳定性] --> RELEASE[Release Stability Guardrails<br/>发布稳定性护栏]
    RELEASE --> PROD[Production Deployment<br/>生产部署]
    PROD --> DR[Multi-Region Disaster Recovery<br/>多区域灾备]
    UE_LOCAL[UE Local Streaming Runtime] --> QUALITY[UE Performance Profiling / Quality Tier<br/>画质等级 / 性能剖析]
    QUALITY --> PERF
```

