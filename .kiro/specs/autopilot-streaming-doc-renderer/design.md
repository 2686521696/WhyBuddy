# 设计文档：流式文档主区

## 设计概述

本设计将规格文档从 accordion 折叠面板提升为 StageViewport 的主区域流式 Markdown 渲染器。核心组件 `StreamingDocRenderer` 消费 socket 推送的 `agentReasoning` entries（stage 为 `spec_documents`），将 Markdown 增量实时渲染为格式化 HTML，形成"文档正在被书写"的沉浸感。渲染器集成在 `autopilot-workbench-stage-rhythm` 的 `spec_documents` 阶段 StageContent 中。

## 组件架构

```
StageViewport (spec_documents 阶段)
├── StageHeader ("STEP 05 · SPEC DOCUMENTS" / "规格文档")
├── StageContent
│   └── StreamingDocRenderer (新增)
│       ├── DocTabBar (多文档标签栏)
│       │   └── DocTab × N (文档标签 + 流式指示器)
│       ├── DocMainArea (文档主区域)
│       │   ├── MarkdownRenderer (Markdown → HTML)
│       │   │   ├── HeadingBlock (h1-h4)
│       │   │   ├── ParagraphBlock
│       │   │   ├── ListBlock (ol / ul)
│       │   │   ├── CodeBlock (语法高亮)
│       │   │   ├── TableBlock
│       │   │   └── InlineElements (bold / italic / link)
│       │   └── StreamCursor (闪烁光标)
│       └── DocOutline (大纲导航，右侧浮动)
│           └── OutlineItem × N (层级目录项)
└── StageCTA (spec_documents 阶段为只读提示)
```

### 组件职责

| 组件 | 职责 | 文件位置 |
|------|------|----------|
| `StreamingDocRenderer` | 流式文档渲染主容器，管理多文档状态与滚动 | `right-rail/streaming-doc/StreamingDocRenderer.tsx` |
| `DocTabBar` | 多文档标签栏，展示文档标题与流式状态 | `right-rail/streaming-doc/DocTabBar.tsx` |
| `MarkdownRenderer` | 增量 Markdown 解析与 HTML 渲染 | `right-rail/streaming-doc/MarkdownRenderer.tsx` |
| `StreamCursor` | 流式写入光标指示器 | `right-rail/streaming-doc/StreamCursor.tsx` |
| `DocOutline` | 自动生成的大纲导航 | `right-rail/streaming-doc/DocOutline.tsx` |
| `CodeBlock` | 代码块 + 语法高亮 + 复制按钮 | `right-rail/streaming-doc/CodeBlock.tsx` |

## 数据流

```
socket agentReasoning entries (stage: 'spec_documents', type: 'content')
  ↓
useBlueprintRealtimeStore.agentReasoning.entries
  ↓ filter(e => e.stage === 'spec_documents' && e.type === 'content')
  ↓ groupBy(e => e.documentId || 'default')
  ↓
StreamingDocRenderer
  ├── documents: Map<documentId, { chunks: string[], isStreaming: boolean }>
  ├── activeDocId: string
  ├── scrollPositions: Map<documentId, number>
  ↓
  ├── DocTabBar (documents.keys(), activeDocId, isStreaming per doc)
  ├── DocMainArea
  │   ├── MarkdownRenderer (joinedMarkdown = chunks.join(''))
  │   │   ↓ 增量解析：对比上次渲染的 markdown 长度，仅解析新增部分
  │   │   ↓ 输出：ReactNode[] (heading / paragraph / list / code / table)
  │   └── StreamCursor (visible = isStreaming)
  └── DocOutline (headings extracted from rendered content)
```

### 增量渲染策略

```typescript
// 核心思路：维护已解析的 token 数组，新 chunk 到达时仅解析增量
interface StreamingState {
  rawMarkdown: string;           // 累积的完整 markdown
  parsedTokens: MarkdownToken[]; // 已解析的 token 序列
  lastParsedLength: number;      // 上次解析到的字符位置
}

// 新 chunk 到达时
function appendChunk(state: StreamingState, chunk: string): StreamingState {
  const newRaw = state.rawMarkdown + chunk;
  // 仅解析 lastParsedLength 之后的新增内容
  const newTokens = parseIncremental(newRaw, state.lastParsedLength);
  return {
    rawMarkdown: newRaw,
    parsedTokens: [...state.parsedTokens, ...newTokens],
    lastParsedLength: newRaw.length,
  };
}
```

## 关键接口

```typescript
// StreamingDocRenderer props
interface StreamingDocRendererProps {
  /** 当前 job 的 spec documents entries（已过滤 stage） */
  entries: AgentReasoningEntry[];
  /** 已完成的 SpecDocument 对象（用于静态展示已完成文档） */
  specDocuments?: BlueprintSpecDocument[];
  locale: AppLocale;
}

// DocTabBar props
interface DocTabBarProps {
  documents: Array<{ id: string; title: string; isStreaming: boolean }>;
  activeDocId: string;
  onTabClick: (docId: string) => void;
}

// MarkdownRenderer props
interface MarkdownRendererProps {
  markdown: string;
  isStreaming: boolean;
  locale: AppLocale;
}

// DocOutline props
interface DocOutlineProps {
  headings: Array<{ id: string; text: string; level: 1 | 2 | 3 }>;
  onHeadingClick: (id: string) => void;
}

// CodeBlock props
interface CodeBlockProps {
  code: string;
  language: string;
  isStreaming: boolean;  // 流式中逐行渲染
}

// StreamCursor props
interface StreamCursorProps {
  visible: boolean;
}
```

## 样式方案

### DocMainArea 容器

| 元素 | 样式 |
|------|------|
| 外层容器 | `relative flex-1 overflow-y-auto` |
| 内容区 | `max-w-prose mx-auto px-4 py-4 bg-white/5 backdrop-blur-sm rounded-lg` |
| 空态 | `flex items-center justify-center h-full text-white/30 text-xs` |

### Markdown 排版

| 元素 | 样式 |
|------|------|
| h1 | `text-sm font-bold text-white mt-6 mb-2` |
| h2 | `text-[13px] font-semibold text-white/90 mt-5 mb-2` |
| h3 | `text-xs font-semibold text-white/80 mt-4 mb-1.5` |
| h4 | `text-xs font-medium text-white/70 mt-3 mb-1` |
| 段落 | `text-xs leading-relaxed text-white/70 mb-2` |
| 有序列表 | `list-decimal list-inside text-xs text-white/70 space-y-1 mb-2` |
| 无序列表 | `list-disc list-inside text-xs text-white/70 space-y-1 mb-2` |
| 粗体 | `font-bold text-white/90` |
| 斜体 | `italic` |
| 链接 | `text-blue-300 underline underline-offset-2` |
| 表格 | `w-full text-[10px] border-collapse border border-white/10` |
| 表头 | `bg-white/5 font-bold text-white/80 px-2 py-1 border border-white/10` |
| 表格单元格 | `px-2 py-1 border border-white/10 text-white/60` |

### 代码块

| 元素 | 样式 |
|------|------|
| 容器 | `relative rounded-md bg-black/40 border border-white/10 my-3 overflow-hidden` |
| 头部栏 | `flex items-center justify-between px-3 py-1.5 bg-white/5 border-b border-white/10` |
| 语言标签 | `text-[9px] font-mono text-white/40 uppercase` |
| 复制按钮 | `text-[9px] text-white/40 hover:text-white/70 cursor-pointer transition` |
| 代码内容 | `px-3 py-2 font-mono text-[11px] leading-5 text-white/80 overflow-x-auto` |

### DocOutline

| 元素 | 样式 |
|------|------|
| 容器 | `absolute right-0 top-0 w-32 pl-3 border-l border-white/5` |
| 目录项 h1 | `text-[10px] text-white/50 hover:text-white/80 cursor-pointer py-0.5` |
| 目录项 h2 | `text-[10px] text-white/40 hover:text-white/70 cursor-pointer py-0.5 pl-2` |
| 目录项 h3 | `text-[10px] text-white/30 hover:text-white/60 cursor-pointer py-0.5 pl-4` |

### DocTabBar

| 元素 | 样式 |
|------|------|
| 容器 | `flex items-center gap-1 px-2 py-1.5 border-b border-white/5 overflow-x-auto` |
| 标签（默认） | `px-2 py-1 text-[10px] text-white/40 rounded hover:bg-white/5 cursor-pointer whitespace-nowrap` |
| 标签（活跃） | `px-2 py-1 text-[10px] text-white/80 bg-white/10 rounded font-medium whitespace-nowrap` |
| 流式指示器 | `w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse ml-1` |

### StreamCursor

| 元素 | 样式 |
|------|------|
| 光标 | `inline-block w-[2px] h-[14px] bg-white/70 ml-0.5 animate-mirofish-blink` |

## 动画方案

### 流式光标

```css
/* 复用 mirofish-blink keyframes */
@keyframes mirofish-blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}
```

### 文档标签流式脉冲

```css
/* 复用 Tailwind animate-pulse */
.doc-tab-streaming-dot {
  @apply w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse;
}
```

### 进度条完成闪光

```css
@keyframes doc-complete-flash {
  0% { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.4); }
  50% { box-shadow: 0 0 8px 2px rgba(99, 102, 241, 0.2); }
  100% { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0); }
}
```

### 大纲项追加

新标题追加到大纲时使用 `transition-opacity duration-200` 从 0 到 1 渐入。

## 测试策略

- **SSR 渲染测试**：`renderToString` 验证 StreamingDocRenderer 空态和有内容态均可服务端渲染
- **增量渲染测试**：验证连续 appendChunk 后 DOM 中的文本内容正确累积
- **代码块流式测试**：验证代码块未闭合时仍能逐行渲染并应用高亮
- **多文档切换测试**：验证切换标签后滚动位置恢复
- **大纲生成测试**：验证标题出现后大纲自动更新

## Correctness Properties

### Property 1: Markdown 增量追加幂等性

*For any* 一系列 MarkdownChunk 序列 [c1, c2, ..., cn]，将它们逐个追加渲染的最终结果 SHALL 等价于将 `c1+c2+...+cn` 一次性渲染的结果。

**Validates: Requirements 2.1, 2.2**

### Property 2: 大纲与标题同步

*For any* 已渲染的 Markdown 内容，DocOutline 中的条目数量 SHALL 等于内容中 h1-h3 标题的数量，且顺序一致。

**Validates: Requirements 3.2, 3.4**

### Property 3: 文档滚动位置保留

*For any* 文档切换操作（从 docA 切到 docB 再切回 docA），docA 的滚动位置 SHALL 恢复到切换前的值。

**Validates: Requirements 4.3**

### Property 4: 代码块语法高亮语言覆盖

*For any* 代码块标记 ` ```language `，若 language 属于 {typescript, javascript, json, markdown, bash}，则 SHALL 应用对应语法高亮；否则 SHALL 使用纯文本渲染。

**Validates: Requirements 5.1**
