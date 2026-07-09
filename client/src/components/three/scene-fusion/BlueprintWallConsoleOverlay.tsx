/**
 * BlueprintWallConsoleOverlay - 蓝图墙面流程图底部 console overlay（纯 React 组件）。
 *
 * 把 `deriveBlueprintWallProcessData(...).consoleLines` 渲染为参考图里墙面底部的
 * 流程 console：浅色半透明背景、紧凑的等宽字体行、命令样式前缀（`›`）与按 tone
 * 着色的状态文本。
 *
 * 设计要点（对应 design「### `BlueprintWallConsole`」+ Req 7.4 / 7.5 / 7.6 / 7.7）：
 *  - **唯一数据源**：所有 console 行来自传入的 `BlueprintWallConsoleLine[]`，本组件不
 *    读取任何 store / 网络 / mission-first 沙箱状态，也不臆造行内容（Req 7.5）。
 *  - **空态收敛**：`consoleLines` 为空时渲染一个**空 console 壳**（带稳定 data 属性、
 *    无有意义内容），不显示占位文案以外的任何臆造行（Req 7.5）。
 *  - **行数受控**：行数已由 deriver 端 `maxConsoleLines` 截断（默认 8），本组件只负责
 *    渲染传入的行，不再二次扩展（Req 7.7）。
 *  - **墙面安全**：底部 overlay 固定贴墙面底沿、限定高度，且由调用方以
 *    `pointerEvents: "none"` 挂载，不拦截墙面图的指针事件，也不遮挡 fit view 下的
 *    关键图内容（Req 7.4 / 7.6）。
 *  - **纯函数组件**：无 hook、无副作用、确定性输出，可被 `react-dom/server`
 *    `renderToStaticMarkup` 直接渲染（Task 5.4 / 本组件测试）。
 *  - **本地化**：支持 `zh-CN`（默认）与 `en-US` 两套标签 / 空态文案。
 *
 * 作用域护栏（Req 3.7 / 4.4 / 4.5）：本组件**不得** import `useSandboxStore` /
 * `SandboxMonitor` / `MissionWallTaskPanel`。
 */

import type { AppLocale } from "@/lib/locale";

import type {
  BlueprintWallConsoleLine,
  BlueprintWallProcessData,
} from "./blueprint-wall-process-data";

// ─── Component props ─────────────────────────────────────────────────────────

export interface BlueprintWallConsoleOverlayProps {
  /** `Wall_Process_Data.consoleLines`（唯一 console 数据源）。 */
  consoleLines: BlueprintWallProcessData["consoleLines"];
  /** 本地化语言；缺省回退 `DEFAULT_CONSOLE_LOCALE`（zh-CN）。 */
  locale?: AppLocale;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** console overlay 缺省 locale（与 deriver 的 `locale ?? "zh-CN"` 口径一致）。 */
const DEFAULT_CONSOLE_LOCALE: AppLocale = "zh-CN";

/** console 行命令样式前缀（参考图：command-like prefix）。 */
const CONSOLE_LINE_PREFIX = "›";

/** console 标题（本地化）。 */
const CONSOLE_TITLE: Record<AppLocale, string> = {
  "zh-CN": "流程控制台",
  "en-US": "PROCESS CONSOLE",
};

/** 空态文案（本地化，Req 7.5）。 */
const CONSOLE_EMPTY_LABEL: Record<AppLocale, string> = {
  "zh-CN": "暂无日志",
  "en-US": "No console output",
};

/** 按 tone 映射的行文本颜色（克制取色，浅色画布友好）。 */
const TONE_COLOR: Record<BlueprintWallConsoleLine["tone"], string> = {
  muted: "#94a3b8",
  info: "#475569",
  success: "#16a34a",
  warning: "#d97706",
  error: "#dc2626",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** 解析 console overlay 实际使用的 locale（缺省回退 zh-CN）。 */
function resolveLocale(locale: AppLocale | undefined): AppLocale {
  return locale ?? DEFAULT_CONSOLE_LOCALE;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const consoleStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  padding: "10px 14px",
  maxHeight: 168,
  overflow: "hidden",
  borderRadius: 12,
  background:
    "linear-gradient(180deg, rgba(248,250,252,0.82), rgba(241,245,249,0.7))",
  border: "1px solid rgba(203,213,225,0.55)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.6)",
  fontFamily:
    "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
};

const titleStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 1,
  textTransform: "uppercase",
  color: "#94a3b8",
  fontFamily:
    "system-ui, -apple-system, 'Segoe UI', 'Noto Sans SC', sans-serif",
};

const linesStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
};

const lineStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 6,
  fontSize: 12,
  lineHeight: 1.4,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const prefixStyle: React.CSSProperties = {
  flexShrink: 0,
  color: "#cbd5e1",
  fontWeight: 600,
};

const lineTextStyle: React.CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const emptyStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#cbd5e1",
  fontStyle: "italic",
};

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * 蓝图墙面流程图底部 console overlay。
 *
 * 渲染稳定可测的 DOM：根节点带 `data-wall-console` 与 `data-console-state`
 * （`empty` | `lines`）。每行带 `data-console-line-id` 与 `data-console-tone`。
 * 纯函数、无副作用、确定性输出。
 */
export function BlueprintWallConsoleOverlay({
  consoleLines,
  locale,
}: BlueprintWallConsoleOverlayProps): React.ReactElement {
  const activeLocale = resolveLocale(locale);
  const isEmpty = consoleLines.length === 0;

  return (
    <div
      data-wall-console
      data-console-state={isEmpty ? "empty" : "lines"}
      style={consoleStyle}
    >
      <span style={titleStyle}>{CONSOLE_TITLE[activeLocale]}</span>
      {isEmpty ? (
        <span data-console-empty style={emptyStyle}>
          {CONSOLE_EMPTY_LABEL[activeLocale]}
        </span>
      ) : (
        <div style={linesStyle}>
          {consoleLines.map(line => (
            <div
              key={line.id}
              data-console-line-id={line.id}
              data-console-tone={line.tone}
              style={lineStyle}
            >
              <span style={prefixStyle}>{CONSOLE_LINE_PREFIX}</span>
              <span style={{ ...lineTextStyle, color: TONE_COLOR[line.tone] }}>
                {line.text}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
