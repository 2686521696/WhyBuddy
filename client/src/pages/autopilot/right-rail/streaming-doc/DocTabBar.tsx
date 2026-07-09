/**
 * `autopilot-streaming-doc-renderer` — Wave 2 / Task 5.1
 *
 * 流式文档标签栏。
 *
 * 该组件替代 Wave 0 中 `StreamingDocRenderer` 内联的 `showTabsPlaceholder`
 * 占位栏，承担多 SpecDocument 切换的视觉与交互职责：
 *
 * - 多份文档时展示横向标签栏；点击标签切换活跃文档；
 * - 流式生成中的文档显示蓝色脉冲圆点（`animate-pulse`），承接需求 4.4
 *   的"动态指示器"语义；
 * - 标签栏自身只负责派发 `onTabClick(docId)`，滚动位置恢复仍由父组件的
 *   `scrollPositions` 状态承担（详见 Wave 0 的 reducer 以及 Task 5.1 的
 *   完整 wiring）。
 *
 * 设计约束：
 * - 浅色主题：右栏底色为白色，使用 `text-slate-* / bg-slate-* / border-slate-*`
 *   浅色语义；禁止出现 `text-white/* / bg-white/5 / border-white/*` 这类
 *   深色毛玻璃语义（与 design.md 样式方案的浅色翻译保持一致）。
 * - 紧凑样式：标签使用 `text-[10px]`、`px-2 py-1`，容器 `py-1.5 px-2`，
 *   保证与右栏其它紧凑控件的视觉密度一致。
 * - 不依赖 React Router：标签切换是状态切换而非路由跳转，回调形式保持
 *   父组件控制权。
 *
 * 对应需求：
 * - 需求 4.1：多份 SpecDocument 时展示文档标签栏
 * - 需求 4.2：点击切换展示对应文档（由父组件的 `onTabClick` 处理）
 * - 需求 4.4：流式生成中的文档标签展示脉冲圆点
 */

import type { FC, MouseEvent } from "react";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/**
 * 单份文档在标签栏中的可视化描述。
 *
 * - `id`：文档稳定标识，必须与父组件 `documents` 中的 `documentId` 对齐。
 * - `title`：标签上展示的文本；父组件可通过 `deriveDocumentTitle` 等纯函数
 *   把 `BlueprintSpecDocument.title`、locale 占位等合并成最终展示标题。
 * - `isStreaming`：当前文档是否仍在流式追加；为 true 时展示脉冲圆点。
 */
export interface DocTabBarItem {
  id: string;
  title: string;
  isStreaming: boolean;
}

/**
 * `DocTabBar` 的对外 props。
 *
 * 与 design.md「关键接口」一节保持一致：
 * - `documents`：按显示顺序排列的标签列表；空数组或仅 1 项时由父组件决定
 *   是否渲染本组件，本组件不做"少于 2 项是否隐藏"的隐式判断，避免与父组件
 *   `documentIds.length > 1` 控制条件冲突。
 * - `activeDocId`：当前活跃文档 id；用于决定哪个标签套用 active 样式。
 * - `onTabClick`：点击标签时的回调；父组件负责调用 `setActiveDocId` 并
 *   触发滚动位置恢复。
 */
export interface DocTabBarProps {
  documents: ReadonlyArray<DocTabBarItem>;
  activeDocId: string | null;
  onTabClick: (docId: string) => void;
}

// ---------------------------------------------------------------------------
// 样式
// ---------------------------------------------------------------------------

const CONTAINER_CLASS =
  "flex items-center gap-1 border-b border-slate-200 px-2 py-1.5 overflow-x-auto";

const TAB_BASE_CLASS =
  "px-2 py-1 text-[10px] rounded cursor-pointer whitespace-nowrap transition flex items-center";

const TAB_DEFAULT_CLASS = `${TAB_BASE_CLASS} text-slate-500 hover:bg-slate-100 hover:text-slate-700`;

const TAB_ACTIVE_CLASS = `${TAB_BASE_CLASS} text-slate-800 bg-slate-200 font-medium`;

const STREAM_DOT_CLASS =
  "w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse ml-1";

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

/**
 * 流式文档标签栏。
 */
export const DocTabBar: FC<DocTabBarProps> = ({
  documents,
  activeDocId,
  onTabClick,
}) => {
  if (documents.length === 0) return null;

  const handleClick = (id: string) => (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    onTabClick(id);
  };

  return (
    <div
      className={CONTAINER_CLASS}
      data-testid="streaming-doc-tabs"
      role="tablist"
      aria-label="document tabs"
      style={{
        // 硬约束 DocTabBar 不超过父容器宽度。该容器是 flex flex-col 父容器
        // 的 cross-axis stretch 子项，应当等于父级宽度，但当内部有大量
        // whitespace-nowrap 子元素时，flex item 默认 min-width: auto = min-content
        // 会让本元素膨胀到所有 tab 总宽度（曾达到 15000+px）。
        // inline width / maxWidth 强制锁定到 100%，配合 overflow-x: auto
        // 让多 tab 转为水平滚动而不是撑大父容器。
        // 关键：本元素作为 flex item 必须 min-width: 0，否则 min-width: auto
        // 会让本身退化为 min-content；flex-shrink 保持默认 1 让它跟随父级宽度。
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        boxSizing: "border-box",
      }}
    >
      {documents.map((doc) => {
        const isActive = doc.id === activeDocId;
        return (
          <button
            key={doc.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={handleClick(doc.id)}
            className={isActive ? TAB_ACTIVE_CLASS : TAB_DEFAULT_CLASS}
            data-testid={`streaming-doc-tab-${doc.id}`}
            data-active={isActive ? "true" : "false"}
            data-streaming={doc.isStreaming ? "true" : "false"}
            style={{
              // 每个 tab 也需要 maxWidth 防止单个长标题撑大滚动条。
              maxWidth: "180px",
              flexShrink: 0,
            }}
          >
            <span
              className="overflow-hidden text-ellipsis whitespace-nowrap"
              style={{ maxWidth: "160px", display: "inline-block" }}
              title={doc.title}
            >
              {doc.title}
            </span>
            {doc.isStreaming ? (
              <span
                className={STREAM_DOT_CLASS}
                aria-label="streaming"
                data-testid={`streaming-doc-tab-pulse-${doc.id}`}
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
};

export default DocTabBar;
