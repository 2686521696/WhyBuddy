# Office / Launch / Tasks 前端闭环复核（2026-04-22）

## 结论

这批前端改动已经把 `Office / Launch / Tasks` 的 `web-aigc` 入口与状态面板基本接通，形成了当前可用的前端闭环：

- 统一发起入口已经收敛到 Office 主壳里的单一中央发起器
- 快速任务、补问、附件型 workflow 发起都能回流到任务焦点或 workflow 上下文
- Tasks 页面已经降级为只读跟进页，不再与 Office 争夺发起入口
- Office 右侧上下文与历史面板已经能展示 workflow、`web-aigc` 兼容监控以及 graph runtime 兼容快照

但这份结论仍然是“前端投影层闭环已基本打通”，不是“所有 runtime 真相源已经完全统一”：

- 现阶段更多是 UI 入口、状态投影和导航回流已经接通
- 后端 session / projection / graph runtime 的统一语义，仍需按平台主线继续收口

## 一、入口是否已经接通

### 1. Office 已成为统一发起入口

`client/src/components/office/OfficeTaskCockpit.tsx` 已将 `UnifiedLaunchComposer` 作为中央唯一发起器接入，并处理两类回流：

- `onTaskResolved`
  - 通过 `handleTaskHubResolved()` 调用 `resolveTaskHubLocationUpdate()`
  - 自动聚焦到新建 mission
  - 必要时清空当前筛选并高亮新任务
- `onWorkflowResolved`
  - 先写入 `pendingLaunch`
  - 等待 workflow 与 mission 建链后自动切回任务 tab 并选中新任务

同时，右侧 `Launch` tab 已不再承载第二套输入框，而是收敛为说明区。实现里明确写到：

- “中央底部保持唯一发起输入”
- “补问改为独立弹层承接”
- “右侧只保留发起说明，避免同一个页面出现两套发起草稿和附件状态”

### 2. UnifiedLaunchComposer 已具备三种主路径

`client/src/components/launch/UnifiedLaunchComposer.tsx` 当前已具备：

- `mission`
  - 直接创建 mission
  - 回调 `onTaskResolved`
- `clarify`
  - 发起补问
  - 通过 `submitUnifiedClarification()` 在回答完成后继续创建 mission
- `workflow`
  - 走高级编排 / workflow 通道
  - 回调 `onWorkflowResolved`

并且支持：

- 附件上传与预处理
- 前端预览 / 高级执行模式切换提示
- 当前焦点任务下的操作 rail 联动

因此，从发起入口设计上看，Office 已经是统一入口，而不是“Office 一套、Tasks 一套、Workflow 一套”并存。

## 二、Tasks 是否已经和 Office 分工清楚

### 1. TasksPage 已明确降级为只读跟进页

`client/src/pages/tasks/TasksPage.tsx` 的文案和布局都已经明确说明：

- 任务页只负责展示队列、任务详情和执行轨迹
- 发起与补充信息入口统一留在 Office 首页
- 当前页是 “display-only / read-only for viewing and follow-up”

这说明 Office 与 Tasks 的职责边界已经被显式收束：

- Office：负责发起、澄清、workflow 过渡与上下文编排
- Tasks：负责队列查看、任务跟进、操作和执行轨迹展示

### 2. TaskDetailPage 也改为运行证据承接位

`client/src/pages/tasks/TaskDetailPage.tsx` 现在保留的是：

- 任务详情查看
- 决策与操作提交
- replay 跳转
- 运行证据 handoff 提示
- `deferRuntimeEvidence`

这表示详情页不再承担 launch 入口，而是承接 runtime evidence 的延迟展示与后续检查。

## 三、状态面板是否已经接通

### 1. Office Flow 面板已接 workflow 主上下文

`client/src/components/office/OfficeWorkflowContextPanels.tsx` 里的 `OfficeWorkflowFlowPanel` 已展示：

- workflow directive / status / current stage
- organization / departments / nodes
- 输入附件数
- work packages
- graph instance 汇总信息

这已经不只是“workflow 是否存在”，而是把 workflow 组织与执行摘要带进了 Office 右栏。

### 2. History 面板已接 `web-aigc` 兼容监控

同文件里的 `OfficeWorkflowHistoryPanel` 已连接：

- `currentWorkflowMonitoringInstance`
- `currentWorkflowMonitoringSession`
- `monitoringInstances`

并展示：

- `web-aigc compatibility monitor`
- orchestration 信息
- executor / sourceApp / category
- projection links
  - workflowId
  - missionId
  - sessionId
  - replayId
  - auditId
- 节点执行快照
- 最近 session 消息

这说明 Office 右栏已经不是只看 Cube workflow，而是已经把 `web-aigc` 兼容监控投影接了进来。

### 3. Graph runtime compatibility 面板已接 graph snapshot

同一文件还使用了 `currentWorkflowGraphInstance`，展示：

- runtime status
- total nodes
- edge transitions
- waitingFor
- graph node preview

这说明 graph runtime 的前端状态面板也已经进入 Office 历史 / 兼容区域，而不是完全停留在平台底层不可见。

## 四、自动回流是否已经形成闭环

### 1. mission 发起后能回到任务焦点

`OfficeTaskCockpit.tsx` 在 `handleTaskHubResolved()` 中使用
`client/src/pages/tasks/task-hub-location.ts` 的 `resolveTaskHubLocationUpdate()`：

- 如果新 mission 不在当前筛选结果里，会清空搜索
- 会聚焦到 mission
- 会高亮该 mission

这意味着“统一发起 -> 新任务落入队列 -> 自动聚焦任务”的 UI 闭环已经具备。

### 2. workflow 发起后能回到任务焦点

`OfficeTaskCockpit.tsx` 对 workflow 路径采用了：

1. 先记录 `pendingLaunch`
2. 自动切到当前 workflow
3. 轮询 `fetchWorkflows()` 与 `fetchWorkflowDetail()`
4. 一旦拿到 `missionId`，自动：
   - 清空 `pendingLaunch`
   - 切到 `task` tab
   - `selectTask(linkedMissionId)`

这意味着“附件 / 高级发起 -> workflow 准备 -> mission 建链 -> 回落任务焦点”的闭环已经在前端实现。

## 五、已有测试证据

本次复核除了阅读实现，也做了最小前端回归验证。

已通过的测试：

- `client/src/components/office/OfficeTaskCockpit.test.tsx`
- `client/src/components/office/OfficeWorkflowContextPanels.test.tsx`
- `client/src/components/launch/__tests__/UnifiedLaunchComposer.test.ts`

执行命令：

```bash
npm exec vitest run client/src/components/office/OfficeTaskCockpit.test.tsx client/src/components/office/OfficeWorkflowContextPanels.test.tsx client/src/components/launch/__tests__/UnifiedLaunchComposer.test.ts
```

通过点包括：

- `OfficeTaskCockpit` 只有一个中央 `UnifiedLaunchComposer`
- 澄清被验证为独立弹层，而不是右栏第二套发起区
- `OfficeWorkflowContextPanels` 已验证渲染 graph runtime compatibility 与 `web-aigc compatibility monitor`
- `UnifiedLaunchComposer` 已验证 mission / clarify / workflow / upgrade-required 四类文案与辅助逻辑

## 六、当前仍未完全收口的点

虽然前端闭环基本成立，但还不能把它表述成“平台全链路已经完全统一”，原因主要有三点：

1. 当前接通的重点仍是 UI 入口与状态投影
   - 并不自动证明所有后端 runtime 数据来源已经完全单源统一

2. `TasksPage` 与 `TaskDetailPage` 目前是“让出入口、承接查看与 evidence”
   - 这是正确的收束方向
   - 但是否还需要补更多跨页导航、筛选和手动回归，要看后续主线验收

3. Office 里的 graph runtime / compatibility monitor 目前是“可见化与兼容映射”
   - 后续还需要继续和平台级 session / projection / audit 语义对齐

## 七、复核结论

如果问题是：

- “Office / Launch / Tasks 的 `web-aigc` 入口是否已经统一到 Office？”
  - 结论：是，前端上已经基本统一

- “状态面板是否已经能看到 workflow、`web-aigc` 兼容监控和 graph runtime？”
  - 结论：是，Office 右栏已具备

- “这是否已经代表平台全链路完全收口？”
  - 结论：还不能这么说，更准确的说法是：
    - 前端入口与状态面板闭环已经基本打通
    - 平台 runtime 真相源统一仍需继续推进
