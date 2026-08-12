/**
 * design-defect-detector — 对**渲染产出**做机械体检（2026-08-12）。
 *
 * ## 为什么要有它
 *
 * 这条链路一直只有"对模型的门禁"（v5_model_gate 查结构、引用、合法域），
 * **对设计产出零检查**。于是首页版式坏了没有任何东西会红：
 *
 *   · 真跑三个话题，律所那张首页顶层 flex 行摆了 5 个子列，最后两列写的是
 *     `width:100%` 且没有 flex —— 在行容器里这等于"我要 1440px"然后被
 *     flex-shrink 压成 120px，中文标题竖着一字一行。测试全绿、门禁全过。
 *   · 页头把近黑 #0f172a 当正文色写死，深色配方下看不见（今天修过）。
 *   · 11px 提示文字用 #bfbfbf，对白底只有 2.3:1（今天修过）。
 *
 * 前两条只有**布局算完之后**才存在——`width:100%` 静态看毫无问题。所以体检
 * 必须发生在渲染之后，量真实几何。
 *
 * ## 判据来自哪里
 *
 * 抄的是 pbakaus/impeccable 的浏览器检测器（Apache-2.0，8730 行，注入页面里
 * `window.impeccableScan()`）。它的 critique 流程把"检测器证据"列为硬性要求：
 * 跳过检测器就算这次评审失败。三条判据的来源：
 *
 *   text-clip     照抄 checkElementTextOverflowDOM：只判**自己持有文字**的
 *                 元素（祖先的 scrollWidth 是从溢出的子孙那儿继承来的，
 *                 会把整条祖先链一起报），且没有可滚动祖先（那种溢出是故意的）
 *   low-contrast  照抄它的 relativeLuminance / contrastRatio 与 WCAG 大字号
 *                 阈值（18pt / 14pt 粗体换成 px）
 *   char-wrap     **我们自己加的**。impeccable 的
 *                 checkFirstViewportColumnOverflowDOM 判的是"并排两列内容高度
 *                 悬殊"，而我们撞到的是"列太窄导致逐字换行"。CJK 里这个症状比
 *                 列宽阈值更准：直接量"平均每行几个字"，语言无关、不用猜 px 下限。
 *
 * ## 形态：纯函数吃快照
 *
 * 这个模块**不碰 DOM**。浏览器那边（scripts/detect-design-defects.mjs）走一遍
 * DOM 把几何和算好的样式收成一份 JSON，这里只做判断。这样：
 *   · 单测拿合成快照就能跑，不需要浏览器
 *   · 判据和采集分开，换渲染路径（手机档、参照图预览）只要换采集
 */

/** 采集侧量好的一个节点。字段刻意只留判据用得到的。 */
export interface MeasuredNode {
  /** 定位用的可读选择器，只进报告 */
  selector: string;
  tag: string;
  /** 这个元素**自己**持有的文字（不含子孙），已 trim */
  ownText: string;
  rect: { x: number; y: number; width: number; height: number };
  /** getComputedStyle 里判据用得到的那几个 */
  display: string;
  flexDirection: string;
  overflowX: string;
  overflow: string;
  fontSizePx: number;
  fontWeight: number;
  lineHeightPx: number;
  /** 前景色，rgb 三元组；采集不到给 null */
  color: { r: number; g: number; b: number } | null;
  /**
   * **有效**背景色：采集侧沿祖先链找到的第一个不透明背景。渲染层的卡片背景
   * 常常在祖先上，只看自己会永远拿到 transparent、把每一处文字都判成低对比。
   */
  effectiveBackground: { r: number; g: number; b: number } | null;
  scrollWidth: number;
  clientWidth: number;
  /** 有没有可滚动祖先（含自己）——有就说明溢出是故意的，可滚 */
  insideScrollRegion: boolean;
  /** 屏幕阅读器专用（sr-only）之类，视觉上本来就不显示 */
  visuallyHidden: boolean;
}

export interface MeasuredSnapshot {
  viewport: { width: number; height: number };
  nodes: MeasuredNode[];
}

export type DefectId = "text-clip" | "low-contrast" | "char-wrap";

export interface DesignDefect {
  id: DefectId;
  selector: string;
  /** 一句话说清坏在哪，带上量出来的数 */
  message: string;
  severity: "critical" | "warning";
}

/** WCAG 的大字号阈值是按**磅**定义的（18pt 正文 / 14pt 粗体），换成 px。 */
const WCAG_LARGE_TEXT_PX = 18 * (96 / 72); // 24
const WCAG_LARGE_BOLD_TEXT_PX = 14 * (96 / 72); // ≈18.67

/** 溢出多少才算——16px 是 impeccable 的取值，低于它多半是子像素噪声。 */
const TEXT_CLIP_MIN_DELTA = 16;

/**
 * 每行平均几个字算"逐字换行"。
 *
 * 2.0 而不是 1.0：真实产出里"案件名称 1"这种 6 字串被压成 3 行（"案件名"
 * "称" "1"），平均 2 字/行——按 1.0 判会漏掉。而正常排版即使很窄的一栏也
 * 有 4 字以上，所以 2.0 留得开。
 */
const CHAR_WRAP_MAX_CHARS_PER_LINE = 2.0;

/** 太短的串不判：一两个字本来就该一行一个。 */
const CHAR_WRAP_MIN_TEXT_LENGTH = 4;

/**
 * 一行最多塞几个字（保守下界）。
 *
 * 按"每个字占满一个 em"算——中日韩全角字就是这样，拉丁字母和数字都比这窄。
 * 所以这个容量是**低估**的：宁可少跳过（多报），不会因为高估容量而漏掉真缺陷。
 */
function oneLineCapacity(widthPx: number, fontSizePx: number): number {
  return Math.floor(widthPx / fontSizePx);
}

/** 这些标签的文字溢出不算缺陷（可滚代码块、输入框自己管）。 */
const TEXT_SKIP_TAGS = new Set([
  "pre", "code", "input", "textarea", "select", "option", "svg", "canvas",
]);

function srgbChannel(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 相对亮度。公式与 impeccable 的 relativeLuminance 一致。 */
export function relativeLuminance(c: { r: number; g: number; b: number }): number {
  return (
    0.2126 * srgbChannel(c.r) + 0.7152 * srgbChannel(c.g) + 0.0722 * srgbChannel(c.b)
  );
}

/** WCAG 对比度，1~21。 */
export function contrastRatio(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number }
): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** 这个字号+字重下 WCAG AA 要求的最低对比度。 */
export function requiredContrast(fontSizePx: number, fontWeight: number): number {
  const isLarge =
    fontSizePx >= WCAG_LARGE_TEXT_PX ||
    (fontSizePx >= WCAG_LARGE_BOLD_TEXT_PX && fontWeight >= 700);
  return isLarge ? 3 : 4.5;
}

/** 有没有自己持有可见文字。 */
function ownsText(n: MeasuredNode): boolean {
  return n.ownText.length > 0 && !n.visuallyHidden;
}

function isRendered(n: MeasuredNode): boolean {
  return n.rect.width > 0 && n.rect.height > 0 && !n.visuallyHidden;
}

/**
 * ① 文字被裁掉。
 *
 * 只判**自己持有文字**的元素：祖先的 scrollWidth 是从溢出的子孙继承来的，
 * 不加这道闸会把整条祖先链一起报（impeccable 那边的注释记着同一个坑）。
 */
export function detectTextClip(snapshot: MeasuredSnapshot): DesignDefect[] {
  const out: DesignDefect[] = [];
  for (const n of snapshot.nodes) {
    if (TEXT_SKIP_TAGS.has(n.tag)) continue;
    if (!ownsText(n) || !isRendered(n)) continue;
    if (n.insideScrollRegion) continue; // 可滚的溢出是故意的
    if (n.clientWidth <= 0) continue;
    const delta = n.scrollWidth - n.clientWidth;
    if (delta >= TEXT_CLIP_MIN_DELTA) {
      out.push({
        id: "text-clip",
        selector: n.selector,
        message: `文字超出盒子 ${Math.round(delta)}px 且无处可滚 —— 「${n.ownText.slice(0, 14)}」被裁掉`,
        severity: "critical",
      });
    }
  }
  return out;
}

/**
 * ② 对比度不足（WCAG AA）。
 *
 * 前景或有效背景取不到就跳过——**不猜**。渐变背景、图片背景上的文字这条判不了，
 * 硬判会把它们全报成缺陷（那正是"判据严到该严的那层就够"的老规矩）。
 */
export function detectLowContrast(snapshot: MeasuredSnapshot): DesignDefect[] {
  const out: DesignDefect[] = [];
  for (const n of snapshot.nodes) {
    if (!ownsText(n) || !isRendered(n)) continue;
    if (!n.color || !n.effectiveBackground) continue;
    const need = requiredContrast(n.fontSizePx, n.fontWeight);
    const got = contrastRatio(n.color, n.effectiveBackground);
    if (got < need) {
      out.push({
        id: "low-contrast",
        selector: n.selector,
        message:
          `对比度 ${got.toFixed(2)}:1 < 要求的 ${need}:1` +
          `（${Math.round(n.fontSizePx)}px/${n.fontWeight}）—— 「${n.ownText.slice(0, 14)}」`,
        severity: got < need * 0.6 ? "critical" : "warning",
      });
    }
  }
  return out;
}

/**
 * ③ 逐字换行（列被挤到放不下一个词）。
 *
 * 这条是我们自己加的，冲的是真跑逮到的那个形态：顶层 flex 行摆了 5 个子列、
 * 其中两列写 `width:100%` 没写 flex，被压成 120px，中文标题竖着一字一行。
 *
 * 判据用**症状**而不是列宽阈值：量"平均每行几个字"。这样语言无关（中文一个字
 * 一个格、英文一个词好几格，px 下限对两者不是同一个数），而且不用猜断点。
 *
 * 行数由 `height / lineHeight` 推。lineHeight 或字号取不到就跳过——那种情况
 * 推不出行数，宁可漏报。
 *
 * ⚠ 高度推行数有个已知的坑，第一次跑深色首页就踩了：`height / lineHeight` 量的是
 * **整个盒子**，而盒子里可能还有别的元素。深色版农场首页那个 KPI 是
 * `<strong>` 里放了大数字 + 两行子元素，自己的文字「10,900」明明一行放得下
 * （容器 607px、字号 34px），却按高度算出 3 行被报成逐字换行。
 *
 * 所以加一道**可行性闸**：这串字在这个宽度里一行放不下，才谈得上"被挤"。放得下
 * 就说明多出来的高度是别的东西撑的，不是窄。同一个数字在浅色版里容器只有 92px
 * ——那次是真挤——闸门照样放它过去，这才是判据该有的分辨力。
 */
export function detectCharWrap(snapshot: MeasuredSnapshot): DesignDefect[] {
  const out: DesignDefect[] = [];
  for (const n of snapshot.nodes) {
    if (TEXT_SKIP_TAGS.has(n.tag)) continue;
    if (!ownsText(n) || !isRendered(n)) continue;
    const text = n.ownText;
    if (text.length < CHAR_WRAP_MIN_TEXT_LENGTH) continue;
    if (!Number.isFinite(n.lineHeightPx) || n.lineHeightPx <= 0) continue;
    if (!Number.isFinite(n.fontSizePx) || n.fontSizePx <= 0) continue;
    if (text.length <= oneLineCapacity(n.rect.width, n.fontSizePx)) continue;
    const lines = Math.round(n.rect.height / n.lineHeightPx);
    if (lines < 2) continue;
    const perLine = text.length / lines;
    if (perLine <= CHAR_WRAP_MAX_CHARS_PER_LINE) {
      out.push({
        id: "char-wrap",
        selector: n.selector,
        message:
          `${text.length} 个字挤成 ${lines} 行（每行 ${perLine.toFixed(1)} 个）` +
          `，容器只有 ${Math.round(n.rect.width)}px —— 「${text.slice(0, 14)}」`,
        severity: "critical",
      });
    }
  }
  return out;
}

/** 三条一起跑。顺序固定，方便 diff 报告。 */
export function detectDesignDefects(snapshot: MeasuredSnapshot): DesignDefect[] {
  return [
    ...detectCharWrap(snapshot),
    ...detectTextClip(snapshot),
    ...detectLowContrast(snapshot),
  ];
}

/** 按 id 归组计数，报告和断言都用得上。 */
export function summarizeDefects(defects: DesignDefect[]): Record<DefectId, number> {
  const out: Record<DefectId, number> = {
    "char-wrap": 0,
    "text-clip": 0,
    "low-contrast": 0,
  };
  for (const d of defects) out[d.id] += 1;
  return out;
}
