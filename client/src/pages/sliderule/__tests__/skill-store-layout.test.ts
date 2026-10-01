import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  familiesPresent,
  groupSkillsByFamily,
  skillFamilyOf,
} from "../skill-store-layout";

describe("skill-store-layout", () => {
  it("接口带了分类就用接口的，否则按种子 slug", () => {
    expect(skillFamilyOf({ slug: "sliderule" })).toBe("规格");
    expect(skillFamilyOf({ slug: "frontend-design" })).toBe("界面设计");
    expect(skillFamilyOf({ slug: "ui-ux-pro-max" })).toBe("界面设计");
    expect(skillFamilyOf({ slug: "humanizer-zh" })).toBe("内容创作");
    expect(skillFamilyOf({ slug: "internal-comms" })).toBe("办公");
    expect(skillFamilyOf({ slug: "office-skills" })).toBe("办公");
    expect(skillFamilyOf({ slug: "financial-analyst" })).toBe("办公");
    expect(skillFamilyOf({ slug: "accessibility" })).toBe("测试");
    expect(skillFamilyOf({ slug: "systematic-debugging" })).toBe("开发工具");
    expect(skillFamilyOf({ slug: "verification-before-completion" })).toBe("测试");
    expect(skillFamilyOf({ slug: "unknown" })).toBe("其他");
    expect(skillFamilyOf({ slug: "unknown", category: "测试" })).toBe("测试");
    expect(skillFamilyOf({ slug: "react-state-management", category: "开发工具" })).toBe(
      "开发工具",
    );
    expect(skillFamilyOf({ slug: "performance", category: "测试" })).toBe("测试");
  });

  it("分类条只列目录里真有的，不造空货架", () => {
    expect(
      familiesPresent([
        { slug: "sliderule" },
        { slug: "office-skills" },
        { slug: "systematic-debugging" },
        { slug: "frontend-design" },
      ]),
    ).toEqual(["规格", "办公", "开发工具", "界面设计"]);
    expect(familiesPresent([{ slug: "ghost" }])).toEqual(["其他"]);
  });

  it("全部视图按分类分段，空段不出现", () => {
    const groups = groupSkillsByFamily([
      { slug: "verification-before-completion", name: "测" },
      { slug: "sliderule", name: "规格" },
      { slug: "sliderule-b", name: "另一份", category: "规格" },
    ]);
    expect(groups.map(group => group.family)).toEqual(["规格", "测试"]);
    expect(groups[0].items).toHaveLength(2);
    expect(groups[1].items).toHaveLength(1);
  });

  it("兜底表跟种子清单是同一份：下架的不留、新进的不漏（§四）", () => {
    // ⚠ 2026-10-01 技能审查：index.json 从 105 份收到 23 份，这张表要跟着改——只改一边，
    //   下架的技能在前端还有分类、新进的落进「其他」。
    const read = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf-8"));
    const index = read("../../../../../skills/seeds/index.json") as { packages: Array<{ slug: string; category: string }> };
    const retired = Object.keys(read("../../../../../skills/seeds/retired.json").retired as Record<string, string>);
    for (const pkg of index.packages) expect(skillFamilyOf({ slug: pkg.slug })).toBe(pkg.category);
    for (const slug of retired) expect(skillFamilyOf({ slug })).toBe("其他");
    expect(retired).toContain("webapp-testing");
  });
});
