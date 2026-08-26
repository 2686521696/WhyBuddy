/**
 * 产品宪章点选。字符串契约不变，变的是范围卡不许再让用户打字。
 *
 * 变异：parse 丢掉「电商行业」→ 电商、toggle 不拼接角色、ScopeCard 改回
 * <input placeholder> —— 本文件必须红。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  CHARTER_FIELD_CHOICES,
  parseCharterSelections,
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
