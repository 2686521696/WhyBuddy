/**
 * `autopilot-streaming-doc-renderer` — Wave 2 / Task 4.1
 *
 * 流式文档大纲导航。
 *
 * 该组件接收父组件 `StreamingDocRenderer` 抽取出来的 h1-h3 标题列表，
 * 渲染成一份紧凑的层级目录。点击某个目录项时通过 `onHeadingClick` 回调
 * 让父组件（持有 scroll container ref）平滑滚动到对应的标题位置。
 *
 * 设计约束：
 * - 浅色主题：右栏底色为白色，使用 `text-slate-* / border-slate-*` 浅色
 *   语义；不允许出现 `text-white/* / border-white/*` 这类深色毛玻璃语义。
 * - 紧凑样式：所有目录项统一 `text-[10px]`，避免占用过多水平空间，与
 *   设计文档需求 3.5 保持一致。
 * - 阈值控制：仅在标题数量 `>=2` 时渲染；少于 2 个标题时返回 `null`，
 *   交给父组件直接 hide aside 区域。
 * - 不维护内部滚动状态：滚动行为完全由父组件接管，本组件只负责语义
 *   与点击派发，便于在流式过程中根据 `headings` 列表实时刷新。
 *
 * 对应需求：
 * - 需求 3.1：≥2 个标题时展示
 * - 需求 3.2：基于已渲染 h1-h3 标题自动生成层级目录
 * - 需求 3.3：点击平滑滚动到对应位置
 * - 需求 3.4：流式生成中实时更新，新标题自动追加
 * - 需求 3.5：text-[10px] 紧凑样式
 */

import type { FC, MouseEvent } from "react";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/**
 * 单条大纲条目。
 *
 * - `id`：标题对应的稳定锚点 id；与 `MarkdownRenderer` 渲染的 `<h1>/<h2>/<h3>`
 *   `id` 属性保持一致，便于父组件通过 `getElementById` 或 `querySelector`
 *   查找滚动目标。
 * - `text`：标题原文，未经 inline parsing 的纯字符串；大纲层不再展开
 *   `**bold**` 这类行内标记，保持目录的紧凑。
 * - `level`：标题级别，仅暴露 1 / 2 / 3 三档（h4 不进入目录，与需求 3.2
 *   保持一致）。
 */
export interface DocOutlineHeading {
  id: string;
  text: string;
  level: 1 | 2 | 3;
}

/**
 * `DocOutline` 的对外 props。
 *
 * 与 design.md「关键接口」一节保持一致：
 * - `headings`：当前活跃文档已渲染出的 h1-h3 标题序列，按文档源顺序排列。
 * - `onHeadingClick`：点击某条目录时的回调；父组件负责把对应 id 解析为
 *   DOM 节点并执行平滑滚动。
 */
export interface DocOutlineProps {
  headings: ReadonlyArray<DocOutlineHeading>;
  onHeadingClick: (id: string) => void;
}

// ---------------------------------------------------------------------------
// 样式映射
// ---------------------------------------------------------------------------

/**
 * 标题级别 → Tailwind class 映射。
 *
 * 之所以把样式映射独立成常量，而不是写在 JSX 内联条件里：
 * - 避免在 JSX 中混入 if/else 影响阅读；
 * - 便于后续与设计文档样式表保持同步。
 */
const ITEM_CLASS_BY_LEVEL: Record<1 | 2 | 3, string> = {
  1: "text-[10px] text-slate-700 hover:text-slate-900",
  2: "text-[10px] text-slate-600 hover:text-slate-800 pl-2",
  3: "text-[10px] text-slate-500 hover:text-slate-700 pl-4",
};

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

/**
 * 流式文档大纲导航。
 */
export const DocOutline: FC<DocOutlineProps> = ({ headings, onHeadingClick }) => {
  // 需求 3.1：≥2 个标题时才渲染；其余情况下返回 null 由父组件直接 hide。
  if (headings.length < 2) return null;

  const handleClick = (id: string) => (event: MouseEvent<HTMLButtonElement>) => {
    // 阻止 button 默认提交行为；同时避免事件冒泡触发父级滚动监听。
    event.preventDefault();
    onHeadingClick(id);
  };

  return (
    <nav
      aria-label="document outline"
      className="border-l border-slate-200 pl-3"
      data-testid="streaming-doc-outline"
      data-heading-count={headings.length}
    >
      <ul className="space-y-0.5">
        {headings.map((heading) => (
          <li key={heading.id}>
            <button
              type="button"
              onClick={handleClick(heading.id)}
              className={`block w-full cursor-pointer truncate text-left transition ${ITEM_CLASS_BY_LEVEL[heading.level]}`}
              data-testid={`streaming-doc-outline-item-${heading.id}`}
              data-heading-level={heading.level}
              title={heading.text}
            >
              {heading.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
};

export default DocOutline;
