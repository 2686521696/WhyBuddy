# WhyBuddy Skill 闭环总图（改进版 v4.2 · 出图可信层 + 外壳/视口一致性）

> 在 v1(四处发力点)基础上再加两块,全部 ★ + 青虚线:
> 五、**伴随式审查与接地层**——挑刺者 + 接地者,横切输入/澄清/路线/规格,按需触发(模糊度·真仓库·风险),不常驻开会。
> 六、**落地交付升级**——视觉分两路(看感觉→生图模型并标“预览”;结构图→确定性渲染)、可追溯矩阵、更厚的交付包(接口契约草稿·验收用例·未决项·校验台账)。
> v4.2 增量(▣)：**出图视口一致性**——按设备类(Web 16:9 / 移动竖屏 / 平板)定宽高比;生图模型按就近档位出图,再确定性缩放/补边到固定画布(1920×1080 / 2K 2560×1440)。视口规格并入 App Shell,无新增节点与连线。
> v4.1 增量(蓝绿虚线 + ▣)：**出图外壳一致性**——左菜单由规格树派生、Header 为产品常量,确定性渲染成统一外壳;生图模型只填内容区,不再每页瞎编 menu/header;出图审计加查外壳一致性。
> v4 增量(红虚线 + ◆◆)：出图审计 check_previews_real（揪兜底/假成功/复制充数）；出图 gate 只认本次真成功张数、防复制、禁兜底、503 重试。
> v3 增量(粉虚线 + ◆)：伴随层留痕进台账（companion_log→校验→台账）；出图改为「按模块的强制 gate」并进台账；视觉生成由 spec_tree 模块驱动。
> 约定:实线=主流程;虚线=反馈/失效/运行时;菱形=判断闸;青虚线+★=v2 新增;**粉虚线+◆=v3 新增**;**红虚线+◆◆=v4**;**蓝绿虚线+▣=v4.1/4.2 出图外壳与视口一致性**。

```mermaid
flowchart TB

U["用户想法 / User Idea<br/>一句话目标 · 仓库 · 文件 · 截图"]:::entry

subgraph S1["01 输入层 / Input"]
  direction TB
  IN_RAW["原始输入 / Raw Input"]:::input
  IN_GH{"有 GitHub 链接? / Has repo URL?"}:::gate
  IN_INGEST["★ GitHub 深度解析 / Deep Ingestion<br/>文件 · 符号 · 接口契约"]:::input
  IN_FALL["降级状态 / Fallback<br/>权限失败 · 仓库不可访问"]:::fallback
  IN_NORM["归一化 / Normalize<br/>去重 · 证据 · 失败状态"]:::input
  IN_CTX["项目上下文 / Project Context<br/>目标 · 摘要 · 来源 · 证据"]:::input
end

subgraph S2["02 澄清层 / Clarification"]
  direction TB
  CL_GAP["缺失信息 / Missing Info<br/>阻塞 · 非阻塞"]:::clarify
  CL_Q["澄清问题 / Questions"]:::clarify
  CL_READY{"就绪度 / Readiness<br/>可规划? 还是继续补充?"}:::gate
  CL_BRIEF["澄清简报 / Clarified Brief<br/>目标 · 约束 · 成功标准"]:::clarify
end

subgraph S3["03 路线规划 / Route Planning"]
  direction TB
  RT_GEN["多路线生成 / Multi-Route<br/>标准 · 深度 · 升级"]:::route
  RT_CMP["对比 · 风险 / Compare · Risk"]:::route
  RT_SEL["路线选择 / Route Selection"]:::route
  RT_GATE{"轻量确认闸 / Confirm Gate"}:::gate
end

subgraph DG["决策与协作 / Decision and Collaboration"]
  direction TB
  D_GATE{"决策门 / Decision Gate<br/>简单 or 复杂?"}:::decision
  D_SA["单 Agent / Single-Agent"]:::decision
  D_BO["头脑风暴 / Brainstorm<br/>模式: 讨论 · 投票 · 分工 · 审计"]:::decision
  D_ROLES["多角色 / Roles<br/>决策 · 规划 · 架构 · 执行 · 审计 · UI"]:::decision
  D_SYN["综合器 / Synthesizer<br/>方案 · 信心分 · 分歧意见"]:::decision
  D_TOOLS["工具代理 / Tool Proxy<br/>Docker · MCP · GitHub · Skills"]:::tool
  D_DEG["降级兜底 / Degradation"]:::fallback
end

subgraph CO["★ 伴随式审查与接地 / Companion · 按需触发：模糊度·真仓库·风险"]
  direction TB
  CO_CRIT["★ 挑刺者 / Critic<br/>找漏洞 · 证据不足处"]:::companion
  CO_GROUND["★ 接地者 / Grounding<br/>读真代码 · 逼挂真实出处"]:::companion
end

subgraph S4["04 规格树生成核心 / SPEC Tree Generation Core"]
  direction TB
  SP_PROMPT["★ 提示词构造 / Prompt Builder<br/>成功标准→需求 · 验收用 EARS"]:::spec
  SP_REDACT["脱敏 / Redaction"]:::spec
  SP_LLM["LLM JSON 生成 / callJson<br/>retryAttempts = 1"]:::spec
  SP_SCHEMA{"Schema 校验 / Validator"}:::gate
  SP_NORM["归一化 / Normalizer<br/>稳定 ID 重映射"]:::spec
  SP_INV{"★ 不变量守卫 / Invariant Guard<br/>唯一根 · 父可达 · 深度 · 无环<br/>+ 需求覆盖成功标准 · 每节点挂证据"}:::gate
  SP_FALL["确定性兜底 / Deterministic Fallback<br/>已预先满足不变量"]:::fallback
  SP_PROV["来源追踪 / Provenance<br/>llm · llm_fallback · template"]:::spec
  SP_TREE["规格树 / SPEC Tree<br/>Requirements · Design · Tasks · Evidence(带真实出处)"]:::artifact
end

subgraph S5["05 规格文档 / SPEC Document"]
  direction TB
  SD_GEN["文档生成器 / Doc Generator"]:::doc
  SD_DOCS["文档 / Docs<br/>requirements.md · design.md · tasks.md"]:::doc
  SD_ACC["验收 · 证据 · 用例 / Acceptance · Evidence · Tests"]:::doc
end

subgraph S6["06 效果预览与交付 / Preview and Handoff"]
  direction TB
  EP_PACK["提示词包 / Prompt Pack"]:::preview
  EP_PREV["效果预览 / Effect Preview"]:::preview
  EP_SHELL["▣ 应用外壳·设计系统 / App Shell<br/>左菜单 = 规格树派生 · Header = 产品常量<br/>▣ 视口规格: 设备类→宽高比→画布(Web 16:9 · 移动竖屏 · 平板)<br/>颜色 token · 栅格 · 确定性渲染/合成(非生图)"]:::preview
  EP_VIS_GEN["◆ 视觉预览·生成 / Gen Preview<br/>按模块(每需求一页)→生图模型<br/>▣ 外壳由 App Shell 锁定 · 按设备视口就近出图 · 只生成内容区<br/>只认真成功张数·防复制·禁兜底·503重试<br/>UI 草样 · 标『预览·未验证』"]:::preview
  EP_VIS_REND["★ 结构图·渲染 / Rendered<br/>规格树→Mermaid 确定性出图<br/>架构总图 · 不交给生图模型"]:::preview
  EP_VIS_AUDIT["◆◆ 出图审计 / check_previews_real<br/>查 provenance：兜底·假成功(ok却带error)·复制充数<br/>▣ 加查外壳一致性(menu/header 是否同一套)<br/>用户自跑，agent 改不了这步"]:::companion
  EP_MATRIX["★ 可追溯矩阵 / Traceability<br/>需求↔设计↔任务↔证据↔用例"]:::preview
  EP_HAND["交付包 · 导出 / Handoff · Export<br/>md·zip · 接口契约(草稿·待核) · 验收用例<br/>未决项登记 · 校验台账 · 视觉预览(标来源)"]:::preview
end

subgraph S7["07 运行时与状态 / Runtime and State"]
  direction TB
  WF_JOB["任务仓 · 产物 / Job · Artifact Store"]:::runtime
  WF_EVT["事件总线 / Event Bus<br/>每阶段产出都落事件"]:::runtime
  WF_SOCK["实时推送 / Socket Relay"]:::runtime
  WF_STORE["实时状态仓 / Realtime Store<br/>按 sessionId 隔离"]:::runtime
  WF_DERIVE["状态派生器 / deriveNodeStatus<br/>实时进度 + 已存文档 → 单一真相"]:::runtime
  WF_ROW["节点行 / Node Row<br/>待生成 · 生成中 · 完成 · 失败 · 重试成功"]:::runtime
  WF_REPLAY["回放 / Replay"]:::runtime
end

subgraph S8["08 失效与依赖 / Invalidation and Dependency"]
  direction TB
  DEP["依赖图 / Dependency Graph<br/>上游变更 → 下游影响"]:::danger
  INV["失效引擎 / Invalidation Engine"]:::danger
  STALE["失效索引 / Stale Index<br/>staleSince · reason · fromStage"]:::danger
  RECOMP["自动重算 / Auto-Recompute<br/>沿依赖链重建下游"]:::danger
end

subgraph S9["评审与反馈闭环 / Review and Feedback"]
  direction TB
  RV{"评审 / Review<br/>交付 or 回炉?"}:::feedback
  FB["反馈 / Feedback"]:::feedback
  RP{"重规划 / Replan<br/>预算 · 收敛阈值"}:::feedback
  ESC["失败 · 中止 · 转人工 / Fail · Abort · Escalate"]:::fallback
  ITER["用户修改再推演 / User Iterate"]:::feedback
end

subgraph QA["质量门 / Quality Gate"]
  direction TB
  QA_TEST["测试 / Tests<br/>状态 · SSR · E2E · 截图"]:::qa
  QA_CONTENT["★ 内容质量校验 / Content Check<br/>规格成立 · 验收为 EARS 句式"]:::qa
  QA_MERGE{"合并门槛 / Merge Gate<br/>自动断言 + 人工目检"}:::gate
  QA_LEDGER["★ 校验台账 / Checks Ledger<br/>脚本 · 退出码 · 输出"]:::ledger
end

DONE["交付完成 / Shipped"]:::artifact

subgraph LEGEND["图例 / Legend （颜色与连线一致）"]
  direction TB
  LG_B["蓝 实线 / Blue<br/>主流程 Main flow"]:::pBlue
  LG_O["橙 实线 / Orange<br/>决策与协作 Decision"]:::pOrange
  LG_P["紫 实线 / Purple<br/>规格树生成核心 SPEC core"]:::pPurple
  LG_G["绿 实线 / Green<br/>产物 · 文档 · 交付 Artifacts"]:::pGreen
  LG_GR["灰 虚线 / Gray dashed<br/>运行时 · 工具 · 支撑 Runtime"]:::pGray
  LG_R["红 虚线 / Red dashed<br/>失效 · 回炉 · 反馈 Loops"]:::pRed
  LG_NEW["★ 青虚线 / Teal dashed<br/>新增：伴随角色·视觉·矩阵·台账"]:::pLedger
  LG_SHELL["▣ 蓝绿虚线 / Teal-green dashed<br/>v4.1：出图外壳一致性"]:::pShell
end

%% ===== 蓝色 主流程 (0-14) =====
U --> IN_RAW
IN_RAW --> IN_GH
IN_GH -->|有仓库 / yes| IN_INGEST
IN_GH -->|无仓库·直接跳过 / no| IN_NORM
IN_INGEST --> IN_NORM
IN_NORM --> IN_CTX
IN_CTX --> CL_GAP
CL_GAP --> CL_Q
CL_Q --> CL_READY
CL_READY -->|就绪 / ready| CL_BRIEF
CL_BRIEF --> RT_GEN
RT_GEN --> RT_CMP
RT_CMP --> RT_SEL
RT_SEL --> RT_GATE
RT_GATE -->|确认 / confirm| D_GATE

%% ===== 橙色 决策与协作 (15-20) =====
D_GATE -->|简单 / simple| D_SA
D_GATE -->|复杂 / complex| D_BO
D_BO --> D_ROLES
D_ROLES --> D_SYN
D_SA --> SP_PROMPT
D_SYN --> SP_PROMPT

%% ===== 紫色 规格树生成核心 (21-28) =====
SP_PROMPT --> SP_REDACT
SP_REDACT --> SP_LLM
SP_LLM --> SP_SCHEMA
SP_SCHEMA -->|结构通过| SP_NORM
SP_NORM --> SP_INV
SP_INV -->|不变量通过| SP_PROV
SP_FALL --> SP_PROV
SP_PROV --> SP_TREE

%% ===== 绿色 产物·文档·交付 (29-40) =====
SP_TREE --> SD_GEN
SD_GEN --> SD_DOCS
SD_DOCS --> SD_ACC
SD_ACC --> EP_PACK
SD_DOCS --> EP_PACK
SP_TREE --> EP_PREV
EP_PACK --> EP_HAND
EP_PREV --> EP_HAND
SP_TREE --> WF_JOB
SD_DOCS --> WF_JOB
EP_HAND --> RV
RV -->|通过·交付| DONE

%% ===== 灰色虚线 运行时·工具·支撑 (41-60) =====
D_SA -. 调用工具 .-> D_TOOLS
D_ROLES -. 调用工具 .-> D_TOOLS
D_TOOLS -. 证据返回 .-> D_ROLES
WF_JOB -. 事件 .-> WF_EVT
WF_EVT -.-> WF_SOCK
WF_SOCK -.-> WF_STORE
WF_STORE -.-> WF_DERIVE
WF_JOB -. 已存文档 .-> WF_DERIVE
WF_DERIVE -.-> WF_ROW
WF_JOB -.-> WF_REPLAY
WF_REPLAY -. 按会话隔离 .-> WF_STORE
WF_ROW -. 驱动预览 .-> EP_PREV
WF_ROW -. 失效提示 .-> RV
CL_BRIEF -. 成功标准派生验收 .-> SD_ACC
WF_ROW -.-> QA_TEST
WF_STORE -.-> QA_TEST
SP_TREE -. 内容质量校验 .-> QA_CONTENT
QA_TEST -.-> QA_MERGE
QA_CONTENT -.-> QA_MERGE
QA_MERGE -. 放行发布 .-> DONE

%% ===== 红色虚线 失效·回炉·反馈 (61-92) =====
IN_INGEST -. 权限失败 .-> IN_FALL
IN_FALL -.-> IN_NORM
CL_READY -. 未就绪·回去补充 .-> CL_GAP
RT_GATE -. 调整·退回 .-> RT_SEL
D_GATE -. 失败·超时 .-> D_DEG
D_BO -. 异常 .-> D_DEG
D_TOOLS -. 不可达 .-> D_DEG
D_DEG -. 兜底→单Agent .-> D_SA
D_BO -. 可回灌路线 .-> RT_GEN
D_BO -. 可回灌澄清 .-> CL_GAP
SP_LLM -. 超时·非JSON·先重试 .-> SP_LLM
SP_SCHEMA -. 结构失败 .-> SP_FALL
SP_INV -. 不变量失败 .-> SP_FALL
DEP -. 计算下游影响 .-> INV
INV -.-> STALE
STALE -. 同步前端 .-> WF_STORE
STALE -.-> RECOMP
RECOMP -. 重建规格树 .-> SP_PROMPT
RECOMP -. 重建文档 .-> SD_GEN
RECOMP -. 重建预览 .-> EP_PREV
RV -. 回炉 .-> FB
FB -.-> RP
FB -. 上游变更 .-> INV
RP -. 回到澄清 .-> CL_GAP
RP -. 回到路线 .-> RT_GEN
RP -. 回到规格树 .-> SP_PROMPT
RP -. 重判模式 .-> D_GATE
RP -. 使下游失效 .-> INV
RP -. 超预算·不收敛 .-> ESC
EP_PREV -. 用户不满 .-> ITER
ITER -. 再推演 .-> RP
QA_MERGE -. 不通过·回炉 .-> FB

%% ===== ★ v1 改动 青虚线 (93-100) =====
CL_BRIEF -. 成功标准派生需求 .-> SP_PROMPT
SP_SCHEMA -. 校验结果 .-> QA_LEDGER
SP_INV -. 校验结果 .-> QA_LEDGER
QA_TEST -. 结果 .-> QA_LEDGER
QA_CONTENT -. 结果 .-> QA_LEDGER
QA_MERGE -. 结果 .-> QA_LEDGER
QA_LEDGER -. 随交付导出 .-> EP_HAND
QA_LEDGER -. 落盘存档 .-> WF_JOB

%% ===== ★ v2 新增：伴随角色 + 视觉分流 + 追溯矩阵 (101-111) =====
CO_CRIT -. 伴随挑刺 .-> CL_GAP
CO_GROUND -. 伴随接地 .-> IN_INGEST
CO_GROUND -. 伴随接地 .-> CL_BRIEF
CO_CRIT -. 伴随挑刺 .-> RT_CMP
CO_CRIT -. 伴随挑刺 .-> SP_PROMPT
SD_DOCS -. 转生图提示词 .-> EP_VIS_GEN
EP_VIS_GEN -.-> EP_HAND
SP_TREE -. 确定性渲染 .-> EP_VIS_REND
EP_VIS_REND -.-> EP_HAND
SP_TREE -. 汇总追溯 .-> EP_MATRIX
EP_MATRIX -.-> EP_HAND

%% ===== ◆ v3 新增：伴随留痕进台账 + 按模块出图 gate 进台账 (112-115) =====
CO_CRIT -. 留痕进台账 .-> QA_LEDGER
CO_GROUND -. 留痕进台账 .-> QA_LEDGER
SP_TREE -. 按模块驱动出图 .-> EP_VIS_GEN
EP_VIS_GEN -. 出图核验·进台账 .-> QA_LEDGER

%% ===== ◆◆ v4 新增：出图可信层 (116-118) =====
EP_VIS_GEN -. 出图后必审计 .-> EP_VIS_AUDIT
EP_VIS_AUDIT -. 审计结果进台账 .-> QA_LEDGER
EP_VIS_AUDIT -. 揪出假图·回炉重出 .-> EP_VIS_GEN

%% ===== ▣ v4.1 出图一致性：外壳确定性、生图只填内容区 (119-121) =====
SP_TREE -. ▣ 派生导航(左菜单) .-> EP_SHELL
EP_SHELL -. ▣ 锁定外壳·只填内容区 .-> EP_VIS_GEN
EP_SHELL -. ▣ 外壳一致性基准 .-> EP_VIS_AUDIT

%% ===== 节点样式（按层）=====
classDef entry fill:#eef6ff,stroke:#2563eb,color:#0f172a,stroke-width:2px;
classDef input fill:#eff6ff,stroke:#2563eb,color:#111827,stroke-width:1.5px;
classDef clarify fill:#fff7ed,stroke:#f97316,color:#111827,stroke-width:1.5px;
classDef route fill:#fff7ed,stroke:#ea580c,color:#111827,stroke-width:1.5px;
classDef decision fill:#ecfeff,stroke:#0891b2,color:#111827,stroke-width:1.5px;
classDef tool fill:#cffafe,stroke:#0e7490,color:#111827,stroke-width:1.5px;
classDef spec fill:#f5f3ff,stroke:#7c3aed,color:#111827,stroke-width:1.5px;
classDef doc fill:#ecfdf5,stroke:#10b981,color:#111827,stroke-width:1.5px;
classDef preview fill:#ecfdf5,stroke:#16a34a,color:#111827,stroke-width:1.5px;
classDef runtime fill:#f8fafc,stroke:#64748b,color:#111827,stroke-width:1.5px;
classDef danger fill:#fff1f2,stroke:#ef4444,color:#111827,stroke-width:1.5px;
classDef feedback fill:#fff1f2,stroke:#ef4444,color:#111827,stroke-width:1.5px;
classDef fallback fill:#fee2e2,stroke:#dc2626,color:#111827,stroke-width:1.5px;
classDef artifact fill:#dcfce7,stroke:#16a34a,color:#111827,stroke-width:2px;
classDef qa fill:#f8fafc,stroke:#475569,color:#111827,stroke-width:1.5px;
classDef gate fill:#fffbeb,stroke:#d97706,color:#111827,stroke-width:2px;
classDef ledger fill:#ccfbf1,stroke:#0f766e,color:#0f172a,stroke-width:2px;
classDef companion fill:#ccfbf1,stroke:#0f766e,color:#0f172a,stroke-width:1.5px;

%% ===== 图例样式（描边=对应线色）=====
classDef pBlue fill:#eff6ff,stroke:#2563eb,color:#0f172a,stroke-width:3px;
classDef pOrange fill:#fff7ed,stroke:#ea580c,color:#0f172a,stroke-width:3px;
classDef pPurple fill:#f5f3ff,stroke:#7c3aed,color:#0f172a,stroke-width:3px;
classDef pGreen fill:#ecfdf5,stroke:#16a34a,color:#0f172a,stroke-width:3px;
classDef pGray fill:#f8fafc,stroke:#64748b,color:#0f172a,stroke-width:3px;
classDef pRed fill:#fff1f2,stroke:#ef4444,color:#0f172a,stroke-width:3px;
classDef pLedger fill:#ccfbf1,stroke:#0f766e,color:#0f172a,stroke-width:3px;
classDef pShell fill:#ecfeff,stroke:#0d9488,color:#0f172a,stroke-width:3px;

%% ===== 连线着色（按声明顺序，分段对应路径）=====
linkStyle 0,1,2,3,4,5,6,7,8,9,10,11,12,13,14 stroke:#2563eb,stroke-width:2.5px;
linkStyle 15,16,17,18,19,20 stroke:#ea580c,stroke-width:2.5px;
linkStyle 21,22,23,24,25,26,27,28 stroke:#7c3aed,stroke-width:2.5px;
linkStyle 29,30,31,32,33,34,35,36,37,38,39,40 stroke:#16a34a,stroke-width:2.5px;
linkStyle 41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60 stroke:#64748b,stroke-width:1.8px,stroke-dasharray:5 4;
linkStyle 61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92 stroke:#ef4444,stroke-width:1.8px,stroke-dasharray:6 4;
linkStyle 93,94,95,96,97,98,99,100 stroke:#0f766e,stroke-width:2.5px,stroke-dasharray:4 3;
linkStyle 101,102,103,104,105,106,107,108,109,110,111 stroke:#0f766e,stroke-width:2px,stroke-dasharray:4 3;
linkStyle 112,113,114,115 stroke:#db2777,stroke-width:2px,stroke-dasharray:3 3;
linkStyle 116,117,118 stroke:#dc2626,stroke-width:2px,stroke-dasharray:3 3;
linkStyle 119,120,121 stroke:#0d9488,stroke-width:2px,stroke-dasharray:4 3;
```

## v4.1 这一版加了什么（相对 v4）

只补一个洞:**生成的每页 UI 预览,左菜单和 Header 各长各的样**——根因是每页独立调生图模型,而生图模型记不住"重复结构",每次都重画一套外壳。

- **新增 `EP_SHELL` 应用外壳·设计系统(▣)**:左菜单**由规格树派生**(它本来就是你的模块列表)、Header 是**产品常量**,加上颜色 token 和栅格,**确定性渲染**成一套统一外壳——不交给生图模型。
- **`EP_VIS_GEN` 改为只填内容区**:外壳被 `EP_SHELL` 锁定,生图模型只画中间内容,不再每页瞎编 menu/header。
- **`EP_VIS_AUDIT` 加查外壳一致性**:出图审计在原来揪兜底/假成功/复制之外,再比一道"每页的 menu/header 是不是同一套"。

改动范围:只在 S6 加 1 个节点(`EP_SHELL`)、给 `EP_VIS_GEN`/`EP_VIS_AUDIT` 各加一行标签、末尾追加 3 条线(119–121,蓝绿虚线)。**原 0–118 条线的编号和配色一根没动**,你那张 V4 还是原来的样子,只是多了一条"外壳确定性"的细线。

一句话:**结构归确定性渲染,感觉才归生图模型——这本就是你 v2 定下的分流原则,v4.1 只是把漏过去的"外壳"收回到确定性这边。**

## v4.2 这一版加了什么（相对 v4.1）

承接 v4.1 的外壳一致性,再把**尺寸/宽高比**也收进规范——同一个病根:每次生成自由发挥,连画布都各长各的。

先纠正技术前提:**生图模型只吐固定几档尺寸**(常见 1024×1024 / 1024×1536 / 1536×1024,以你的 API 允许值为准),拿不到直出的 1920×1080 或 2560×1440。所以这些是**导出画布**,由确定性那步缩放补边得到,不是"问模型要"。

规范分两层,并进 `EP_SHELL`:

| 设备类 | 逻辑宽高比 | 导出画布(像素) | 生图就近档位 → 确定性缩放/补边 |
|---|---|---|---|
| Web / 桌面 | 16:9 | 1920×1080(默认) · 2560×1440(2K @hi-dpi) | 1536×1024(就近横版) → 缩放到画布 |
| 移动 / 竖屏 | 9:19.5(现代机) 或 9:16(简化) | 1080×2340 或 1080×1920 | 1024×1536(就近竖版) → 缩放/裁切 |
| 平板 | 4:3 / 3:4 | 2048×1536 / 1536×2048 | 1536×1024 或 1024×1536 → 缩放 |

(你记的没错:1920×1080 = 1080p/FHD,2560×1440 = 2K/QHD。)

落地两条路:
- **生图路**:每页带上"设备视口"参数,选最接近的模型档位出图,再由确定性步缩放/letterbox 到画布。同一设备类,画布永远一致。
- **HTML 外壳路(更省)**:外壳与合成都是 CSS,画布由代码精确给定,直接就是 1920×1080 / 2K,无需缩放补边。

改动范围:**只改了 `EP_SHELL` 和 `EP_VIS_GEN` 两个节点的 label,没加节点、没加线**。原 0–121 条线(含 v4.1 的 119–121)编号与配色全部不动。

一句话:**宽高比按设备类定死、画布尺寸归确定性那步——和外壳一致性是同一条原则:凡是"重复且应统一"的,都不交给生图模型自由发挥。**