# Requirements Document

## Introduction

本规格聚焦于提升 Web 前端 SPEC 树生成流程的**感知性能（perceived performance）**与**状态一致性（state consistency）**，使其在用户主观体验上更接近离线 Skill 产物（`whybuddy_scm_phase1/`、`skills/whybuddy/` 下的 `spec_tree.json` / `route_options` / 预览 PNG）那种"丝滑"的即时感。

背景与根因（已分析，不在本规格内重新调查）：

1. **性质差异**：Skill 产物是预生成静态文件（瞬时、无异步、无失败态），而 Web 前端在用户点击"生成"时会发起真实 LLM 调用（`generateBlueprintSpecDocuments` → 服务端 `buildSpecTreeFromRouteSet`），耗时数秒到数十秒，并叠加 socket 事件、快照轮询与 fallback 路径。
2. **弱感知性能设计**：当前规范路径虽然有 loading 状态，但只是按钮文案翻转（"生成中…"）+ disabled，没有骨架屏、没有进度指示、没有流式占位。对于长 LLM 调用，这会让界面看起来"卡死 / 无响应"。
3. **架构碎片化 + 多跳投影**：存在多个并行的 spec-tree 实现（新版 `SpecTreeWorkbench`、遗留 `SpecTreeWorkbenchPanel`、re-export shim `SpecTreePanel`），不同入口命中不同实现，loading / 反馈语义不一致；状态需经 `job → projectJobForAutopilotPage → rightRailView → 组件` 多跳传播，外加 `pollJobUntilSpecTree` 轮询异步快照，导致点击与可见变化之间出现延迟与闪烁。

本规格的目标是**改善体验与一致性**，而不是重写生成链路。明确不做：不引入第二套 job / spec 状态真相源、不改服务端生成契约、不改 `/tasks` 深链、不重做设计系统。

本规格遵循项目既有 compatibility-first 原则：在现有 React 19 + Zustand + TypeScript 主干上做前端 UX 与状态一致性增强。

## Glossary

- **生成触发器 (Generation_Trigger)**：用户在 SPEC 树工作台上发起生成动作的交互元素，包括"生成整棵树文档"主 CTA、"生成当前节点文档"次 CTA，以及相关的"进入效果预演"等生成类按钮。
- **SPEC 树工作台 (Spec_Tree_Workbench)**：渲染 SPEC 树节点行、双 CTA 与节点预览的前端组件族，包括规范实现 `SpecTreeWorkbench`、遗留实现 `SpecTreeWorkbenchPanel` 与 re-export shim `SpecTreePanel`。
- **生成状态机 (Generation_State_Machine)**：描述单次生成请求生命周期的有限状态集合，取值为 `idle`（空闲）、`pending`（已触发未返回）、`success`（成功）、`failure`（失败）、`empty`（成功但结果为空）。
- **进度反馈层 (Progress_Feedback_Layer)**：在 `pending` 状态下向用户呈现进行中信号的 UI 机制，包括骨架屏、进度指示、流式占位与文案，区别于单纯的按钮文案翻转。
- **进行中锁 (In_Flight_Lock)**：父级（`AutopilotRightRail` 的 `triggerSpecDocsGeneration`）持有的并发控制状态，标记当前是否存在 `all` / `single` 范围的生成请求未完成。
- **乐观反馈 (Optimistic_Feedback)**：在用户点击 Generation_Trigger 后、服务端响应返回前，立即呈现的本地 UI 状态变化，用于消除点击与可见变化之间的延迟感。
- **投影层 (Projection_Layer)**：把后端 job 状态传递到组件的多跳数据通路，包括 `projectJobForAutopilotPage`、`rightRailView`（`useAutopilotRightRailData`）与 `pollJobUntilSpecTree` 轮询。
- **状态真相源 (State_Source_Of_Truth)**：job / specTree / specDocuments 状态的权威来源；当前由 `latestJob` 与 `rightRailView` 派生层承担。
- **AppLocale (Locale)**：界面语言设置，取值 `zh-CN` 或 `en-US`，决定反馈文案语言。

## Requirements

### Requirement 1: 生成触发即时反馈

**User Story:** 作为发起 SPEC 树生成的用户，我希望点击生成按钮后立即看到清晰的"进行中"反馈，这样我才知道系统已经接收到我的操作并正在工作，而不是怀疑界面卡死。

#### Acceptance Criteria

1. WHEN 用户点击任一 Generation_Trigger，THE Spec_Tree_Workbench SHALL 在触发该点击的同步事件处理过程内（即浏览器绘制下一帧之前）将 Generation_State_Machine 由 `idle` 切换为 `pending`，且不等待服务端响应或投影层传播
2. WHILE Generation_State_Machine 处于 `pending`，THE Progress_Feedback_Layer SHALL 呈现区别于 `idle` 外观、且超出按钮文案翻转的进行中信号，该信号至少包含骨架占位或动态进度指示之一
3. WHILE Generation_State_Machine 处于 `pending`，THE Spec_Tree_Workbench SHALL 将所有 `all` 范围与 `single` 范围的 Generation_Trigger 同时设为 disabled 状态以阻止重复提交
4. WHEN 用户点击 Generation_Trigger 后 100 毫秒内，THE Spec_Tree_Workbench SHALL 至少呈现一次可见的 UI 状态变化，且该变化为 Progress_Feedback_Layer 进行中信号的出现或 Generation_Trigger 转入 disabled 外观之一
5. IF 在 Generation_State_Machine 处于 `pending` 期间用户再次点击同一 Generation_Trigger，THEN THE Spec_Tree_Workbench SHALL 忽略该次点击、保持 Generation_State_Machine 当前状态不变且不发起新的生成请求
6. IF 在 Generation_State_Machine 处于 `pending` 期间用户点击与当前进行中请求范围不同的另一 Generation_Trigger，THEN THE Spec_Tree_Workbench SHALL 经由 In_Flight_Lock 拒绝该次点击且不发起新的生成请求，直至当前请求结束

### Requirement 2: 成功、失败与空结果状态的明确反馈

**User Story:** 作为发起生成的用户，我希望每一次生成都有明确的成功、失败或空结果反馈，这样我才能判断下一步该做什么，而不是面对一个翻回原样、看不出结果的按钮。

#### Acceptance Criteria

1. WHEN `all` 范围生成请求成功返回，THE Spec_Tree_Workbench SHALL 将 Generation_State_Machine 切换为 `success` 并渲染完整 SPEC 树文档内容
2. WHEN `single` 范围生成请求成功返回，THE Spec_Tree_Workbench SHALL 将 Generation_State_Machine 切换为 `success` 并渲染目标节点文档内容
3. IF 生成请求失败且服务端返回了失败原因，THEN THE Spec_Tree_Workbench SHALL 将 Generation_State_Machine 切换为 `failure` 并通过 toast 通道呈现可读的失败原因
4. IF 生成请求失败且服务端未返回失败原因，THEN THE Spec_Tree_Workbench SHALL 将 Generation_State_Machine 切换为 `failure` 并通过 toast 通道呈现与当前 Locale 一致的通用失败兜底文案
5. WHILE Generation_State_Machine 处于 `failure`，THE Spec_Tree_Workbench SHALL 持续呈现失败反馈直至用户主动关闭该反馈或发起重试
6. IF 生成请求失败，THEN THE Spec_Tree_Workbench SHALL 在反馈中提供重试入口，使对应范围的 Generation_Trigger 恢复为 enabled 状态
7. WHEN 用户经由失败反馈的重试入口触发重试，THE Spec_Tree_Workbench SHALL 以与失败请求相同的范围重新发起生成并将 Generation_State_Machine 切换回 `pending`
8. WHEN 生成请求成功返回但该 scope 下不包含任何节点文档，THE Spec_Tree_Workbench SHALL 将 Generation_State_Machine 切换为 `empty` 并呈现空结果说明文案
9. WHEN Generation_State_Machine 由 `pending` 切换为 `success`、`failure` 或 `empty`，THE Progress_Feedback_Layer SHALL 在该状态转换的同一渲染帧内停止呈现进行中信号
10. THE Spec_Tree_Workbench SHALL 使用与当前 Locale（`zh-CN` 或 `en-US`）一致的语言呈现 `success`、`failure`（含失败 toast）与 `empty` 三种结果状态文案
11. IF Generation_State_Machine 切换为 `failure` 或 `empty`，THEN THE Spec_Tree_Workbench SHALL 保留先前已渲染的 SPEC 树或节点文档内容而不将其清空

### Requirement 3: 跨工作台实现的反馈语义一致性

**User Story:** 作为可能从不同入口进入 SPEC 树的用户，我希望无论命中哪个工作台实现，生成反馈的行为都是一致的，这样我的体验不会因为内部实现差异而割裂。

#### Acceptance Criteria

1. WHERE `SpecTreeWorkbench`、`SpecTreeWorkbenchPanel` 与 `SpecTreePanel` 三个实现并存，THE Spec_Tree_Workbench SHALL 对相同范围（`all` 或 `single`）的生成动作呈现相同的 Generation_State_Machine 状态取值集合（`idle`/`pending`/`success`/`failure`/`empty`）与相同的状态转换序列
2. WHEN 任一 Spec_Tree_Workbench 实现的 Generation_Trigger 被触发，THE 该实现 SHALL 经由父级 `AutopilotRightRail.triggerSpecDocsGeneration` 持有的统一 In_Flight_Lock 控制并发，且不维护各自独立的并发标志
3. WHERE 某 Spec_Tree_Workbench 实现为 re-export shim（`SpecTreePanel`），THE 该 shim SHALL 完全转发到规范实现 `SpecTreeWorkbench`，且不实现独立的 Generation_State_Machine 或 Progress_Feedback_Layer
4. WHILE 任一 Spec_Tree_Workbench 实现的 Generation_State_Machine 处于 `pending`，THE 该实现 SHALL 呈现 Requirement 1 所定义的进行中信号（骨架占位或进度指示）
5. IF 用户点击某一已被 In_Flight_Lock 标记为进行中的范围所对应的 Generation_Trigger，THEN THE Spec_Tree_Workbench SHALL 忽略该次点击且不发起新的生成请求

### Requirement 4: 降低点击到可见变化的感知延迟

**User Story:** 作为发起生成的用户，我希望点击与界面响应之间没有明显的延迟或闪烁，这样整个流程在主观上是连贯顺滑的。

#### Acceptance Criteria

1. WHEN 用户点击 Generation_Trigger，THE Spec_Tree_Workbench SHALL 在触发该点击的同一渲染帧内（不晚于 100 毫秒）呈现 Optimistic_Feedback，且不等待 Projection_Layer（`projectJobForAutopilotPage` → `rightRailView` → `pollJobUntilSpecTree`）完成任一跳传播
2. WHILE 生成请求处于 `pending` 且 Projection_Layer 尚未传播新状态，THE Spec_Tree_Workbench SHALL 在每一渲染帧持续呈现 Progress_Feedback_Layer，且在任意快照轮询间隔内均不回退到 `idle` 外观
3. WHEN Projection_Layer 完成新 job 状态传播，THE Spec_Tree_Workbench SHALL 由 Progress_Feedback_Layer 过渡到结果内容，且不存在任何呈现 `idle` 或空白占位的中间渲染帧
4. IF Projection_Layer 的快照轮询（`pollJobUntilSpecTree`）返回的 job 尚未到达 `success`/`failure`/`empty` 终态、或返回的快照缺少 `specTree` 与 `specDocuments` 字段，THEN THE Spec_Tree_Workbench SHALL 将其判定为中间态、保持 `pending` 呈现，且不将其误判为 `empty` 或 `idle`
5. IF Projection_Layer 的快照轮询在 60 秒（60000 毫秒）内未取得可用结果，THEN THE Spec_Tree_Workbench SHALL 结束 Optimistic_Feedback、将 Generation_State_Machine 切换为 `failure`，并使对应范围的 Generation_Trigger 恢复为 enabled 状态
6. IF 快照轮询返回错误或快照无法解析，THEN THE Spec_Tree_Workbench SHALL 将 Generation_State_Machine 切换为 `failure` 而不停留在 `pending`

### Requirement 5: 单一状态真相源

**User Story:** 作为维护者，我希望感知性能增强不引入第二套 job / spec 状态来源，这样不会出现状态分叉、数据不一致或难以调试的问题。

#### Acceptance Criteria

1. THE Spec_Tree_Workbench SHALL 仅从既有 State_Source_Of_Truth（`latestJob` 与 `rightRailView` 派生层）读取 job、specTree 与 specDocuments 状态，且不维护这些业务数据的第二份独立副本
2. THE Progress_Feedback_Layer SHALL 仅持有渲染所需的瞬态本地 UI 状态（限于骨架屏可见性、进度指示进度值、动画计时与 `pending` 文案），且不持久化 job 或 spec 业务数据，也不向 State_Source_Of_Truth 回写或被其他组件作为业务数据真相源读取
3. WHEN 生成请求成功返回，THE Spec_Tree_Workbench SHALL 经由既有 `onSpecDocumentsGenerated` 回调将结果回写到 State_Source_Of_Truth
4. WHEN State_Source_Of_Truth 完成权威状态更新，THE Spec_Tree_Workbench SHALL 在同一渲染帧内以权威状态取代 Optimistic_Feedback，使 Optimistic_Feedback 与权威状态并存时间不超过一个渲染帧
5. IF 生成结果回写 State_Source_Of_Truth 后未在 60 秒（60000 毫秒）内被权威状态确认，THEN THE Spec_Tree_Workbench SHALL 结束 Optimistic_Feedback、将 Generation_State_Machine 切换为 `failure`、通过 toast 通道呈现超时失败原因，并保留 State_Source_Of_Truth 既有数据不被部分写入污染
6. IF `onSpecDocumentsGenerated` 回调回写 State_Source_Of_Truth 失败，THEN THE Spec_Tree_Workbench SHALL 结束 Optimistic_Feedback、将 Generation_State_Machine 切换为 `failure`、通过 toast 通道呈现失败原因，且不在 State_Source_Of_Truth 中留下部分写入的结果
