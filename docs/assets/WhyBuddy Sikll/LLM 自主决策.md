```mermaid
flowchart LR

    %% ======================
    %% Styles
    %% ======================
    classDef legendBlue fill:#eff6ff,stroke:#2563eb,stroke-width:3px,color:#0f172a;
    classDef legendOrange fill:#fff7ed,stroke:#f97316,stroke-width:3px,color:#0f172a;
    classDef legendTeal fill:#ecfeff,stroke:#0891b2,stroke-width:3px,color:#0f172a;
    classDef legendPurple fill:#f5f3ff,stroke:#7c3aed,stroke-width:3px,color:#0f172a;
    classDef legendGreen fill:#ecfdf5,stroke:#16a34a,stroke-width:3px,color:#0f172a;
    classDef legendRed fill:#fff1f2,stroke:#ef4444,stroke-width:3px,color:#0f172a,stroke-dasharray:5 5;

    %% ======================
    %% Legend（左上角竖着显示）
    %% ======================
    subgraph LEGEND["Legend（路径图例）"]
    direction TB
    L1["Blue（蓝色）<br/>Core Pipeline<br/>核心主流程"]:::legendBlue
    L2["Orange（橙色）<br/>Brainstorm Collaboration<br/>头脑风暴协作路径"]:::legendOrange
    L3["Teal（青色）<br/>Tool Invocation<br/>工具调用路径"]:::legendTeal
    L4["Purple（紫色）<br/>Realtime Events / State<br/>实时事件 / 状态同步路径"]:::legendPurple
    L5["Green（绿色）<br/>Visualization / Replay<br/>可视化 / 回放路径"]:::legendGreen
    L6["Red Dashed（红色虚线）<br/>Graceful Degradation<br/>降级 / 异常兜底路径"]:::legendRed
    end

    %% ======================
    %% User / Autopilot入口
    %% ======================
    U[用户输入产品想法 / 任务目标] --> AP[Autopilot Pipeline<br/>现有蓝图驾驶舱流程]

    AP --> STAGE[Stage Context<br/>当前阶段上下文]

    %% ======================
    %% Decision Gate
    %% ======================
    STAGE --> DG{Decision Gate<br/>LLM 自主决策}

    DG -->|不需要头脑风暴| SA[Single Agent Linear Path<br/>沿用现有单 Agent 执行]
    SA --> AP_OUT[阶段输出]

    DG -->|需要头脑风暴| BO[Brainstorm Orchestrator<br/>多智能体协作调度器]

    %% ======================
    %% Orchestrator内部
    %% ======================
    BO --> MODE[Collaboration Mode<br/>discussion / vote / division / audit]
    BO --> RR[Role Registry<br/>角色注册表]

    RR --> DECIDER[Decider<br/>决策者]
    RR --> PLANNER[Planner<br/>规划师]
    RR --> ARCH[Architect<br/>架构师]
    RR --> EXEC[Executor<br/>执行者]
    RR --> AUDIT[Auditor<br/>审计员]
    RR --> UI[UI Previewer<br/>UI 预览师]

    MODE --> SESSION[Brainstorm Session<br/>多分支推理会话]

    SESSION --> DECIDER
    SESSION --> PLANNER
    SESSION --> ARCH
    SESSION --> EXEC
    SESSION --> AUDIT
    SESSION --> UI

    %% ======================
    %% Tool Proxy
    %% ======================
    DECIDER --> TP[Tool Proxy<br/>统一工具代理]
    PLANNER --> TP
    ARCH --> TP
    EXEC --> TP
    AUDIT --> TP
    UI --> TP

    TP --> DOCKER[Docker Sandbox]
    TP --> MCP[MCP Tools]
    TP --> GH[GitHub API]
    TP --> SKILLS[Registered Skills]

    %% ======================
    %% 输出汇总
    %% ======================
    DECIDER --> SYN[Synthesizer<br/>协作结果综合]
    PLANNER --> SYN
    ARCH --> SYN
    EXEC --> SYN
    AUDIT --> SYN
    UI --> SYN

    SYN --> RESULT[Final Stage Output<br/>决策 / 方案 / 信心分 / 分歧意见]
    RESULT --> AP_OUT

    %% ======================
    %% 事件总线
    %% ======================
    BO -->|brainstorm.* events| EB[BlueprintEventBus<br/>统一运行时事件总线]
    TP -->|tool.completed / tool.failed| EB
    SYN -->|session.completed| EB

    EB --> SOCKET[Socket.IO Relay<br/>实时推送到 Job Room]

    %% ======================
    %% 前端状态
    %% ======================
    SOCKET --> STORE[BlueprintRealtimeStore<br/>brainstormGraph Slice]

    STORE --> NODES[Branch Nodes<br/>推理节点]
    STORE --> EDGES[Branch Edges<br/>父子关系]
    STORE --> META[Session Metadata<br/>模式 / 角色 / Token / 状态]

    %% ======================
    %% 3D可视化
    %% ======================
    NODES --> WG[Brainstorm Wall Graph<br/>dagre + Canvas2D]
    EDGES --> WG
    META --> WG

    WG --> TEX[Three.js CanvasTexture<br/>贴到 3D 墙面大屏]
    TEX --> WALL[3D Wall Mind Map<br/>实时多分支推理树]

    %% ======================
    %% 记忆与回放
    %% ======================
    BO --> MS[Artifact Memory Store<br/>会话持久化]
    RESULT --> MS

    MS --> REPLAY[Replay API<br/>GET /api/blueprint/jobs/:id/brainstorm/:sessionId]
    REPLAY --> STORE

    %% ======================
    %% 降级
    %% ======================
    DG -.失败 / 超时.-> DEG[Graceful Degradation<br/>降级事件]
    BO -.LLM / Docker / Token / Timeout异常.-> DEG
    TP -.工具不可达.-> DEG
    DEG -.fallback.-> SA
    DEG --> EB

    %% ======================
    %% Colored Link Styles
    %% ======================

    %% Blue：Core Pipeline（核心主流程）
    linkStyle 0,1,2,3,4,5 stroke:#2563eb,stroke-width:3px;

    %% Orange：Brainstorm Collaboration（头脑风暴协作路径）
    linkStyle 6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,31,32,33,34,35,36,37,38 stroke:#f97316,stroke-width:3px;

    %% Teal：Tool Invocation（工具调用路径）
    linkStyle 21,22,23,24,25,26,27,28,29,30 stroke:#0891b2,stroke-width:3px;

    %% Purple：Realtime Events / State（实时事件 / 状态同步路径）
    linkStyle 39,40,41,42,43,44,45,46 stroke:#7c3aed,stroke-width:3px;

    %% Green：Visualization / Replay（可视化 / 回放路径）
    linkStyle 47,48,49,50,51,52,53,54,55 stroke:#16a34a,stroke-width:3px;

    %% Red Dashed：Graceful Degradation（降级 / 异常兜底路径）
    linkStyle 56,57,58,59,60 stroke:#ef4444,stroke-width:3px,stroke-dasharray:5 5;
```