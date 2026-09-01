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

/** 范围卡上的闭集选项。点选写入上面的字符串字段，禁止再摆空输入框。 */
export type CharterFieldChoice = {
  key: keyof ProductCharter;
  label: string;
  multiple: boolean;
  options: readonly string[];
};

export const CHARTER_FIELD_CHOICES: readonly CharterFieldChoice[] = [
  {
    key: "industry",
    label: "行业",
    multiple: false,
    options: [
      "电商",
      "零售连锁",
      "医疗健康",
      "教育培训",
      "制造",
      "能源电力",
      "金融",
      "政务",
      "物流仓储",
      "餐饮",
      "企业服务",
    ],
  },
  {
    key: "terms",
    label: "术语",
    multiple: true,
    options: ["工单", "审批", "台账", "档案", "门店", "SKU", "预约", "库存"],
  },
  {
    key: "defaultRoles",
    label: "默认角色",
    multiple: true,
    options: [
      "管理员",
      "店长",
      "员工",
      "客服",
      "客户",
      "审批人",
      "财务",
      "运营",
      "调度员",
    ],
  },
  {
    key: "hardCompliance",
    label: "硬性合规",
    multiple: true,
    options: ["个人信息保护", "等级保护", "财务审计", "安全生产", "行业许可"],
  },
  {
    key: "brandConstraints",
    label: "品牌约束",
    multiple: true,
    options: ["简洁克制", "专业稳重", "消费互联网风格", "政企风格"],
  },
] as const;

const CHOICE_SPLIT = /[、，,;；/|]+/;

function choiceCatalog(key: keyof ProductCharter): CharterFieldChoice | undefined {
  return CHARTER_FIELD_CHOICES.find(row => row.key === key);
}

/**
 * 把已存字符串拆成选中项。旧的手填值（「电商行业」「管理员，客服」）
 * 尽量贴到闭集；贴不上的保留成可点掉的自定义项，不再变成输入框。
 */
export function parseCharterSelections(
  value: string | undefined,
  options: readonly string[],
  multiple: boolean
): string[] {
  const raw = String(value || "").trim();
  if (!raw) return [];
  if (!multiple) {
    const hit = options.find(option => raw === option || raw.includes(option));
    return [hit || raw];
  }
  const out: string[] = [];
  for (const part of raw.split(CHOICE_SPLIT).map(piece => piece.trim()).filter(Boolean)) {
    const hit =
      options.find(option => part === option) ||
      options.find(option => part.includes(option) || (part.length >= 2 && option.includes(part)));
    const token = hit || part;
    if (!out.includes(token)) out.push(token);
  }
  return out;
}

export function serializeCharterSelections(selected: readonly string[]): string {
  return selected.map(item => item.trim()).filter(Boolean).join("、");
}

export function toggleCharterChoice(
  current: string | undefined,
  option: string,
  multiple: boolean,
  options: readonly string[]
): string {
  const picked = option.trim();
  if (!picked) return String(current || "").trim();
  const selected = parseCharterSelections(current, options, multiple);
  if (!multiple) {
    return selected.length === 1 && selected[0] === picked ? "" : picked;
  }
  const next = selected.includes(picked)
    ? selected.filter(item => item !== picked)
    : [...selected, picked];
  return serializeCharterSelections(next);
}

export function charterSelectionsFor(
  charter: ProductCharter,
  key: keyof ProductCharter
): string[] {
  const row = choiceCatalog(key);
  if (!row) return [];
  return parseCharterSelections(charter[key], row.options, row.multiple);
}

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

/**
 * 范围卡上的宪章初值。
 *
 * ⚠ 2026-09-01 真机：股票分析器范围卡亮着上一场的「企业服务 / 店长 /
 * 员工」。文案写着「不勾选不会带进下一场」，`useState(loadProductCharter)`
 * 却无条件灌 localStorage。没勾「下一场沿用」必须空着手开。
 */
export function hydrateScopeCharter(reuseNext: boolean): ProductCharter {
  if (!reuseNext) return {};
  return loadProductCharter();
}

/**
 * 命题里能对上的术语/角色，作为闭集之外的可点选项。不预选——预选就是
 * 把上一场模型当先验，正是「下一场沿用」那条要挡住的。
 *
 * 行业闭集已经有「金融」；股票分析器缺的是术语「行情/持仓」和角色
 * 「投资者」，不是再发明一套行业表。
 */
const TOPIC_EXTRAS: ReadonlyArray<{
  test: RegExp;
  extras: Partial<Record<keyof ProductCharter, readonly string[]>>;
}> = [
  {
    test: /股票|证券|行情|投研|A股|基金|持仓|K线/,
    extras: {
      terms: ["行情", "持仓", "K线"],
      defaultRoles: ["投资者", "分析师"],
    },
  },
];

export function charterTopicExtras(
  text: string
): Partial<Record<keyof ProductCharter, string[]>> {
  const src = String(text || "");
  const out: Partial<Record<keyof ProductCharter, string[]>> = {};
  for (const row of TOPIC_EXTRAS) {
    if (!row.test.test(src)) continue;
    for (const key of FIELDS) {
      const added = row.extras[key];
      if (!added || added.length === 0) continue;
      const bucket = out[key] || [];
      for (const item of added) {
        if (!bucket.includes(item)) bucket.push(item);
      }
      out[key] = bucket;
    }
  }
  return out;
}

/** 闭集 + 已选自定义 + 命题 extras。选中态由 charter 字符串单独算。 */
export function charterFieldChips(
  charter: ProductCharter,
  row: CharterFieldChoice,
  topicText?: string
): string[] {
  const selected = parseCharterSelections(
    charter[row.key],
    row.options,
    row.multiple
  );
  const catalog = new Set<string>(row.options);
  const extras = selected.filter(item => !catalog.has(item));
  const topic = (charterTopicExtras(topicText || "")[row.key] || []).filter(
    item => !catalog.has(item) && !extras.includes(item)
  );
  return [...row.options, ...extras, ...topic];
}
