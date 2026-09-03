/**
 * 工厂公开跳：从人话里抠出唯一工具名。
 *
 * 抄 grok-build AskUserQuestion：选项点下去是 typed 答案（Accepted），
 * 不是把标签当新 prompt 再问一轮模型。面团收尾卡
 * 「进入数据模型反推（Structure）」必须认出 structure，走 forcedTool，
 * 不许当聊天发出去（2026-09-03 真机：点了 Structure 又弹伴随式卡、
 * 控制面去 planning）。
 *
 * 跟 Python `closed_tools.factory_hop_from_text` 同一把尺子。
 */
export const FACTORY_HOPS = [
  "spec",
  "pages",
  "structure",
  "bind",
  "closure",
] as const;

export type FactoryHop = (typeof FACTORY_HOPS)[number];

/** 账本上的 WRITE 身份。跟 Python `closed_tools.factory_capability_id` 同一把尺子。 */
export const FACTORY_CAP_PREFIX = "factory.";

/** 左栏人话。跟 Python `closed_tools.FACTORY_HOP_LABELS` 同一套。 */
export const FACTORY_HOP_LABELS: Record<FactoryHop, string> = {
  spec: "起草规格：成功判据、需求节点与页面清单",
  pages: "逐页画界面（并发）",
  structure: "从界面反推数据模型与关联关系",
  bind: "给界面接上数据",
  closure: "完整性检查与发布闭环",
};

export function factoryCapabilityId(hop: FactoryHop): string {
  return `${FACTORY_CAP_PREFIX}${hop}`;
}

export function hopFromFactoryCapability(
  capabilityId: string
): FactoryHop | undefined {
  const raw = String(capabilityId || "").trim();
  if (!raw.startsWith(FACTORY_CAP_PREFIX)) return undefined;
  const hop = raw.slice(FACTORY_CAP_PREFIX.length) as FactoryHop;
  return (FACTORY_HOPS as readonly string[]).includes(hop) ? hop : undefined;
}

const HOP_ID_RE = /(?:^|[^\w])(spec|pages|structure|bind|closure)(?:[^\w]|$)/gi;

const ZH: Array<[RegExp, FactoryHop]> = [
  [/数据模型反推|数据结构/, "structure"],
  [/权限绑定|权限工作流/, "bind"],
  [/页面生成|画页面/, "pages"],
  [/起草\s*SPEC|起草规格/, "spec"],
  [/完整性检查|上线闭环/, "closure"],
  // 闭环发布后面不能是「管理/系统/平台/应用」——那是新产品名。
  [/闭环发布(?!管理|[系统平台应用])/, "closure"],
];

function hopIdsIn(text: string): FactoryHop[] {
  const found: FactoryHop[] = [];
  const seen = new Set<string>();
  HOP_ID_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HOP_ID_RE.exec(text))) {
    const id = m[1].toLowerCase() as FactoryHop;
    if (!seen.has(id)) {
      seen.add(id);
      found.push(id);
    }
  }
  return found;
}

export function factoryHopFromText(text: string): FactoryHop | undefined {
  const t = text.trim();
  if (!t) return undefined;
  const ids = hopIdsIn(t);
  if (ids.length === 1) return ids[0];
  if (ids.length > 1) return undefined;
  const zh: FactoryHop[] = [];
  const seen = new Set<string>();
  for (const [pat, hop] of ZH) {
    if (pat.test(t) && !seen.has(hop)) {
      seen.add(hop);
      zh.push(hop);
    }
  }
  return zh.length === 1 ? zh[0] : undefined;
}

export function looksLikeFactoryHopCommand(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (factoryHopFromText(t)) return true;
  return hopIdsIn(t).length >= 1;
}
