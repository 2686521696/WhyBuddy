# 需求文档

## 介绍

当前 Autopilot 工作台的阶段展示采用 timeline 列表平铺方式，6 个阶段（输入 → 澄清 → 路线 → spec树 → 规格文档 → 效果预览）同时可见但缺乏节奏感。用户无法直观感知"当前正在哪一步"。本 spec 将阶段展示从平铺列表改为"当前阶段独占视口"的切场模式，并为每个阶段增加仪式感标题与底部固定 CTA，形成清晰的阶段节奏。

## 术语表

- **WorkbenchStage**：Autopilot 工作台的 6 个阶段之一（input / clarification / route / spec_tree / spec_documents / effect_preview）
- **StageViewport**：当前阶段独占的可视区域容器，一次只展示一个阶段的内容
- **StageHeader**：阶段顶部的仪式感标题区域，包含步骤编号与中文大标题
- **StageCTA**：底部固定的行动号召栏，承载当前阶段的主操作按钮
- **StageTransition**：阶段之间的切场过渡动画
- **AutopilotRoutePage**：Autopilot 主路由页面组件

## 需求

### 需求 1：阶段独占视口

**用户故事：** 作为用户，我希望当前阶段独占整个工作区视口，这样我能专注于当前步骤而不被其他阶段内容干扰。

#### 验收标准

1. WHEN 工作台进入某个阶段, THE StageViewport SHALL 仅渲染当前阶段的内容，隐藏其他 5 个阶段的内容区域
2. WHILE 当前阶段为 active 状态, THE StageViewport SHALL 占满右栏可用高度（减去 StageHeader 与 StageCTA 的固定高度）
3. WHEN 用户在非最后阶段点击 StageCTA 主按钮, THE WorkbenchStage SHALL 推进到下一个阶段
4. THE StageViewport SHALL 保留已完成阶段的数据快照，允许用户通过进度指示器回看已完成阶段

### 需求 2：阶段切场过渡动画

**用户故事：** 作为用户，我希望阶段切换时有流畅的过渡动画，这样我能感知到流程在推进而不是突然跳变。

#### 验收标准

1. WHEN 阶段从 N 推进到 N+1, THE StageTransition SHALL 使用 framer-motion 的 AnimatePresence 实现退出与进入动画，总时长在 300ms 至 500ms 之间
2. WHEN 阶段正向推进时, THE StageTransition SHALL 使用从右向左滑入的方向暗示前进语义
3. WHEN 用户回看已完成阶段时, THE StageTransition SHALL 使用从左向右滑入的方向暗示回退语义
4. WHILE 过渡动画进行中, THE StageViewport SHALL 禁用 StageCTA 按钮的点击，防止重复触发

### 需求 3：阶段仪式感标题

**用户故事：** 作为用户，我希望每个阶段有醒目的标题区域，这样我能立即知道当前处于哪一步以及这一步的目的。

#### 验收标准

1. THE StageHeader SHALL 展示格式为 "STEP 0N · ENGLISH_LABEL" 的英文步骤标识（font-mono, text-[10px], opacity-60）
2. THE StageHeader SHALL 在英文标识下方展示中文大标题（text-sm font-semibold），6 个阶段分别为：需求输入、智能澄清、路线规划、规格树、规格文档、效果预览
3. WHEN 阶段处于 active 状态, THE StageHeader SHALL 使用高亮文字颜色（text-white）区分于已完成阶段的低对比度样式
4. THE StageHeader SHALL 固定在 StageViewport 顶部，不随内容滚动

### 需求 4：底部固定 CTA 栏

**用户故事：** 作为用户，我希望当前阶段的主操作按钮始终可见在底部，这样我不需要滚动到内容末尾才能触发下一步。

#### 验收标准

1. THE StageCTA SHALL 固定在 StageViewport 底部，使用 sticky 或 fixed 定位，不随内容滚动消失
2. WHEN 当前阶段有明确的推进动作时, THE StageCTA SHALL 展示主按钮（如"开始澄清"、"生成路线"、"生成 Spec 树"等）
3. WHILE 当前阶段正在执行异步操作（如 LLM 生成中）, THE StageCTA SHALL 将主按钮置为 loading 状态并展示进度提示文案
4. THE StageCTA SHALL 使用深色毛玻璃背景（backdrop-blur）与上方内容区形成视觉分层
5. IF 当前阶段无需用户主动触发（如自动流式生成中）, THEN THE StageCTA SHALL 展示为只读状态提示而非可点击按钮

### 需求 5：6 阶段流程顺序保持不变

**用户故事：** 作为用户，我希望流程顺序保持一致，这样我的操作习惯不会被打破。

#### 验收标准

1. THE WorkbenchStage SHALL 维持固定的 6 阶段顺序：input → clarification → route → spec_tree → spec_documents → effect_preview
2. THE WorkbenchStage SHALL 不允许跳过中间阶段直接推进到后续阶段
3. WHEN 用户回看已完成阶段时, THE WorkbenchStage SHALL 允许查看但不允许修改已完成阶段的输出
