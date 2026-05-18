# 需求文档

## 介绍

当前 Autopilot 生成的规格文档（spec documents）藏在 accordion 折叠面板中，用户需要手动展开才能查看内容，且无法感知文档正在流式生成的过程。本 spec 将规格文档从 accordion 提升为主区域的流式 Markdown 渲染器，让用户在文档生成过程中实时看到内容逐步呈现，形成"文档正在被书写"的沉浸感。

## 术语表

- **StreamingDocRenderer**：流式文档渲染主组件，负责将 socket 推送的 Markdown 增量实时渲染为格式化内容
- **DocMainArea**：文档主区域容器，占据 StageViewport 的主要可视空间
- **MarkdownChunk**：通过 socket agentReasoning entries 推送的 Markdown 文本增量片段
- **StreamCursor**：文档流式渲染时的光标指示器，标记当前写入位置
- **DocOutline**：文档大纲导航，基于已渲染的标题层级自动生成
- **SpecDocument**：BlueprintSpecDocument 类型的规格文档对象

## 需求

### 需求 1：文档主区域布局

**用户故事：** 作为用户，我希望规格文档占据工作区的主要空间，这样我能舒适地阅读完整文档内容而不需要在小窗口中滚动。

#### 验收标准

1. THE DocMainArea SHALL 占据 StageViewport 中除 StageHeader 和 StageCTA 之外的全部可用高度
2. THE DocMainArea SHALL 使用最大宽度约束（max-w-prose 或等效的 65ch），保证长文本的可读行宽
3. THE DocMainArea SHALL 支持垂直滚动，当文档内容超出可视高度时自动启用 overflow-y-auto
4. THE DocMainArea SHALL 使用深色毛玻璃背景（bg-white/5 backdrop-blur-sm）与 3D 场景协调
5. WHEN 文档内容为空时, THE DocMainArea SHALL 展示居中的空态提示（如"等待文档生成…"）

### 需求 2：流式 Markdown 渲染

**用户故事：** 作为用户，我希望看到文档内容逐步出现的过程，这样我能感知系统正在工作并实时了解生成进度。

#### 验收标准

1. WHEN socket 推送新的 agentReasoning entry（stage 为 spec_documents 且 type 为 content）时, THE StreamingDocRenderer SHALL 将 Markdown 增量追加到已渲染内容末尾
2. THE StreamingDocRenderer SHALL 在 50ms 内将收到的 MarkdownChunk 渲染为格式化 HTML，保证流式体验的实时性
3. WHILE 文档正在流式生成中, THE StreamCursor SHALL 在最后一个字符后展示闪烁光标（CSS @keyframes blink, 1s 周期）
4. WHEN 流式生成完成时, THE StreamCursor SHALL 消失，文档进入静态可读状态
5. THE StreamingDocRenderer SHALL 支持以下 Markdown 语法的实时渲染：标题（h1-h4）、段落、列表（有序/无序）、代码块（带语法高亮）、粗体/斜体、链接、表格

### 需求 3：文档大纲导航

**用户故事：** 作为用户，我希望长文档有大纲导航，这样我能快速跳转到感兴趣的章节。

#### 验收标准

1. WHEN 文档中出现 2 个及以上标题时, THE DocOutline SHALL 在文档主区域右侧或顶部展示大纲导航
2. THE DocOutline SHALL 基于已渲染的 h1-h3 标题自动生成层级目录
3. WHEN 用户点击大纲中的某个标题时, THE DocMainArea SHALL 平滑滚动到对应标题位置
4. WHILE 文档正在流式生成中, THE DocOutline SHALL 实时更新，新出现的标题自动追加到大纲末尾
5. THE DocOutline SHALL 使用 text-[10px] 紧凑样式，不占用过多水平空间

### 需求 4：文档切换与多文档支持

**用户故事：** 作为用户，我希望能在多份规格文档之间切换查看，这样我能对比不同文档的内容。

#### 验收标准

1. WHEN 当前 job 生成了多份 SpecDocument 时, THE StreamingDocRenderer SHALL 在顶部展示文档标签栏，每个标签显示文档标题
2. WHEN 用户点击不同文档标签时, THE DocMainArea SHALL 切换展示对应文档内容
3. THE StreamingDocRenderer SHALL 保留每份文档的滚动位置，切换回来时恢复到上次阅读位置
4. WHILE 某份文档正在流式生成中, THE StreamingDocRenderer SHALL 在对应标签上展示动态指示器（如脉冲圆点）

### 需求 5：代码块与语法高亮

**用户故事：** 作为用户，我希望文档中的代码块有语法高亮，这样技术内容更易阅读。

#### 验收标准

1. THE StreamingDocRenderer SHALL 对 Markdown 代码块（```language）应用语法高亮，支持 TypeScript、JavaScript、JSON、Markdown、Bash 语言
2. THE StreamingDocRenderer SHALL 使用深色主题的代码高亮配色，与整体深色毛玻璃风格协调
3. THE StreamingDocRenderer SHALL 在代码块右上角展示语言标签和复制按钮
4. WHILE 代码块正在流式生成中, THE StreamingDocRenderer SHALL 逐行渲染并应用高亮，不等待代码块闭合标记

### 需求 6：字体与排版约束

**用户故事：** 作为用户，我希望文档排版紧凑但可读，与整体 10-12px 紧凑风格保持一致。

#### 验收标准

1. THE StreamingDocRenderer SHALL 使用 text-xs（12px）作为正文基础字号，标题使用 text-sm（14px）
2. THE StreamingDocRenderer SHALL 使用 leading-relaxed（1.625）行高保证紧凑排版下的可读性
3. THE StreamingDocRenderer SHALL 使用 font-sans 作为正文字体，代码块使用 font-mono
4. THE StreamingDocRenderer SHALL 段落间距使用 space-y-2（8px），标题与段落间距使用 space-y-3（12px）
