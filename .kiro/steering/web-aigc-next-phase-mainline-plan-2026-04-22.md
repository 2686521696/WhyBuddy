# Web-AIGC 下一阶段主线计划

更新时间：2026-04-23

## 主线基线声明

进入本阶段前，先明确一个统一口径：

- `58 / 58` 份 `web-aigc` specs 已全部完成
- `238 / 238` 个顶层任务已全部勾选完成
- spec 完成度已经封板，后续不再把“再完成多少份 spec”作为主线目标

因此，这份计划不是新的 spec 计划，而是基于既有 specs 基线继续推进主仓增强的主线计划。

## 当前收口结果

当前主线已经完成以下动作，并可作为下一阶段起点：

- 把 `risk-actions` 的命名空间 collection、`sourceId` 作用域、路由状态码和测试补齐到本地 `main`
- 把 `platform-b` 的 `mission / workflow / session / projection` 补线收回到本地 `main`
- 把 `dialogue-qa` 的 `chat / knowledge` 节点执行入口补齐到本地 `main`
- 把 `hitl-session` 的 metadata 契约、服务端决策链路和测试补齐到本地 `main`
- 把 `dialogue` runtime 的 injected `documentSearch` 接线补进主线运行时，`dialogue` 内建 adapter 可直接消费 runtime 注入的检索执行器
- 把 `mcp` runtime 的 global registration 补进共享 `web-aigc` 运行时注册表，`mcp` 节点可直接进入主线 `webAigcRuntimeEngine`
- 完成定向 `vitest` 验证与 `node --run check`
- 清理上一轮 `web-aigc` worktree，并保留必要残差备份以便追溯

## 本轮新增的主线增强

除上面的既有收口项外，本轮新增并已确认的两条主线增强如下：

1. `dialogue runtime injected documentSearch`
   - 运行时内建 `dialogue` adapter 已支持从 runtime 注入 `documentSearch` 执行器
   - `dialogue` 节点可在主线 workflow runtime 中直接发起检索增强，而不是只依赖路由层外部注入
   - 定向证据：
     - `server/core/workflow-runtime-engine.ts`
     - `server/tests/workflow-runtime-engine.test.ts`
     - 用例：`lets the runtime built-in dialogue adapter use an injected documentSearch executor`

2. `mcp runtime global registration`
   - `mcp` 已进入共享 `web-aigc` runtime extra adapters 注册表
   - 通过 `registerWebAigcRuntimeExtraAdapters({ executeMcp })` 可把 `mcp` 节点接入 `webAigcRuntimeEngine`
   - 定向证据：
     - `server/core/web-aigc-runtime-extra-adapters.ts`
     - `server/index.ts`
     - `server/tests/workflow-runtime-engine.test.ts`
     - 用例：`can register mcp runtime execution through the shared global adapter registry`

## 下一阶段目标

下一阶段统一转入“主仓主线增强模式”：

1. 以 `main` 为唯一集成主线，减少多分支和多 worktree 残差继续累积
2. 对尚未完全收口的 `platform-c / tools-and-agents / risk-actions / controlflow / platform-a` 热区做对账式补差
3. 把已经进入主仓的 `workflow runtime / mission projection / audit governance / node adapters` 打通为更稳定的主线闭环
4. 逐步把前端 HITL、监控面板、Office 上下文面板和任务面板统一到同一套 runtime 语义

这里的“下一阶段目标”强调的是主线能力增强，而不是 spec 数量继续增长。

并且从当前基线开始，`dialogue` 的检索增强接线与 `mcp` 的 runtime 全局注册都已经算作已完成的主线前置能力，后续关注点转为稳定性、治理一致性与更大范围对账。

## 优先级顺序

### P0：主仓稳定性与治理补线

- 收口 `platform-c`：权限治理、审计事件、策略门禁
- 收口 `tools-and-agents`：`a2a / auto_agent / internal_api / guest-agents / skills`
- 收口 `risk-actions`：继续和 `server/index.ts`、RAG 初始化、治理钩子对账

### P1：图运行时与控制流主干

- 继续对齐 `platform-a` 与 `controlflow`
- 统一 `workflow-runtime-engine / workflow-graph-projection / workflow-domain`
- 补齐 runtime state、checkpoint、resume 的端到端回归

### P2：交互链路与前端闭环

- 收口 `hitl-session` 前端差异
- 回收 `DecisionPanel / DecisionHistory / tasks-store / mission-client`
- 把 Office 面板和 Web-AIGC 面板统一到同一套 session / projection 来源

### P3：整体验证与发布准备

- 跑更完整的服务端回归
- 检查客户端兼容面板回归
- 持续整理中文 steering 文档
- 视情况推送远端并准备下一轮主线合并

## 下一阶段执行批次

为避免再次进入“开很多 worktree 但主仓迟迟不收口”的状态，下一阶段继续采用 `main` 主线批次推进，按下面 4 个批次执行：

### 批次 A：治理与门禁补齐

目标是先把高风险能力依赖的审计、权限、回放门禁补完整，再放开后续热区接入。

- 补齐 `platform-c` 中 `audit / permissions / lineage / replay` 的主仓实现与测试
- 对齐 `server/routes/*` 中与治理能力相关的挂载入口
- 统一高风险动作的事件命名、审计字段和拒绝原因结构

完成标准：

- 高风险节点接入前，已有统一 permission check 和 audit trail

### 批次 B：工具与外部调用主干

目标是把 `tools-and-agents` 这条主干先收拢成可控接口，而不是继续分散在不同适配层中。

- 对账 `a2a / auto_agent / internal_api / guest-agents / skills`
- 明确工具调用的输入输出契约、错误结构和宿主能力边界
- 统一消息通知、内部 API、外部代理调用的治理钩子

完成标准：

- 工具调用链路全部能挂到统一 runtime 和治理链路下

### 批次 C：运行时与控制流归并

目标是把 `platform-a` 与 `controlflow` 热区收回到统一 runtime 语义中，减少后续节点接入时反复改内核。

- 统一 `workflow-runtime-engine / workflow-graph-projection / workflow-domain`
- 补齐 `checkpoint / resume / transition / branch / loop` 的主仓回归
- 对齐控制流节点在 graph execution record 中的状态表达

完成标准：

- 至少一条带条件分支和恢复能力的图链路可稳定回放

### 批次 D：HITL 与 Office 面板闭环

目标是把前端交互层和主仓 runtime 投影打通，形成可演示闭环，而不是只有服务端接口到位。

- 回收 `DecisionPanel / DecisionHistory / tasks-store / mission-client` 差异
- 统一 Office 面板、监控面板、任务面板的 session / projection 来源
- 校验人工确认、恢复执行、状态刷新在前端链路中的一致性

完成标准：

- HITL 决策链路可从界面发起、回写、恢复，并在监控面板中看到

## 批次执行顺序

建议按 `A -> B -> C -> D` 推进，其中：

- `A` 是 `B` 和高风险节点继续推进的前置条件
- `B` 和 `C` 可以局部交错推进，但最终都要落回统一 runtime 契约
- `D` 放在后面，是为了避免前端先固化一套和主仓不一致的语义

## 主仓推进规则

从这一阶段开始，默认采用以下规则：

- 不再为单个 spec 长时间保留独立 worktree
- 不再把“新增 spec 数量”作为主线进度指标
- 新改动优先直接在 `main` 上按小批次收口
- 每个批次先补测试，再改热文件
- 每个批次结束都要留下可复核的通过项：测试、中文文档、主仓提交、闭环能力说明
- 已经进入主线基线的增强项，需要在 steering 中明确写明“能力名称 + 接线位置 + 定向测试证据”
- 进度统计不再看“还有多少 worktree”，而看 `main` 上已经通过验证的提交与能力闭环

## 验收口径

下一阶段是否推进成功，统一按下面标准判断：

- 是否新增了主仓可验证的能力闭环
- 是否减少了 runtime、治理和工具调用上的双轨语义
- 是否补齐了高风险动作依赖的权限、审计、回放链路
- 是否让 HITL、监控面板、Office 面板逐步使用同一套主线数据来源

明确不再采用下面这些口径作为主要判断标准：

- 又新增了多少份 spec
- 又新增了多少份任务清单
- 还保留了多少个 worktree

## 备注

- 上一轮清理前，所有 `web-aigc` worktree 的脏内容都已单独备份到本地目录，便于后续追溯
- 下一阶段默认不再依赖“看 worktree 是否还在”来判断进度，而以 `main` 分支中的已验证提交为准
