# 需求文档

## 介绍

当前 Autopilot 工作台的进度展示仅有 chip 文字标签（如"clarification"、"route_generation"），用户无法直观感知整体流程进度和当前所处位置。本 spec 将进度展示升级为步骤指示器 + 进度条的组合形态，让用户一眼看清 6 个阶段的完成状态、当前活跃阶段和整体推进比例。

## 术语表

- **StageProgressIndicator**：阶段进度指示器主组件，包含步骤指示器和进度条
- **StepIndicator**：步骤指示器，以圆点/图标序列展示 6 个阶段的状态
- **ProgressBar**：线性进度条，展示当前阶段内的细粒度完成比例
- **StepDot**：步骤指示器中的单个圆点，通过颜色和样式表达 completed / active / pending 三种状态
- **StageProgress**：当前阶段内部的完成百分比（0-100），由 socket 事件驱动更新
- **ConnectorLine**：步骤圆点之间的连接线段，表达阶段间的顺序关系

## 需求

### 需求 1：步骤指示器

**用户故事：** 作为用户，我希望看到一个清晰的步骤序列，这样我能一眼了解整个流程有几步、当前在第几步、哪些已完成。

#### 验收标准

1. THE StepIndicator SHALL 以水平排列展示 6 个 StepDot，对应 6 个阶段（input / clarification / route / spec_tree / spec_documents / effect_preview）
2. THE StepDot SHALL 使用三种视觉状态区分阶段进度：completed（实心圆 + 对勾图标，主题色填充）、active（实心圆 + 脉冲动画环，主题色填充）、pending（空心圆，border-white/20）
3. THE ConnectorLine SHALL 连接相邻 StepDot，已完成段使用主题色实线，未完成段使用 white/10 虚线
4. WHEN 阶段从 pending 变为 active 时, THE StepDot SHALL 使用 scale(0→1) + opacity(0→1) 的 CSS transition（duration 300ms）填充动画
5. THE StepIndicator SHALL 在每个 StepDot 下方展示阶段简称标签（text-[9px] text-white/40），如"输入"、"澄清"、"路线"、"树"、"文档"、"预览"

### 需求 2：阶段内进度条

**用户故事：** 作为用户，我希望看到当前阶段内部的细粒度进度，这样我能了解当前步骤还需要多久完成。

#### 验收标准

1. THE ProgressBar SHALL 展示在 StepIndicator 下方，宽度与 StepIndicator 对齐
2. THE ProgressBar SHALL 使用 2px 高度的线性进度条，背景色为 white/5，填充色为主题色渐变
3. WHEN socket 推送 agentReasoning entry 时, THE StageProgress SHALL 根据当前阶段的预估总步骤数计算完成百分比并更新 ProgressBar
4. WHILE 当前阶段正在执行中, THE ProgressBar SHALL 在填充端展示微弱的发光效果（box-shadow），暗示活跃状态
5. WHEN 当前阶段完成时, THE ProgressBar SHALL 在 200ms 内填充至 100% 并短暂展示完成闪光效果
6. IF 当前阶段的总步骤数无法预估, THEN THE ProgressBar SHALL 使用不确定态动画（indeterminate，从左到右循环滑动的渐变条）

### 需求 3：进度指示器定位与布局

**用户故事：** 作为用户，我希望进度指示器始终可见且不占用过多空间，这样我能随时了解进度而不影响主内容阅读。

#### 验收标准

1. THE StageProgressIndicator SHALL 固定在 StageHeader 内部或紧邻 StageHeader 下方，不随内容滚动
2. THE StageProgressIndicator SHALL 总高度不超过 40px（含 StepIndicator + ProgressBar + 间距）
3. THE StageProgressIndicator SHALL 水平居中对齐，左右留出 16px 边距
4. WHILE 视口宽度小于 640px 时, THE StepIndicator SHALL 隐藏阶段简称标签，仅保留 StepDot 序列以节省空间

### 需求 4：进度数据驱动

**用户故事：** 作为用户，我希望进度展示基于真实执行数据而非静态模拟，这样进度信息是可信的。

#### 验收标准

1. WHEN socket 推送 agentReasoning entry 且 entry.stage 发生变化时, THE StageProgressIndicator SHALL 将对应阶段标记为 active，前序阶段标记为 completed
2. THE StageProgress SHALL 通过以下规则计算当前阶段内进度：已收到的 entry 数量 / 该阶段预估 entry 总数 × 100
3. WHEN 阶段预估 entry 总数未知时, THE StageProgress SHALL 使用对数增长曲线模拟进度（快速到 60%，然后逐渐放缓），避免长时间停留在低百分比
4. WHEN 整个 job 完成时, THE StageProgressIndicator SHALL 将所有 6 个阶段标记为 completed，ProgressBar 填充至 100%

### 需求 5：进度指示器视觉风格

**用户故事：** 作为用户，我希望进度指示器与整体深色毛玻璃风格协调，这样视觉体验统一。

#### 验收标准

1. THE StageProgressIndicator SHALL 使用深色半透明背景（bg-black/20 backdrop-blur-sm），与 3D 场景和毛玻璃面板协调
2. THE StepDot SHALL 使用 6px 直径的圆点，active 状态的脉冲环使用 10px 直径
3. THE StageProgressIndicator SHALL 所有文字使用 font-mono 字体，与整体紧凑风格一致
4. THE ConnectorLine SHALL 使用 1px 宽度，避免视觉过重
5. WHILE active 阶段的 StepDot 展示脉冲动画时, THE MicroAnimation SHALL 使用 CSS @keyframes pulse（scale 1→1.4→1, opacity 1→0.5→1, duration 2s, infinite）
