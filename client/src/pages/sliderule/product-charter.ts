/**
 * 产品宪章（opt-in）。范围卡勾「下一场沿用」时写入，confirmControlScope
 * 读出来塞进 control-turn 的额外字段。
 *
 * ⚠ 故意做成无 UI 依赖的小模块：useSlideRuleSession 只许 import 这里，
 *   不许为了读勾选状态去 import ScopeCard / SlideRuleStudio。
 *   2026-08 踩过「会话 hook 为了 helper 拉进重 UI」——那会把测试和循环依赖
 *   一起炸。
 *
 * 不把 Claude.md / AGENTS.md 当宪章。字段白名单跟后端 normalize_charter 对齐。
 */

export type ProductCharter = {
  industry?: string;
  terms?: string;
  defaultRoles?: string;
  hardCompliance?: string;
  brandConstraints?: string;
};

const REUSE_KEY = "sliderule.charterReuseNext";
const CHARTER_KEY = "sliderule.productCharter";

const FIELDS: Array<keyof ProductCharter> = [
  "industry",
  "terms",
  "defaultRoles",
  "hardCompliance",
  "brandConstraints",
];

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* 隐私模式：不记就不记 */
  }
}

export function loadCharterReuseNext(): boolean | null {
  const raw = readStorage(REUSE_KEY);
  if (raw === "1") return true;
  if (raw === "0") return false;
  return null;
}

export function setCharterReuseNext(value: boolean): void {
  writeStorage(REUSE_KEY, value ? "1" : "0");
}

export function normalizeProductCharter(raw: unknown): ProductCharter {
  if (!raw || typeof raw !== "object") return {};
  const src = raw as Record<string, unknown>;
  const out: ProductCharter = {};
  for (const key of FIELDS) {
    const text = String(src[key] ?? "").trim();
    if (!text) continue;
    const lower = text.toLowerCase();
    if (lower.includes("claude.md") || lower.includes("agents.md")) continue;
    out[key] = text.slice(0, 500);
  }
  return out;
}

export function loadProductCharter(): ProductCharter {
  const raw = readStorage(CHARTER_KEY);
  if (!raw) return {};
  try {
    return normalizeProductCharter(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function saveProductCharter(charter: ProductCharter): void {
  writeStorage(CHARTER_KEY, JSON.stringify(normalizeProductCharter(charter)));
}

export function charterHasContent(charter: ProductCharter | null | undefined): boolean {
  if (!charter) return false;
  return FIELDS.some(key => String(charter[key] || "").trim());
}
