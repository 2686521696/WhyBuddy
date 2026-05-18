# 实现计划：流式文档主区

## 概述

将规格文档从 accordion 折叠面板提升为 StageViewport 的主区域流式 Markdown 渲染器。核心组件 `StreamingDocRenderer` 消费现有 socket 推送的 `agentReasoning` entries（stage 为 `spec_documents`），将 Markdown 增量实时渲染为格式化 HTML，形成"文档正在被书写"的沉浸感。

## 任务

- [ ] 1. 创建 StreamingDocRenderer 主容器与数据层
  - [x] 1.1 创建 `right-rail/streaming-doc/StreamingDocRenderer.tsx` 主容器
    - 管理多文档状态 `Map<documentId, { chunks, isStreaming }>`
    - 管理 activeDocId 与 scrollPositions
    - 从 entries 中过滤 `stage === 'spec_documents' && type === 'content'` 并按 documentId 分组
    - _需求: 2.1, 4.1_
  - [x] 1.2 实现增量渲染状态管理
    - 维护 `StreamingState { rawMarkdown, parsedTokens, lastParsedLength }`
    - 新 chunk 到达时仅解析 lastParsedLength 之后的增量内容
    - 保证 50ms 内将收到的 chunk 渲染为格式化 HTML
    - _需求: 2.1, 2.2_

- [x] 2. 实现 MarkdownRenderer 核心渲染组件
  - [x] 2.1 创建 `right-rail/streaming-doc/MarkdownRenderer.tsx`
    - 支持 h1-h4 标题、段落、有序/无序列表、粗体/斜体、链接、表格
    - 正文 text-xs leading-relaxed，标题 text-sm
    - 段落间距 space-y-2，标题间距 space-y-3
    - font-sans 正文，font-mono 代码
    - _需求: 2.5, 6.1, 6.2, 6.3, 6.4_
  - [x] 2.2 创建 `right-rail/streaming-doc/CodeBlock.tsx`
    - 支持 TypeScript、JavaScript、JSON、Markdown、Bash 语法高亮
    - 深色主题配色
    - 右上角语言标签 + 复制按钮
    - 流式中逐行渲染，不等待代码块闭合标记
    - _需求: 5.1, 5.2, 5.3, 5.4_
  - [x] 2.3 创建 `right-rail/streaming-doc/StreamCursor.tsx`
    - 流式生成中展示闪烁光标（复用 mirofish-blink @keyframes）
    - 生成完成后光标消失
    - _需求: 2.3, 2.4_

- [x] 3. 实现 DocMainArea 布局与空态
  - [x] 3.1 实现 DocMainArea 容器布局
    - 占据 StageViewport 除 header/cta 外全部高度
    - max-w-prose 最大宽度约束
    - overflow-y-auto 垂直滚动
    - bg-white/5 backdrop-blur-sm 深色毛玻璃背景
    - _需求: 1.1, 1.2, 1.3, 1.4_
  - [x] 3.2 实现空态展示
    - 文档内容为空时展示居中提示"等待文档生成…"
    - _需求: 1.5_

- [x] 4. 实现 DocOutline 大纲导航
  - [x] 4.1 创建 `right-rail/streaming-doc/DocOutline.tsx`
    - 基于已渲染 h1-h3 标题自动生成层级目录
    - 点击标题平滑滚动到对应位置
    - 流式生成中实时更新，新标题自动追加
    - text-[10px] 紧凑样式
    - 文档中 ≥2 个标题时才展示
    - _需求: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 5. 实现 DocTabBar 多文档切换
  - [x] 5.1 创建 `right-rail/streaming-doc/DocTabBar.tsx`
    - 多份 SpecDocument 时展示文档标签栏
    - 点击切换展示对应文档
    - 保留每份文档滚动位置，切换回来时恢复
    - 流式生成中的文档标签展示脉冲圆点（animate-pulse）
    - _需求: 4.1, 4.2, 4.3, 4.4_

- [x] 6. 集成到 StageViewport spec_documents 阶段
  - [x] 6.1 将 StreamingDocRenderer 集成到 `spec_documents` 阶段的 StageContent 中
    - 替换原有 accordion 折叠面板
    - StageCTA 在此阶段为只读提示
    - _需求: 1.1, 2.1_

- [ ] 7. 检查点 — 确保所有测试通过
  - 确保所有测试通过，ask the user if questions arise.

- [ ]* 7.1 编写 StreamingDocRenderer SSR 渲染测试
  - 使用 `react-dom/server` 的 `renderToString` 验证空态和有内容态均可服务端渲染
  - _需求: 1.5, 2.5_

- [ ]* 7.2 编写增量渲染正确性测试
  - **Property 1: Markdown 增量追加幂等性**
  - 验证逐个 chunk 追加渲染的最终结果等价于一次性渲染
  - **验证: 需求 2.1, 2.2**

- [ ]* 7.3 编写大纲同步测试
  - **Property 2: 大纲与标题同步**
  - 验证 DocOutline 条目数量等于内容中 h1-h3 标题数量且顺序一致
  - **验证: 需求 3.2, 3.4**

- [ ]* 7.4 编写多文档滚动位置保留测试
  - **Property 3: 文档滚动位置保留**
  - 验证文档切换后滚动位置恢复
  - **验证: 需求 4.3**

- [ ]* 7.5 编写代码块语法高亮覆盖测试
  - **Property 4: 代码块语法高亮语言覆盖**
  - 验证支持的语言应用高亮，不支持的使用纯文本
  - **验证: 需求 5.1**

## 注意事项

- 标记 `*` 的任务为可选测试任务，可跳过以加速 MVP
- 流式渲染消费现有 socket agentReasoning entries，不改后端协议
- 不引入 @testing-library/react，测试用 vitest + react-dom/server SSR
- 不改 6 阶段流程顺序

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "2.2", "2.3", "3.1", "3.2"] },
    { "id": 2, "tasks": ["4.1", "5.1"] },
    { "id": 3, "tasks": ["6.1"] },
    { "id": 4, "tasks": ["7.1", "7.2", "7.3", "7.4", "7.5"] }
  ]
}
```
