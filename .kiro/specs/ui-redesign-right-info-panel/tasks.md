<!--
 * @Author: wangchunji
 * @Date: 2026-04-27 14:42:10
 * @Description: 
 * @LastEditTime: 2026-04-27 14:46:40
 * @LastEditors: wangchunji
-->
# 任务清单

## 任务

- [x] 1. 创建辅助函数模块
  - [x] 1.1 新建 `client/src/components/tasks/right-info-helpers.ts`，实现 `formatDuration(ms, locale)` 函数，将毫秒转为"Xd Yh"或"Xh Ym"格式，对无效输入返回"—"
  - [x] 1.2 实现 `formatRelativeTime(timestamp, locale)` 函数，将时间戳转为相对时间（如"3分钟前"），对无效时间戳返回"—"
  - [x] 1.3 实现 `deriveSubMetrics(detail, autopilot, locale)` 函数，按三级优先级派生子指标：autopilot route stages → detail stages → completedTaskCount/taskCount 降级
  - [x] 1.4 实现 `dotColorClass(level)` 函数，将事件 level 映射为圆点颜色 CSS 类（info=蓝、success=绿、warning=琥珀、error=红、default=灰）
  - [x] 1.5 实现 `prepareTimelineEvents(events, maxCount)` 函数，按 time 降序排序并截断到 maxCount 条
  - [x] 1.6 编写单元测试，覆盖 `formatDuration` 的边界值（0ms、59s、1h、25h、3d）、`deriveSubMetrics` 的三种数据源场景、`dotColorClass` 的所有已知和未知 level、`prepareTimelineEvents` 的排序与截断

- [x] 2. 创建 TaskOverviewSection 组件
  - [x] 2.1 在 `client/src/components/tasks/RightInfoPanel.tsx` 中实现 `TaskOverviewSection` 内部组件，接收 detail、autopilot、locale props
  - [x] 2.2 实现 MetaRow 子组件，展示图标 + 标签 + 值的水平行，值使用 `--font-mono` 和 `tabular-nums`
  - [x] 2.3 实现创建时间、预估完成、已用时间、创建者四行元信息渲染，数据缺失时展示"—"
  - [x] 2.4 实现标签胶囊列表，从 `detail.departmentLabels` 读取，使用 `--secondary` 背景和 `--secondary-foreground` 文字
  - [x] 2.5 使用 spec 1 设计令牌：`--card` 背景、`--border` 边框、`--radius` 圆角、`--muted-foreground` 标题色
  - [x] 2.6 编写组件测试，验证完整数据和缺失数据两种场景的渲染行为

- [x] 3. 创建 LiveProgressSection 组件
  - [x] 3.1 在 `RightInfoPanel.tsx` 中实现 `LiveProgressSection` 内部组件，接收 detail、autopilot、locale props
  - [x] 3.2 实现 ProgressRing SVG 组件：使用 `<circle>` + `stroke-dasharray` / `stroke-dashoffset` 技术，stroke 消费 `--primary`，背景轨道消费 `--muted`，中心展示百分比数字
  - [x] 3.3 实现进度值 clamp 到 [0, 100] 范围，确保 SVG 渲染不越界
  - [x] 3.4 实现 SubMetricItem 子组件：展示维度名称 + 进度条 + 百分比数值，进度条使用 `--primary` 填充和 `--muted` 背景
  - [x] 3.5 实现子指标两列网格布局，调用 `deriveSubMetrics()` 获取 2-4 个子指标
  - [x] 3.6 编写组件测试，验证 ProgressRing 在 progress=0、50、100、-5、120 时的渲染行为，验证子指标在三种数据源场景下的渲染

- [x] 4. 创建 RecentActivitySection 组件
  - [x] 4.1 在 `RightInfoPanel.tsx` 中实现 `RecentActivitySection` 内部组件，接收 timeline 数组和 locale props
  - [x] 4.2 实现 ActivityTimelineItem 子组件：彩色圆点 + 竖线连接 + 事件标题 + 相对时间 + 描述
  - [x] 4.3 实现事件按时间倒序排列，默认展示最近 10 条
  - [x] 4.4 实现"查看全部"按钮，点击后展开完整列表
  - [x] 4.5 实现空态处理：timeline 为空时展示"暂无动态"提示
  - [x] 4.6 编写组件测试，验证空列表渲染空态、正常列表按时间倒序、超过 10 条时截断并显示"查看全部"

- [x] 5. 组装 RightInfoPanel 并添加错误边界
  - [x] 5.1 在 `RightInfoPanel.tsx` 中实现 `RightInfoPanel` 导出组件，组装三个区域组件 + "查看完整详情"按钮
  - [x] 5.2 为每个区域组件包裹 React ErrorBoundary，单个区域异常时展示"此区域加载失败"提示
  - [x] 5.3 实现 detail 为 null 时的空态渲染："选择一个任务查看详情"
  - [x] 5.4 实现面板宽度约束：`min-width: 300px`、`max-width: 360px`、独立 `overflow-y: auto` 滚动
  - [x] 5.5 添加 i18n 键到中英文资源文件
  - [x] 5.6 编写组件测试，验证 detail=null 渲染空态、detail 非 null 渲染三个区域、单区域异常不影响其他区域

- [x] 6. 改造 TasksCockpitDetail 接入 RightInfoPanel
  - [x] 6.1 修改 `TasksCockpitDetail.tsx`，将内部渲染结构替换为 `RightInfoPanel` 组件调用，保持外部 props 接口不变
  - [x] 6.2 将 `detail.autopilotSummary` 传递给 `RightInfoPanel` 的 `autopilotSummary` prop
  - [x] 6.3 实现"查看完整详情"按钮的回调逻辑，展开 `TaskDetailView`（可使用 Dialog 或 Accordion 展开）
  - [x] 6.4 确保 `OfficeTaskCockpit` 中的装配逻辑无需修改（`TasksCockpitDetail` 的 props 接口保持不变）
  - [x] 6.5 编写集成测试，验证选中任务后右侧面板渲染三段式布局，取消选中后渲染空态
  - [x] 6.6 运行 `pnpm run build` 验证构建成功，运行 `node --run check` 验证不引入新的 TypeScript 错误
