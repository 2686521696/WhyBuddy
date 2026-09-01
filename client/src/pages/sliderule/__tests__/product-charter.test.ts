/**
 * 产品宪章点选。字符串契约不变，变的是范围卡不许再让用户打字。
 *
 * 变异：parse 丢掉「电商行业」→ 电商、toggle 不拼接角色、ScopeCard 改回
 * <input placeholder> —— 本文件必须红。
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

const memStore = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage ??= {
  getItem: (k: string) => memStore.get(k) ?? null,
  setItem: (k: string, v: string) => void memStore.set(k, v),
  removeItem: (k: string) => void memStore.delete(k),
  clear: () => memStore.clear(),
  key: (i: number) => [...memStore.keys()][i] ?? null,
  get length() {
    return memStore.size;
  },
} as Storage;

import {
  CHARTER_FIELD_CHOICES,
  charterFieldChips,
  charterTopicExtras,
  hydrateScopeCharter,
  parseCharterSelections,
  saveProductCharter,
  serializeCharterSelections,
  toggleCharterChoice,
} from "../product-charter";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const CARD_SRC = stripComments(
  readFileSync(new URL("../ScopeCard.tsx", import.meta.url), "utf8")
);
const CHARTER_SRC = stripComments(
  readFileSync(new URL("../product-charter.ts", import.meta.url), "utf8")
);

const INDUSTRY = CHARTER_FIELD_CHOICES.find(row => row.key === "industry")!;
const ROLES = CHARTER_FIELD_CHOICES.find(row => row.key === "defaultRoles")!;

describe("宪章闭集点选", () => {
  it("旧手填值贴到闭集，贴不上的留下可点掉", () => {
    expect(
      parseCharterSelections("电商行业", INDUSTRY.options, false)
    ).toEqual(["电商"]);
    expect(
      parseCharterSelections("管理员，客服", ROLES.options, true)
    ).toEqual(["管理员", "客服"]);
    expect(
      parseCharterSelections("自有品牌色", INDUSTRY.options, false)
    ).toEqual(["自有品牌色"]);
  });

  it("多选拼接、再点取消；单选互斥，再点清空", () => {
    const afterAdmin = toggleCharterChoice("", "管理员", true, ROLES.options);
    expect(afterAdmin).toBe("管理员");
    const afterBoth = toggleCharterChoice(
      afterAdmin,
      "客服",
      true,
      ROLES.options
    );
    expect(afterBoth).toBe("管理员、客服");
    expect(
      toggleCharterChoice(afterBoth, "管理员", true, ROLES.options)
    ).toBe("客服");
    expect(serializeCharterSelections(["管理员", "客服"])).toBe("管理员、客服");

    const industry = toggleCharterChoice("", "电商", false, INDUSTRY.options);
    expect(industry).toBe("电商");
    expect(
      toggleCharterChoice(industry, "能源电力", false, INDUSTRY.options)
    ).toBe("能源电力");
    expect(
      toggleCharterChoice("能源电力", "能源电力", false, INDUSTRY.options)
    ).toBe("");
  });

  it("范围卡点选写入 toggleCharterChoice，不再摆宪章输入框", () => {
    expect(CARD_SRC).toContain("CHARTER_FIELD_CHOICES");
    expect(CARD_SRC).toContain("toggleCharterChoice");
    expect(CARD_SRC).toContain("pickCharter");
    expect(CARD_SRC).toContain(
      "pickCharter(row.key, option, row.multiple, row.options)"
    );
    expect(CARD_SRC).not.toContain("placeholder={label}");
    expect(CARD_SRC).not.toContain("onChange={e => patchCharter");
    expect(CARD_SRC).not.toMatch(/placeholder=\{label\}/);
    expect(CHARTER_SRC).toContain("export const CHARTER_FIELD_CHOICES");
    expect(CHARTER_SRC).toContain("export function toggleCharterChoice");
  });
});

describe("没勾下一场沿用不许灌上一场宪章", () => {
  beforeEach(() => {
    memStore.clear();
    try {
      localStorage.clear();
    } catch {
      /* jsdom 没有也没关系，上面 ??= 已经挂了 memStore */
    }
  });

  it("reuse 关着：库存里的企业服务/店长不许出现", () => {
    saveProductCharter({
      industry: "企业服务",
      defaultRoles: "店长、员工",
      terms: "工单、审批",
    });
    expect(hydrateScopeCharter(false)).toEqual({});
  });

  it("reuse 开着：才把库存灌回来", () => {
    saveProductCharter({
      industry: "企业服务",
      defaultRoles: "店长、员工",
    });
    expect(hydrateScopeCharter(true)).toEqual({
      industry: "企业服务",
      defaultRoles: "店长、员工",
    });
  });

  it("股票分析器补行情/持仓/投资者，不预选；宠物医院不掺这些", () => {
    const extras = charterTopicExtras("股票分析器");
    expect(extras.terms).toEqual(["行情", "持仓", "K线"]);
    expect(extras.defaultRoles).toEqual(["投资者", "分析师"]);
    expect(charterTopicExtras("连锁宠物医院管理系统")).toEqual({});

    const terms = CHARTER_FIELD_CHOICES.find(row => row.key === "terms")!;
    const chips = charterFieldChips({}, terms, "做一个股票分析器");
    expect(chips).toContain("行情");
    expect(chips).toContain("工单");
    const petChips = charterFieldChips({}, terms, "连锁宠物医院管理系统");
    expect(petChips).not.toContain("行情");
  });
});
