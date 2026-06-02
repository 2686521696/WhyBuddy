```mermaid
flowchart LR
  %% WhyBuddy / Cube 全规格关联关系大图
  %% Source: specs.zip, grouped from 295 spec folders

  %% =========================
  %% 0. 用户入口 / 产品外壳
  %% =========================
  subgraph L0["用户入口 / 产品外壳"]
    U["User / Operator<br/>自然语言目标、GitHub 地址、文件、截图"]
    HOME["Office / Project Cockpit<br/>首页、任务中心、项目驾驶舱"]
    COMPOSER["Project Scoped Composer<br/>项目级输入框 / 指令面板"]
    LAUNCH["Launch Panel<br/>Goal / Destination 输入"]
    ADMIN["Admin Console<br/>全局角色门禁 / 审计支持"]
    MARKET_UI["Agent Marketplace UI<br/>浏览、购买、集成 Agent"]
    FEISHU["Feishu Bridge<br/>飞书入口 / 线程同步"]
  end

  U --> HOME
  U --> COMPOSER
  U --> LAUNCH
  U --> MARKET_UI
  U --> FEISHU
  ADMIN --> HOME

  %% =========================
  %% 1. 目标建模 / 澄清 / 路线
  %% =========================
  subgraph L1["目标建模 / 澄清 / 路线规划层"]
    DEST["Destination Model<br/>目标模型与解析器"]
    CLARIFY["Clarification Workflow<br/>结构化澄清"]
    GOAL_LOCK["Destination Card & Goal Lock<br/>目标锁定 / 准备度信号"]
    ROUTE_MODEL["Route Planner & Route Model<br/>路线模型"]
    ROUTE_REC["Route Recommendation<br/>多路线推荐与选择"]
    ROUTE_SET["RouteSet<br/>主路径 + 备选路径"]
    REPLAN["Drive State Timeline & Replan<br/>驾驶状态 / 重规划"]
    TAKEOVER["Takeover Control Panel<br/>人工接管 / 决策点"]
  end

  COMPOSER --> DEST
  LAUNCH --> DEST
  DEST --> CLARIFY
  CLARIFY --> GOAL_LOCK
  GOAL_LOCK --> ROUTE_MODEL
  ROUTE_MODEL --> ROUTE_REC
  ROUTE_REC --> ROUTE_SET
  ROUTE_SET --> REPLAN
  REPLAN --> TAKEOVER
  TAKEOVER --> ROUTE_MODEL

  %% =========================
  %% 2. Autopilot 蓝图主链路
  %% =========================
  subgraph L2["Autopilot Blueprint 主链路"]
    AP_MASTER["Project Autopilot Blueprint Master<br/>输入→澄清→沙盒推导→RouteSet→SPEC Tree→3D→交付"]
    GEN_API["Blueprint Generation API & Job Contract<br/>异步 Job / 状态 / 事件契约"]
    JOB["BlueprintGenerationJob<br/>pending / running / waiting / completed / failed"]
    STAGE["Autopilot Stage Driver<br/>阶段状态协调"]
    SPEC_TREE["SPEC Tree Workbench<br/>规格树资产"]
    SPEC_DOC["Spec Document Generator<br/>需求 / 设计 / 任务文档"]
    PROMPT_PACK["Implementation Prompt Packager<br/>工程提示词包"]
    EFFECT_PREVIEW["Effect Preview Generator<br/>效果预演"]
    HANDOFF["Engineering Landing Bridge<br/>工程落地交接"]
  end

  ROUTE_SET --> AP_MASTER
  AP_MASTER --> GEN_API
  GEN_API --> JOB
  JOB --> STAGE
  STAGE --> SPEC_TREE
  STAGE --> SPEC_DOC
  STAGE --> PROMPT_PACK
  STAGE --> EFFECT_PREVIEW
  STAGE --> HANDOFF
  HANDOFF --> COMPOSER

  %% =========================
  %% 3. Runtime 编排 / Mission / Workflow
  %% =========================
  subgraph L3["Runtime 编排 / Mission / Workflow 层"]
    RUNTIME_ORCH["Autopilot Runtime Orchestration<br/>Destination / Route / Fleet / Takeover 投影"]
    MISSION_MAP["Mission Model → Autopilot Model Mapping<br/>Mission 与 Autopilot 映射"]
    MISSION_RT["Mission Runtime<br/>receive → understand → plan → provision → execute → finalize"]
    WORKFLOW_ENGINE["Workflow Engine<br/>十阶段管道：方向→规划→执行→评审→元审计→修订→验证→汇总→反馈→进化"]
    WEB_AIGC_RT["Web-AIGC Runtime Engine<br/>图节点调度 / waiting input / retry / escalate"]
    INSTANCE["Session / Workflow Instance<br/>运行实例"]
    WAIT_RESUME["Wait / Resume / Approval<br/>暂停、人工输入、恢复"]
    RETRY_ESC["Retry / Escalate Governance<br/>重试、升级、终止"]
  end

  AP_MASTER --> RUNTIME_ORCH
  RUNTIME_ORCH --> MISSION_MAP
  MISSION_MAP --> MISSION_RT
  RUNTIME_ORCH --> WORKFLOW_ENGINE
  ROUTE_SET --> WORKFLOW_ENGINE
  WORKFLOW_ENGINE --> WEB_AIGC_RT
  WEB_AIGC_RT --> INSTANCE
  INSTANCE --> WAIT_RESUME
  INSTANCE --> RETRY_ESC
  TAKEOVER --> WAIT_RESUME
  RETRY_ESC --> TAKEOVER

  %% =========================
  %% 4. 多 Agent / 角色 / 协同
  %% =========================
  subgraph L4["多 Agent / 角色 / 协同层"]
    DYN_ORG["Dynamic Organization<br/>CEO / Manager / Worker 动态组织"]
    ROLE_SYS["Dynamic Role System<br/>角色模型 / 角色编组"]
    ROLE_CONTAINER["Autopilot Role Container Loader<br/>角色容器加载"]
    ROLE_AGENT["Autopilot Role Autonomous Agent<br/>角色自主执行"]
    CREW_FABRIC["Blueprint Agent Crew Fabric<br/>角色团队织网"]
    STAGE_ACT["Agent Crew Stage Activation<br/>阶段激活"]
    BRAINSTORM["Multi-Agent Brainstorm<br/>Decision Gate + Orchestrator + Crew Members"]
    DECISION_GATE["Decision Gate<br/>是否头脑风暴 / 模式 / 角色 / 工具"]
    COLLAB_MODE["Collaboration Mode<br/>discussion / vote / division / audit"]
    SYNTH["Synthesizer<br/>多角色结果综合"]
    A2A["A2A Protocol<br/>Cube Agent ↔ CrewAI / LangGraph / Claude"]
    SWARM["Autonomous Swarm<br/>群体协作"]
  end

  WORKFLOW_ENGINE --> DYN_ORG
  DYN_ORG --> ROLE_SYS
  ROLE_SYS --> ROLE_CONTAINER
  ROLE_CONTAINER --> ROLE_AGENT
  AP_MASTER --> CREW_FABRIC
  CREW_FABRIC --> STAGE_ACT
  STAGE --> DECISION_GATE
  DECISION_GATE -->|brainstorm=false| ROLE_AGENT
  DECISION_GATE -->|brainstorm=true| BRAINSTORM
  BRAINSTORM --> COLLAB_MODE
  COLLAB_MODE --> ROLE_AGENT
  ROLE_AGENT --> SYNTH
  BRAINSTORM --> SYNTH
  A2A --> ROLE_AGENT
  A2A --> SWARM
  SWARM --> CREW_FABRIC
  SYNTH --> STAGE

  %% =========================
  %% 5. 权限 / 安全 / 治理
  %% =========================
  subgraph L5["权限 / 安全 / 治理层"]
    PERMISSION["Agent Permission Model<br/>Agent-Resource-Action 权限矩阵"]
    CAP_TOKEN["CapabilityToken<br/>运行时权限令牌"]
    SECURE_SANDBOX["Secure Sandbox<br/>容器级隔离"]
    COST_GOV["Cost Governance<br/>成本预算 / Token 预算"]
    COST_OBS["Cost Observability<br/>费用观测"]
    AUDIT_CHAIN["Audit Chain<br/>审计链"]
    SUPPORT_AUDIT["Admin Audit & Support Ops<br/>管理后台审计与支持"]
    TENANT["Multi-Tenant Architecture<br/>租户隔离"]
    PROJECT_ISO["Personal Project Ownership<br/>项目所有权 / 数据隔离"]
  end

  ROLE_AGENT --> PERMISSION
  PERMISSION --> CAP_TOKEN
  CAP_TOKEN --> SECURE_SANDBOX
  WEB_AIGC_RT --> PERMISSION
  BRAINSTORM --> COST_GOV
  COST_GOV --> COST_OBS
  PERMISSION --> AUDIT_CHAIN
  SUPPORT_AUDIT --> AUDIT_CHAIN
  TENANT --> PROJECT_ISO
  PROJECT_ISO --> GEN_API
  TENANT --> MARKET_UI

  %% =========================
  %% 6. 能力桥 / 工具池 / 沙盒
  %% =========================
  subgraph L6["能力桥 / 工具池 / 沙盒执行层"]
    CAP_BRIDGE["Blueprint Runtime Capability Bridge<br/>统一能力注册 / 调度 / 证据"]
    TOOL_PROXY["Tool Proxy<br/>Docker / MCP / GitHub / Skills 统一代理"]
    DOCKER_BRIDGE["Docker Capability Bridge<br/>沙盒命令 / 仓库分析 / 渲染 / 测试"]
    MCP_BRIDGE["MCP Capability Bridge<br/>外部工具调用"]
    GITHUB_BRIDGE["GitHub Ingestion / GitHub API<br/>仓库读取 / 分析 / 提交上下文"]
    SKILL_SYS["Plugin / Skill System<br/>注册技能与节点"]
    AIGC_NODE_POOL["Web-AIGC Node Pool<br/>LLM / OCR / Search / Vector / File / Flow Nodes"]
    SANDBOX_PREVIEW["Sandbox Live Preview<br/>浏览器预览 / Docker Live Workstation"]
    EXECUTOR["Executor Integration<br/>远端执行器 / 本地执行器"]
    K8S_OP["K8s Agent Operator<br/>集群部署与调度"]
  end

  ROLE_AGENT --> TOOL_PROXY
  BRAINSTORM --> TOOL_PROXY
  TOOL_PROXY --> CAP_BRIDGE
  CAP_BRIDGE --> DOCKER_BRIDGE
  CAP_BRIDGE --> MCP_BRIDGE
  CAP_BRIDGE --> GITHUB_BRIDGE
  CAP_BRIDGE --> SKILL_SYS
  CAP_BRIDGE --> AIGC_NODE_POOL
  DOCKER_BRIDGE --> SECURE_SANDBOX
  SECURE_SANDBOX --> SANDBOX_PREVIEW
  SANDBOX_PREVIEW --> EFFECT_PREVIEW
  WORKFLOW_ENGINE --> EXECUTOR
  MISSION_RT --> EXECUTOR
  EXECUTOR --> K8S_OP
  GITHUB_BRIDGE --> SPEC_TREE
  GITHUB_BRIDGE --> SPEC_DOC

  %% =========================
  %% 7. Web-AIGC 节点类型
  %% =========================
  subgraph L7["Web-AIGC 节点编排能力"]
    NODE_START["start / end"]
    NODE_LLM["llm / auto_agent / robot_reply"]
    NODE_INTENT["intent_recognition / orchestration_recognition_jump"]
    NODE_PARAM["param_collection / user_input / selection / confirm_judge"]
    NODE_FLOW["condition / loop / flow_jump / variable_assignment"]
    NODE_SEARCH["web_search / image_search / document_search / qa_search / graph_search / fragment_search"]
    NODE_VECTOR["vector_insert / vector_query / vector_update / vector_delete"]
    NODE_FILE["excel_read / file_generation / file_slicing / file_translation / long_text_extraction"]
    NODE_MEDIA["ocr_recognition / audio_recognition / ai_ppt / dynamic_chart"]
    NODE_API["internal_api / passthrough_api / mcp / transaction_flow"]
    NODE_UI["open_page / open_dashboard / open_report / static_webpage_read / recommended_commands"]
    NODE_NOTIFY["message_notification / command_list / get_location_info / get_device_info"]
  end

  AIGC_NODE_POOL --> NODE_START
  AIGC_NODE_POOL --> NODE_LLM
  AIGC_NODE_POOL --> NODE_INTENT
  AIGC_NODE_POOL --> NODE_PARAM
  AIGC_NODE_POOL --> NODE_FLOW
  AIGC_NODE_POOL --> NODE_SEARCH
  AIGC_NODE_POOL --> NODE_VECTOR
  AIGC_NODE_POOL --> NODE_FILE
  AIGC_NODE_POOL --> NODE_MEDIA
  AIGC_NODE_POOL --> NODE_API
  AIGC_NODE_POOL --> NODE_UI
  AIGC_NODE_POOL --> NODE_NOTIFY
  WEB_AIGC_RT --> AIGC_NODE_POOL

  %% =========================
  %% 8. 数据 / 记忆 / 知识 / 回放
  %% =========================
  subgraph L8["数据 / 记忆 / 知识 / 回放层"]
    DOMAIN_STORE["Blueprint Domain & Asset Store<br/>项目域模型 / 资产索引"]
    ARTIFACT_MEMORY["Blueprint Artifact Memory & Replay<br/>产物记忆 / 时间线 / Provenance Graph"]
    MEMORY_SYS["Memory System<br/>短期 / 中期 / 长期记忆"]
    VECTOR_RAG["Vector DB RAG Pipeline<br/>Ingestion → Chunk → Embedding → VectorStore → Retriever"]
    KG["Knowledge Graph<br/>结构化依赖与实体关系"]
    LINEAGE["Data Lineage Tracking<br/>来源 / 派生 / 版本"]
    STATE_RECOVERY["State Persistence Recovery<br/>状态持久化与恢复"]
    REPLAY_DEBUG["Replay & Debug Surface<br/>回放调试台"]
    COLLAB_REPLAY["Collaboration Replay<br/>协作过程回放"]
    EVIDENCE["Evidence Artifact Replay & Trust Chain<br/>证据链 / 驾驶记录仪"]
  end

  GEN_API --> DOMAIN_STORE
  JOB --> ARTIFACT_MEMORY
  SPEC_TREE --> ARTIFACT_MEMORY
  SPEC_DOC --> ARTIFACT_MEMORY
  PROMPT_PACK --> ARTIFACT_MEMORY
  EFFECT_PREVIEW --> ARTIFACT_MEMORY
  BRAINSTORM --> ARTIFACT_MEMORY
  ARTIFACT_MEMORY --> LINEAGE
  LINEAGE --> EVIDENCE
  MEMORY_SYS --> VECTOR_RAG
  VECTOR_RAG --> KG
  ROLE_AGENT --> MEMORY_SYS
  WORKFLOW_ENGINE --> MEMORY_SYS
  ARTIFACT_MEMORY --> REPLAY_DEBUG
  EVIDENCE --> REPLAY_DEBUG
  COLLAB_REPLAY --> REPLAY_DEBUG
  STATE_RECOVERY --> JOB
  STATE_RECOVERY --> INSTANCE
  REPLAY_DEBUG --> HOME

  %% =========================
  %% 9. 事件 / 实时传输 / 前端 Store
  %% =========================
  subgraph L9["事件流 / 实时状态 / 前端 Store"]
    EVENT_BUS["BlueprintEventBus / RuntimeEventStream<br/>统一运行时事件流"]
    MSG_BUS["MessageBus<br/>Agent 间消息总线"]
    SOCKET["Socket.IO Relay<br/>job room / mission_event / stage_change"]
    FRONT_STORE["BlueprintRealtimeStore<br/>蓝图实时 Store"]
    AUTOPILOT_STORE["Autopilot Frontend View Model<br/>destinationDraft / routePlan / selectedRoute / driveState / fleet / takeoverQueue / evidenceTimeline"]
    TASK_STORE["Tasks Store / Mission Store<br/>任务状态 / 六阶段状态"]
    TELEMETRY_STORE["Telemetry Store<br/>LLM / Token / Cost / Duration"]
    BRAIN_GRAPH["brainstormGraph Slice<br/>BranchNodes + BranchEdges + Session Metadata"]
  end

  STAGE --> EVENT_BUS
  BRAINSTORM -->|brainstorm.*| EVENT_BUS
  CAP_BRIDGE -->|capability.*| EVENT_BUS
  MISSION_RT -->|mission_event| EVENT_BUS
  WORKFLOW_ENGINE -->|stage_change / message| EVENT_BUS
  ROLE_AGENT --> MSG_BUS
  MSG_BUS --> EVENT_BUS
  EVENT_BUS --> SOCKET
  SOCKET --> FRONT_STORE
  SOCKET --> AUTOPILOT_STORE
  SOCKET --> TASK_STORE
  SOCKET --> TELEMETRY_STORE
  FRONT_STORE --> BRAIN_GRAPH
  BRAIN_GRAPH --> ARTIFACT_MEMORY

  %% =========================
  %% 10. 前端工作台 / 右栏 / 文档 / 预演
  %% =========================
  subgraph L10["前端工作台 / 信息架构"]
    COCKPIT["Autopilot Cockpit<br/>三列布局 / 工作台节奏"]
    RIGHT_RAIL["Right Rail Stage Panels<br/>阶段卡片 / Narrative Swiper / Data Hook"]
    WORKBENCH["Advanced Workbench Inline<br/>规格树 / 文档 / 预演 / Prompt 包"]
    DOC_RENDERER["Streaming Doc Renderer<br/>流式文档渲染"]
    MERMAID_RENDER["Mermaid Diagram Rendering<br/>架构图 / 流程图渲染"]
    SPEC_EXPORT["Spec Document Export<br/>导出规格文档"]
    STAGE_PROGRESS["Stage Progress Indicator<br/>阶段进度"]
    VERSION_HISTORY["Stage Version History<br/>阶段版本历史"]
    HUMAN_TAKEOVER["Human-in-the-loop Surface<br/>人工接管界面"]
  end

  FRONT_STORE --> COCKPIT
  AUTOPILOT_STORE --> COCKPIT
  COCKPIT --> RIGHT_RAIL
  COCKPIT --> WORKBENCH
  WORKBENCH --> DOC_RENDERER
  WORKBENCH --> MERMAID_RENDER
  WORKBENCH --> SPEC_EXPORT
  COCKPIT --> STAGE_PROGRESS
  STAGE_PROGRESS --> VERSION_HISTORY
  TAKEOVER --> HUMAN_TAKEOVER
  HUMAN_TAKEOVER --> WAIT_RESUME

  %% =========================
  %% 11. 3D / Scene Fusion / UE
  %% =========================
  subgraph L11["3D 场景 / 墙面 / UE 渲染"]
    SCENE_FUSION["Autopilot Scene Fusion<br/>3D 场景与蓝图信号融合"]
    PET_WORKERS["PetWorkers<br/>角色工作状态"]
    MISSION_ISLAND["MissionIsland<br/>任务岛 / 当前 Job"]
    STAGE_FLOW["SceneStageFlow<br/>阶段流"]
    WALL_HUD["Blueprint Wall Process Graph HUD<br/>墙面流程图 HUD"]
    BRAIN_WALL["Brainstorm Wall Graph<br/>dagre + Canvas2D 思维导图"]
    CANVAS_TEX["Three.js CanvasTexture<br/>贴到 3D 墙面大屏"]
    HOLO_UI["Holographic UI<br/>全息 UI"]
    UE_LOCAL["UE Local Streaming Runtime<br/>本地 UE5 + Pixel Streaming"]
    UE_SYNC["UE State Sync Bridge<br/>前端 ↔ UE 双向状态同步"]
    UE_COMMAND["UE Scene Command Protocol<br/>镜头 / 角色 / 场景命令"]
    UE_RECORD["UE Recording & Replay Export<br/>录制与回放导出"]
  end

  FRONT_STORE --> SCENE_FUSION
  TASK_STORE --> SCENE_FUSION
  BRAIN_GRAPH --> BRAIN_WALL
  SCENE_FUSION --> PET_WORKERS
  SCENE_FUSION --> MISSION_ISLAND
  SCENE_FUSION --> STAGE_FLOW
  SCENE_FUSION --> WALL_HUD
  WALL_HUD --> CANVAS_TEX
  BRAIN_WALL --> CANVAS_TEX
  CANVAS_TEX --> HOLO_UI
  HOLO_UI --> HOME
  FRONT_STORE --> UE_SYNC
  UE_SYNC --> UE_LOCAL
  UE_COMMAND --> UE_LOCAL
  UE_LOCAL --> HOME
  UE_LOCAL --> UE_RECORD
  UE_RECORD --> REPLAY_DEBUG

  %% =========================
  %% 12. Marketplace / 生态 / 跨框架
  %% =========================
  subgraph L12["Agent 生态 / Marketplace / 跨框架"]
    MARKET["Agent Marketplace Platform<br/>发布 / 购买 / 订阅 / 集成"]
    AGENT_PACKAGE["Agent Package<br/>源码 / 元数据 / 依赖 / 文档"]
    SECURITY_AUDIT["Marketplace Security Audit<br/>安全审核"]
    LICENSE["License / Purchase / Revenue<br/>许可证 / 购买 / 收益"]
    REPUTATION["Agent Reputation<br/>评分 / 可用性 / 评价"]
    DEP_GRAPH["Dependency Graph<br/>Agent / MCP / Model 依赖"]
    HEALTH["Agent Health Check<br/>可用性 / 性能 / 错误率"]
    CROSS_EXPORT["Cross Framework Export<br/>跨框架导出"]
  end

  MARKET_UI --> MARKET
  MARKET --> AGENT_PACKAGE
  AGENT_PACKAGE --> SECURITY_AUDIT
  SECURITY_AUDIT --> LICENSE
  LICENSE --> REPUTATION
  AGENT_PACKAGE --> DEP_GRAPH
  MARKET --> HEALTH
  MARKET --> ROLE_SYS
  DEP_GRAPH --> MCP_BRIDGE
  CROSS_EXPORT --> A2A
  A2A --> MARKET

  %% =========================
  %% 13. 可观测性 / 质量 / 发布
  %% =========================
  subgraph L13["可观测性 / 质量 / 发布治理"]
    TELEMETRY_DASH["Telemetry Dashboard<br/>LLM 次数 / Token / 费用 / Agent 瓶颈 / Mission 耗时"]
    OBS_AUDIT["Web-AIGC Observability & Audit<br/>运行时审计"]
    PERF["Performance & Stability<br/>性能稳定性"]
    RELEASE["Release Stability Guardrails<br/>发布稳定性护栏"]
    PROD["Production Deployment<br/>生产部署"]
    DR["Multi-Region Disaster Recovery<br/>多区域灾备"]
    QUALITY["UE Performance Profiling / Quality Tier<br/>画质等级 / 性能剖析"]
    COST_ALERT["Budget Alert<br/>预算预警"]
  end

  TELEMETRY_STORE --> TELEMETRY_DASH
  WEB_AIGC_RT --> OBS_AUDIT
  EVENT_BUS --> OBS_AUDIT
  COST_OBS --> COST_ALERT
  TELEMETRY_DASH --> COST_ALERT
  PERF --> RELEASE
  RELEASE --> PROD
  PROD --> DR
  UE_LOCAL --> QUALITY
  QUALITY --> PERF

  %% =========================
  %% 14. 关键闭环
  %% =========================
  AP_OUT["Autopilot Stage Output<br/>路线 / SPEC / 文档 / 预演 / Prompt / 工程交付"]
  HANDOFF --> AP_OUT
  SYNTH --> AP_OUT
  AP_OUT --> ARTIFACT_MEMORY
  AP_OUT --> COCKPIT
  AP_OUT --> REPLAY_DEBUG

  %% feedback loops
  REPLAY_DEBUG -.经验回填.-> MEMORY_SYS
  MEMORY_SYS -.上下文注入.-> ROLE_AGENT
  TELEMETRY_DASH -.瓶颈反馈.-> COST_GOV
  COST_GOV -.预算约束.-> DECISION_GATE
  EVIDENCE -.可信证据.-> CLARIFY
  USER_FEEDBACK["User Feedback<br/>用户反馈 / 评分 / 修订意见"] --> REPLAN
  COCKPIT --> USER_FEEDBACK
  USER_FEEDBACK --> MEMORY_SYS

  %% =========================
  %% 样式
  %% =========================
  classDef entry fill:#eef2ff,stroke:#4f46e5,color:#111827;
  classDef core fill:#ecfeff,stroke:#0891b2,color:#111827;
  classDef agent fill:#f0fdf4,stroke:#16a34a,color:#111827;
  classDef runtime fill:#fff7ed,stroke:#ea580c,color:#111827;
  classDef data fill:#fdf2f8,stroke:#db2777,color:#111827;
  classDef frontend fill:#f5f3ff,stroke:#7c3aed,color:#111827;
  classDef security fill:#fef2f2,stroke:#dc2626,color:#111827;
  classDef infra fill:#f8fafc,stroke:#475569,color:#111827;

  class U,HOME,COMPOSER,LAUNCH,ADMIN,MARKET_UI,FEISHU entry;
  class AP_MASTER,GEN_API,JOB,STAGE,SPEC_TREE,SPEC_DOC,PROMPT_PACK,EFFECT_PREVIEW,HANDOFF,AP_OUT core;
  class DYN_ORG,ROLE_SYS,ROLE_CONTAINER,ROLE_AGENT,CREW_FABRIC,STAGE_ACT,BRAINSTORM,DECISION_GATE,COLLAB_MODE,SYNTH,A2A,SWARM agent;
  class RUNTIME_ORCH,MISSION_MAP,MISSION_RT,WORKFLOW_ENGINE,WEB_AIGC_RT,INSTANCE,WAIT_RESUME,RETRY_ESC runtime;
  class DOMAIN_STORE,ARTIFACT_MEMORY,MEMORY_SYS,VECTOR_RAG,KG,LINEAGE,STATE_RECOVERY,REPLAY_DEBUG,COLLAB_REPLAY,EVIDENCE data;
  class EVENT_BUS,MSG_BUS,SOCKET,FRONT_STORE,AUTOPILOT_STORE,TASK_STORE,TELEMETRY_STORE,BRAIN_GRAPH,COCKPIT,RIGHT_RAIL,WORKBENCH,DOC_RENDERER,MERMAID_RENDER,SPEC_EXPORT,STAGE_PROGRESS,VERSION_HISTORY,HUMAN_TAKEOVER,SCENE_FUSION,PET_WORKERS,MISSION_ISLAND,STAGE_FLOW,WALL_HUD,BRAIN_WALL,CANVAS_TEX,HOLO_UI frontend;
  class PERMISSION,CAP_TOKEN,SECURE_SANDBOX,COST_GOV,COST_OBS,AUDIT_CHAIN,SUPPORT_AUDIT,TENANT,PROJECT_ISO,SECURITY_AUDIT security;
  class CAP_BRIDGE,TOOL_PROXY,DOCKER_BRIDGE,MCP_BRIDGE,GITHUB_BRIDGE,SKILL_SYS,AIGC_NODE_POOL,SANDBOX_PREVIEW,EXECUTOR,K8S_OP,UE_LOCAL,UE_SYNC,UE_COMMAND,UE_RECORD,MARKET,AGENT_PACKAGE,LICENSE,REPUTATION,DEP_GRAPH,HEALTH,CROSS_EXPORT,TELEMETRY_DASH,OBS_AUDIT,PERF,RELEASE,PROD,DR,QUALITY,COST_ALERT infra;
```