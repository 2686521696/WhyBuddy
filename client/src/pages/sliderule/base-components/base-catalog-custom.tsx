/**
 * 基础组件库 · 自定义组件档（2026-08-08）。
 *
 * ## 这一档是怎么来的
 *
 * 用户的原话：「基础组件是不是可以增加一项『自定义组件』」。
 *
 * 结论是该加，而且**它早就有一个成员了**——`ECharts` 一直混在 antd 那档里，
 * 它的说明写着「它不是 Ant Design 组件，但已装在依赖里，是图表这项能力的
 * 唯一来源」。所以这不是新发明一个分类，是把一条已经存在的隐含分类标出来。
 *
 * ## 供给从哪来：把 amis 当地图，不当零件
 *
 * 查 amis-ui 那 120 个组件时，逐个跟 antd 对了一遍：88 个是重的（`Radios`
 * = Radio、`Rating` = Rate、`Range` = Slider、七八种 `*Selection` 全是
 * Cascader/Checkbox 的变体），**真正 antd 没有的只有 26 个**。而那 26 个
 * 本身也是别人库的封装——CodeMirror、Tinymce、百度/高德地图、react-pdf、
 * signature。
 *
 * 所以正确用法是**照着那 26 个的清单直接接原始库**，而不是抄 amis 的封装。
 * 理由不是许可证（Apache-2.0，用户明确说过不用管），是主题：amis-ui 每个
 * 组件都被 `themeable()` 包着，样式走它自己的 SCSS 变量体系（cxd / antd /
 * ang / dark 四套主题文件）。拿一个组件就得拖 `amis-core` 加它整套 SCSS
 * 构建，跟我们的 ConfigProvider 是两套东西——**视觉会分裂成两套**。
 *
 * ## 这一批：零新依赖
 *
 * 下面每一个都用**已经装在依赖里**的库。这不是巧合——先把装着没用的挖干净，
 * 是这个项目已经吃到两次红利的路子（ProComponents 那 117 个、阶段④那批
 * ProForm 控件都是这么来的）。
 *
 *     CodeMirror 6      @uiw/react-codemirror + 四个 lang 包 → 代码/JSON/SQL/Markdown 编辑
 *     react-markdown    → Markdown 渲染
 *     xlsx              → 表格导出 Excel
 *     （无依赖）         → 手写签名板，canvas 五十行
 *
 * ## 还差的，以及为什么还没做
 *
 *     PDF 查看器   pdfjs-dist 已装（workflow-attachments 在用它抽文本），
 *                  但**渲染**要一份示例 PDF 资源，且中文字体嵌入是另一摊事
 *     富文本编辑   没有已装的库。自己拿 contentEditable 造一个质量没保证，
 *                  该走「引一个成熟库」的决策，不该在这里顺手发明
 *     地图选点     百度/高德都要 API key —— 是产品决策不是接线
 *     条形码       没有已装的库
 *
 * 这四条都记在 docs/区块建设-amis对照.md 的「剩下的」一节里。
 */

import React from "react";
import { Button, Space, Tag, message } from "antd";

import type { BaseComponentDef } from "./base-catalog";

/**
 * CodeMirror 走懒加载。
 *
 * 它是这一批里最重的一个（编辑器内核 + 四个语言包）。同仓库的
 * `CodeMirrorPanel` 已经定了这条规矩——它的文件头写着「整个模块经 React.lazy
 * 懒加载，不进主包」。组件库这一页更该守：一页要渲染两百多个示例，静态引进来
 * 等于每次打开这一页都先下载一个编辑器。
 */
const LazyCodeMirror = React.lazy(async () => {
  const [{ default: CodeMirror }, { githubLight }, js, json, sql, markdown] =
    await Promise.all([
      import("@uiw/react-codemirror"),
      import("@uiw/codemirror-theme-github"),
      import("@codemirror/lang-javascript"),
      import("@codemirror/lang-json"),
      import("@codemirror/lang-sql"),
      import("@codemirror/lang-markdown"),
    ]);
  const EXT: Record<string, () => unknown[]> = {
    javascript: () => [js.javascript({ typescript: true })],
    json: () => [json.json()],
    sql: () => [sql.sql()],
    markdown: () => [markdown.markdown()],
  };
  return {
    default: ({ lang, value }: { lang: string; value: string }) => (
      <CodeMirror
        value={value}
        theme={githubLight}
        height="140px"
        basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: false }}
        extensions={EXT[lang]?.() as never}
      />
    ),
  };
});

/** 编辑器条目的样板：四个语言档只差 lang 和示例文本。 */
function editorItem(
  name: string,
  label: string,
  description: string,
  lang: string,
  value: string
): BaseComponentDef {
  return {
    name,
    label,
    description,
    group: "数据录入",
    platform: "pc",
    source: "custom",
    render: () => (
      <React.Suspense
        fallback={<div style={{ height: 140, background: "#fafafa", borderRadius: 6 }} />}
      >
        <div style={{ border: "1px solid #f0f0f0", borderRadius: 6, overflow: "hidden" }}>
          <LazyCodeMirror lang={lang} value={value} />
        </div>
      </React.Suspense>
    ),
  };
}

const LazyMarkdown = React.lazy(async () => {
  const [{ default: ReactMarkdown }, { default: remarkGfm }] = await Promise.all([
    import("react-markdown"),
    import("remark-gfm"),
  ]);
  return {
    default: ({ text }: { text: string }) => (
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    ),
  };
});

/**
 * 签名板：canvas + 指针事件，无依赖。
 *
 * 审批场景要的就是这一个能力（amis 那边是 `signature`，背后是
 * signature_pad）。它简单到不值得引一个库：一支笔、一块画布、一个清除。
 *
 * 用 pointer 事件而不是 mouse + touch 两套：一套代码同时覆盖鼠标、触屏和
 * 手写笔，这正是 Pointer Events 存在的理由。
 */
function SignaturePad() {
  const ref = React.useRef<HTMLCanvasElement | null>(null);
  const drawing = React.useRef(false);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = ref.current!;
    const r = c.getBoundingClientRect();
    // 画布的 CSS 尺寸和位图尺寸不一定相等，按比例换算，否则笔迹会偏。
    return {
      x: ((e.clientX - r.left) / r.width) * c.width,
      y: ((e.clientY - r.top) / r.height) * c.height,
    };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    drawing.current = true;
    // 捕获指针：手滑出画布再滑回来，笔迹仍然连着，而不是断成两截。
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = pos(e);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#1f2937";
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const end = () => {
    drawing.current = false;
  };

  const clear = () => {
    const c = ref.current;
    c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
  };

  return (
    <Space direction="vertical">
      <canvas
        ref={ref}
        width={320}
        height={120}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        style={{
          border: "1px dashed #d9d9d9",
          borderRadius: 6,
          background: "#fff",
          touchAction: "none", // 不设的话触屏上会变成滚动页面，画不出来
          cursor: "crosshair",
        }}
      />
      <Space>
        <Tag color="default">在框内按住拖动</Tag>
        <Button size="small" onClick={clear}>
          清除
        </Button>
      </Space>
    </Space>
  );
}

/** 导出按钮：xlsx 已装在依赖里（workflow-attachments 用它读表），这里用它写表。 */
function ExcelExportButton() {
  const [busy, setBusy] = React.useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const xlsx = await import("xlsx");
      const sheet = xlsx.utils.json_to_sheet([
        { 名称: "甲", 数量: 12 },
        { 名称: "乙", 数量: 8 },
      ]);
      const book = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(book, sheet, "示例");
      xlsx.writeFile(book, "示例.xlsx");
    } catch {
      // 目录里点一下失败不该把整页搞崩——如实提示，不静默。
      message.error("导出失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button type="primary" loading={busy} onClick={run}>
      导出 Excel
    </Button>
  );
}

export const CUSTOM_BASE_COMPONENTS: BaseComponentDef[] = [
  editorItem(
    "CodeEditor",
    "代码编辑器",
    "CodeMirror 6：行号、语法高亮、折叠。规则脚本、模板表达式这类要写代码的字段用它，比多行文本强得多。",
    "javascript",
    "function total(rows) {\n  return rows.reduce((s, r) => s + r.amount, 0);\n}"
  ),
  editorItem(
    "JsonEditor",
    "JSON 编辑器",
    "带 JSON 语法高亮与括号匹配。配置项、接口映射这类结构化字段的录入方式。",
    "json",
    '{\n  "enabled": true,\n  "retries": 3,\n  "tags": ["甲", "乙"]\n}'
  ),
  editorItem(
    "SqlEditor",
    "SQL 编辑器",
    "SQL 语法高亮。报表的自定义查询条件、数据集定义这类场景。",
    "sql",
    "select name, count(*) as n\nfrom items\ngroup by name\norder by n desc;"
  ),
  editorItem(
    "MarkdownEditor",
    "Markdown 编辑器",
    "Markdown 语法高亮。公告、知识库、操作手册的编写侧。",
    "markdown",
    "## 标题\n\n- 条目一\n- 条目二\n\n> 引用一段说明"
  ),
  {
    name: "MarkdownView",
    label: "Markdown 渲染",
    description:
      "把 Markdown 渲染成正文，支持表格、任务列表等 GFM 扩展。与 MarkdownEditor 是同一份内容的读写两侧。",
    group: "数据展示",
    platform: "pc",
    source: "custom",
    render: () => (
      <React.Suspense fallback={<div style={{ height: 96 }} />}>
        <div style={{ fontSize: 13, lineHeight: 1.7 }}>
          <LazyMarkdown text={"### 小标题\n\n| 列甲 | 列乙 |\n|---|---|\n| 一 | 二 |\n\n- [x] 已完成\n- [ ] 未完成"} />
        </div>
      </React.Suspense>
    ),
  },
  {
    name: "SignaturePad",
    label: "手写签名板",
    description:
      "canvas 手写签名，鼠标/触屏/手写笔通吃。审批留痕、收货确认这类要「本人签字」的环节。",
    group: "数据录入",
    platform: "pc",
    source: "custom",
    render: () => <SignaturePad />,
  },
  {
    name: "ExcelExportButton",
    label: "导出 Excel",
    description:
      "把当前数据写成 .xlsx 下载。内部系统里「能不能导出」几乎是每个列表页都会被问的一句。",
    group: "通用",
    platform: "pc",
    source: "custom",
    render: () => <ExcelExportButton />,
  },
];
