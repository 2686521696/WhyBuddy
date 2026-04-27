<!--
 * @Author: wangchunji
 * @Date: 2026-04-27 14:56:24
 * @Description: 
 * @LastEditTime: 2026-04-27 16:15:26
 * @LastEditors: wangchunji
-->
# 任务清单

## 说明

本任务清单对应 `ui-redesign-launch-panel` spec，将当前底部固定的 `UnifiedLaunchComposer` 改造为居中浮层面板。依赖 spec 1（`ui-redesign-color-and-tokens`）和 spec 2（`ui-redesign-sidebar-navigation`）。

## 任务

- [x] 1. 创建 LaunchPanelShell 浮层壳层组件
  - [x] 1.1 创建 `client/src/components/launch/LaunchPanelShell.tsx`，实现 Portal 渲染、半透明遮罩、居中面板容器
  - [x] 1.2 实现 Framer Motion 打开/关闭动画（scale + opacity，200–300ms）
  - [x] 1.3 实现焦点陷阱（focus trap）：打开时焦点移到 textarea，Tab 键在面板内循环，Escape 关闭
  - [x] 1.4 设置 `role="dialog"`、`aria-modal="true"`、`aria-labelledby` 无障碍属性
  - [x] 1.5 实现响应式适配：桌面居中浮层（max-width 720px）、平板居中浮层（max-width 90vw）、移动端底部抽屉
  - [x] 1.6 编写 `LaunchPanelShell` 组件测试：open/close 渲染、遮罩点击关闭、Escape 关闭、焦点管理

- [x] 2. 创建 LaunchModeTabBar 模式选项卡组件
  - [x] 2.1 创建 `client/src/components/launch/LaunchModeTabBar.tsx`，定义五个模式（快速/标准/深度/研究/自定义）
  - [x] 2.2 实现模式到 `LaunchRouteCandidateId` 的映射逻辑
  - [x] 2.3 设置 `role="tablist"` / `role="tab"` / `aria-selected` 无障碍语义
  - [x] 2.4 消费 `--primary`、`--muted`、`--muted-foreground` 设计令牌
  - [x] 2.5 编写 `LaunchModeTabBar` 组件测试：默认选中快速模式、切换模式、aria 属性正确

- [x] 3. 创建 LaunchGoalInput 目标输入组件
  - [x] 3.1 创建 `client/src/components/launch/LaunchGoalInput.tsx`，实现多行 textarea 带字符计数
  - [x] 3.2 双向绑定 `useNLCommandStore` 的 `draftText` / `setDraftText`
  - [x] 3.3 实现最大字符数限制（2000）和实时字符计数显示
  - [x] 3.4 消费 `--input`、`--background`、`--muted-foreground` 设计令牌
  - [x] 3.5 编写 `LaunchGoalInput` 组件测试：字符计数、最大长度截断、占位文本

- [x] 4. 创建高级模式内容区块组件
  - [x] 4.1 创建 `client/src/components/launch/LaunchRoutePlanningFlow.tsx`，实现四步水平流程图（目的地→路线规划→执行步骤→校验/证据）
  - [x] 4.2 创建 `client/src/components/launch/LaunchCockpitGrid.tsx`，实现能力工具卡片网格（浏览器、代码执行器、文件系统、知识检索等）
  - [x] 4.3 创建 `client/src/components/launch/LaunchOutputChips.tsx`，实现输出类型可切换标签（结果摘要、生成文件、执行日志、证据截图、操作记录）
  - [x] 4.4 实现高级区块仅在非快速模式下渲染的条件逻辑
  - [x] 4.5 实现 `LaunchCockpitGrid` 根据 `runtimeMode` 禁用需要高级运行时的工具卡片
  - [x] 4.6 编写高级区块组件测试：快速模式下不渲染、标准模式下全部渲染、工具卡片禁用状态

- [x] 5. 创建 LaunchPanelActionBar 底部操作栏组件
  - [x] 5.1 创建 `client/src/components/launch/LaunchPanelActionBar.tsx`，实现添加附件、高级设置、保存为模板、启动任务四个按钮
  - [x] 5.2 复用现有附件上传逻辑（`LaunchAttachmentSection` 的文件选择器触发）
  - [x] 5.3 实现"启动任务"按钮的 disabled（输入为空）和 loading（提交中）状态
  - [x] 5.4 调用 `submitUnifiedLaunch()` 发起任务，成功后触发 `onTaskResolved` / `onWorkflowResolved` 并关闭面板
  - [x] 5.5 消费 `--primary`、`--primary-foreground`、`--border` 设计令牌
  - [x] 5.6 编写 `LaunchPanelActionBar` 组件测试：按钮禁用/启用状态、提交 loading、成功关闭

- [x] 6. 集成触发入口与替换现有组件
  - [x] 6.1 在 `AppSidebar`（spec 2）中新增"+ 新建任务"触发按钮，点击打开 `LaunchPanelShell`
  - [x] 6.2 在 `OfficeTaskCockpit.tsx` 中将底部固定的 `UnifiedLaunchComposer` 替换为触发按钮
  - [x] 6.3 在 `App.tsx` 或 `OfficeTaskCockpit.tsx` 中管理 `launchPanelOpen` 状态，挂载 `LaunchPanelShell`
  - [x] 6.4 保留 `onTaskResolved` 和 `onWorkflowResolved` 回调链路，确保任务创建后的焦点回流和队列刷新正常
  - [x] 6.5 编写集成测试：点击触发按钮打开面板、输入目标并提交、任务创建成功后面板关闭

- [x] 7. i18n 与视觉验收
  - [x] 7.1 在 `client/src/i18n/` 中新增 `launchPanel` 命名空间的中英文翻译键
  - [ ] 7.2 验证面板在 1280px、1024px、768px、375px 四个断点下的布局正确性
  - [ ] 7.3 验证面板消费 spec 1 设计令牌（`--card`、`--border`、`--primary`、`--radius` 等）的视觉效果
  - [x] 7.4 运行 `pnpm run build` 确认构建成功，无新增 TypeScript 错误
