# Web-AIGC 第二阶段集成计划

更新时间：2026-04-23

## 文档目标

本文件用于明确 `web-aigc` 的第二阶段推进口径：

- 第一阶段已经完成 `58 / 58` 份 specs 的定义、实现与任务收口
- 第二阶段不再以“继续完成 specs”为目标
- 第二阶段的目标改为“基于既有 specs 基线，继续推进主仓主线增强、治理补线、运行时归并和前端闭环”

换句话说，这份文档管理的是主线增强计划，不再是 spec 完成度计划。

## 当前基线

截至本版，`web-aigc` 已经具备下面这条明确的基线：

- `58 / 58` 份 specs 已全部完成
- `238 / 238` 个顶层任务已全部勾选完成
- 一批关键节点、路由和 runtime extra adapters 已完成主线接线
- 主仓库已经吸收了一部分平台底座、监控兼容、RAG 兼容、多模态输出、controlflow 和任务投影能力

当前主仓库已落盘并可作为第二阶段前置基线的能力主要包括：

- Office / History 面板中的 `web-aigc` 兼容监控视图
- `workflow-store` 对监控实例、监控会话、终止动作的兼容接线
- `auto-agent`、`risk-actions` 的部分服务端兼容改动
- `platform-a` 的统一 `workflow-domain / runtime-engine / graph-status` 语义
- `platform-b` 的 mission projection、task projection、session 只读接口
- `dialogue` 运行时已支持注入式 `documentSearch` 执行器，内建 dialogue adapter 可直接在 workflow runtime 中触发检索增强
- `mcp` 已完成 runtime 全局注册，`mcp` 节点可以通过共享 `web-aigc` adapter registry 进入主线运行时执行
- `multimodal-output` 的 OCR provider 与 vision output 下载能力
- `content-processing` 的 Web-AIGC RAG 兼容搜索 adapter
- `controlflow` 的图投影 adapter 与 `control_flow` 边类型兼容

因此，第二阶段的真实问题已经不是“spec 是否写完”，而是“如何把这些既有能力持续收口到 `main` 主线，并增强成稳定的可验证闭环”。

## 第二阶段定义

第二阶段统一按“主线增强”来理解，重点关注下面四类工作：

1. 治理与门禁补线
2. 工具与外部调用主干收口
3. 运行时与控制流归并
4. HITL、监控面板与 Office 的前后端闭环

明确排除项：

- 不再以“新增多少份 spec”作为阶段目标
- 不再以“spec 勾选数继续增长”作为进度判断标准
- 不再把“开多少 worktree”当作推进结果本身

## 第二阶段原则

### 1. 以 `main` 主线为中心推进

优先把可验证能力直接收口到 `main`，减少长期分支和多 worktree 残差继续累积。

### 2. 先收共享语义，再收热文件

像 `shared/*` 契约、状态映射、轻量 adapter 接口，优先于 `server/index.ts`、`server/routes/workflows.ts`、`server/routes/tasks.ts` 这种高热点文件。

### 3. 已进主仓的能力按“对账式补差”处理

对 `tools-and-agents`、`risk-actions`、监控兼容这类已经部分进入主仓库的能力，不再机械整段搬运，而是按主仓现状对账补差。

### 4. 高风险能力后置并加强验证

涉及 `server/index.ts`、RAG 初始化、权限治理、审计链、共享 mission contract 的改动，统一后置，并要求更严格的定向验证。

### 5. 第二阶段只看主线增强，不再看 spec 完成度

第二阶段的核心问题是：

- 哪些能力真正并入 `main`
- 哪些热区已经统一到同一套 runtime 契约
- 哪些治理、权限、审计、回放链路已经补齐

而不是：

- 还要不要再新增 specs
- 还有没有新的 checklist 可以继续勾选

## 当前已完成的前置收口

下面这些能力已经不再属于“待完成 spec”，而是第二阶段的已知基线：

- `dialogue`
  - 已补上 runtime injected `documentSearch`，`dialogue` 节点可在内建 runtime adapter 中直接消费 runtime 注入的检索执行器，并把 `citations / toolCalls` 投影回输出
- `mcp`
  - 已补上 runtime global registration，`registerWebAigcRuntimeExtraAdapters(...)` 可把 `mcp` 节点接入共享全局适配器注册表，不再只停留在独立路由入口
- `multimodal-output`
  - 已并入主仓，`vision-routes / ocr-provider / vision-output` 定向验证已通过
- `content-processing`
  - 已并入主仓，`rag-web-aigc-routes` 定向验证已通过
- `controlflow`
  - 已并入主仓，`workflow-graph-projection` 定向验证已通过
- `platform-b`
  - 已完成 mission / session / projection 链路底座收口与验证
- `platform-a`
  - 已完成统一 runtime / domain 语义薄切片，更高冲突热区留待第二阶段继续归并

这几块内容从现在开始不再归类为“spec 是否完成”，而归类为“主线基线已经具备，后续继续增强”。

## 第二阶段批次

### 批次 A：治理与门禁补齐

目标是先把高风险能力依赖的治理底座补完整，再放开后续热区接入。

- 收口 `platform-c` 中 `audit / permissions / lineage / replay` 的主仓实现与测试
- 对齐 `server/routes/*` 中与治理能力相关的挂载入口
- 统一高风险动作的事件命名、审计字段和拒绝原因结构

完成标准：

- 高风险节点接入前，已有统一 permission check 与 audit trail
- 治理链路不再依赖分散的临时兼容逻辑

### 批次 B：工具与外部调用主干

目标是把 `tools-and-agents` 收拢成可控主干，而不是继续分散在多个适配层中。

- 对账 `a2a / auto_agent / internal_api / guest-agents / skills`
- 明确工具调用的输入输出契约、错误结构和宿主能力边界
- 统一消息通知、内部 API、外部代理调用的治理钩子

完成标准：

- 工具调用链路能挂到统一 runtime 和治理链路下
- 不再存在多套平行但口径不一致的工具执行入口

### 批次 C：运行时与控制流归并

目标是把 `platform-a` 与 `controlflow` 热区收回统一 runtime 语义中，减少后续节点接入时反复改内核。

- 统一 `workflow-runtime-engine / workflow-graph-projection / workflow-domain`
- 补齐 `checkpoint / resume / transition / branch / loop` 的主仓回归
- 对齐控制流节点在 graph execution record 中的状态表达

完成标准：

- 至少一条带条件分支和恢复能力的图链路可稳定回放
- 运行时与图投影不再出现双轨语义

### 批次 D：HITL 与 Office 面板闭环

目标是把前端交互层和主仓 runtime 投影打通，形成可演示闭环。

- 回收 `DecisionPanel / DecisionHistory / tasks-store / mission-client` 差异
- 统一 Office 面板、监控面板、任务面板的 session / projection 来源
- 校验人工确认、恢复执行、状态刷新在前端链路中的一致性

完成标准：

- HITL 决策链路可从界面发起、回写、恢复
- 监控面板与 Office 面板看到的是同一套主线状态

## 冲突热点

以下文件仍然是第二阶段最容易出现人工冲突的热点，需要明确 ownership 与改动顺序：

- `server/index.ts`
- `server/routes/workflows.ts`
- `server/routes/tasks.ts`
- `server/routes/chat.ts`
- `server/routes/knowledge.ts`
- `server/routes/rag.ts`
- `server/routes/a2a.ts`
- `server/routes/skills.ts`
- `server/routes/guest-agents.ts`
- `server/routes/vision.ts`
- `server/core/workflow-graph-projection.ts`
- `server/core/mission-enrichment-bridge.ts`
- `shared/mission/contracts.ts`
- `shared/mission/api.ts`
- `shared/workflow-input.ts`
- `shared/audit/contracts.ts`
- `shared/permission/contracts.ts`

## 验证批次

### 验证批次 A：共享层与图投影

- `server/tests/workflow-graph-projection.test.ts`
- `shared/__tests__/workflow-domain.test.ts`
- `node --run check`

当前结论：

- 已通过。当前主仓已经覆盖统一状态映射、runtime engine 和 controlflow graph projection 的定向验证。

### 验证批次 B：多模态与内容处理

- `server/tests/vision-routes.test.ts`
- `server/tests/ocr-provider.test.ts`
- `server/tests/vision-output.test.ts`
- `server/tests/rag-web-aigc-routes.test.ts`

当前结论：

- 已通过。`multimodal-output` 与 `content-processing` 的主仓兼容层已经完成自动化验证。

### 验证批次 C：workflow runtime / mission projection

- `server/tests/workflows-routes.test.ts`
- `server/tests/workflow-runtime-engine.test.ts`
- `server/tests/mission-routes.test.ts`
- `server/tests/mission-store.test.ts`

当前结论：

- 已通过。当前主仓已经覆盖 mission projection、task projection、session 路由、workflow runtime 与图投影回归。
- 本轮新增的两条主线增强也已经有明确证据：
  - `dialogue runtime injected documentSearch`
    - `server/tests/workflow-runtime-engine.test.ts`
    - 用例：`lets the runtime built-in dialogue adapter use an injected documentSearch executor`
  - `mcp runtime global registration`
    - `server/tests/workflow-runtime-engine.test.ts`
    - 用例：`can register mcp runtime execution through the shared global adapter registry`

### 验证批次 D：治理与高风险动作

- `server/tests/permission-governance-audit-routes.test.ts`
- `server/tests/auto-agent-routes.test.ts`
- `server/tests/auto-agent-adapter.test.ts`
- `server/tests/web-aigc-risk-actions-routes.test.ts`
- `server/tests/vector-insert-adapter.test.ts`

## 当前执行决策

当前执行决策统一调整为：

1. spec 完成度维持 `58 / 58` 封板，不再作为第二阶段推进目标
2. 中文 steering 文档与进度材料统一转为“主线增强口径”
3. 本轮新增的 `dialogue runtime injected documentSearch` 与 `mcp runtime global registration` 视为已经并入第二阶段主线基线
4. 后续按 `批次 A -> 批次 B -> 批次 C -> 批次 D` 推进
5. 每个批次结束必须留下主仓可复核的通过项：实现、测试、中文文档

## 结论

第二阶段不再是“继续把 58 份 specs 做完”，因为这件事已经完成。

第二阶段真正要推进的是：

- 把既有能力继续收口到 `main`
- 把治理、工具、运行时和前端链路统一起来
- 把已完成的 specs 落成更稳定、更可验证、更可演示的主线能力
