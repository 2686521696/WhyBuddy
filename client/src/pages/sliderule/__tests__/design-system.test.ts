/**
 * 设计系统：选择器必须真的改变生成结果，且默认那套不许动。
 *
 * 这份判据挡三件不会报错的事：
 *   一、默认种子色偏离 brandSeed —— 存量应用颜色被静默换掉；
 *   二、选择器接了 UI 没接链路 —— 点了有反应、生成出来一模一样（本仓"闸全绿但
 *       东西没了"的标准形状）；
 *   三、DESIGN.md 与真正渲染的色板分叉 —— identity_theme_presets.json 的
 *       brandSeed 注释专门警告过这个。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_DESIGN_SYSTEM_ID,
  DESIGN_SYSTEMS,
  findDesignSystem,
} from "../design-system";
import themePresets from "@identity-themes";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("设计系统清单", () => {
  it("默认那套的种子色 = brandSeed（升级不许换掉存量应用的颜色）", () => {
    const def = findDesignSystem(DEFAULT_DESIGN_SYSTEM_ID);
    const brand = (themePresets as { brandSeed: { seed: string } }).brandSeed;
    expect(def.seed.toLowerCase()).toBe(brand.seed.toLowerCase());
  });

  it("每套都有合法种子色，且互不相同（同色两套等于白给一个选项）", () => {
    const seeds = DESIGN_SYSTEMS.map(s => s.seed.toLowerCase());
    for (const s of DESIGN_SYSTEMS) {
      expect(s.seed, `${s.id} 种子色非法`).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.description.length).toBeGreaterThan(0);
    }
    expect(new Set(seeds).size).toBe(seeds.length);
    expect(DESIGN_SYSTEMS.length).toBeGreaterThanOrEqual(3);
  });

  it("认不出的 id 静默回落默认，不炸作曲家", () => {
    expect(findDesignSystem("不存在").id).toBe(DEFAULT_DESIGN_SYSTEM_ID);
    expect(findDesignSystem(null).id).toBe(DEFAULT_DESIGN_SYSTEM_ID);
    expect(findDesignSystem(undefined).id).toBe(DEFAULT_DESIGN_SYSTEM_ID);
  });
});

describe("选择器接线：UI 动了，生成也要跟着动", () => {
  const read = (rel: string) =>
    stripComments(readFileSync(new URL(rel, import.meta.url), "utf8"));

  it("作曲家挂了选择器，且首页/会话内都渲染（不许写成 hero &&）", () => {
    const src = read("../ComposerDock.tsx");
    expect(src).toContain("sliderule-composer-design-system");
    expect(src).toContain("saveDesignSystemId");
    // ⚠ 2026-08-25 两轮都改到这条：
    //   一轮：原文写死 `DESIGN_SYSTEMS.map`，菜单改成渲染"自建+预设"合并清单后假红；
    //   二轮：清单整块搬去右侧栏（DesignSystemRail），作曲家里只剩触发按钮。
    //   它反复假红的根因是**盯的是清单渲染在哪个文件里**，而这条用例真正要钉的
    //   是"作曲家上有触发入口、且首页和会话内都渲染"。所以只留后者。
    const railSrc = stripComments(
      readFileSync(new URL("../DesignSystemRail.tsx", import.meta.url), "utf8")
    );
    expect(railSrc).toContain("allDesignSystems");
    expect(railSrc).toMatch(/list\.map/);
    /**
     * ⚠ 反向：设备切换是 `hero ? (...) : null`，设计系统**不是**。
     * 用户两张截图分别圈了首页和会话内的指令框，两处都要有。
     * 把它包进 hero 判断里，这条必红。
     */
    const at = src.indexOf("sliderule-composer-design-system");
    const before = src.slice(Math.max(0, at - 700), at);
    expect(before).not.toMatch(/\{hero \?\s*\($/);
  });

  it("选择真的进了推演 payload（只存 localStorage 不发出去 = 纯装饰）", () => {
    const session = read("../useSlideRuleSession.ts");
    expect(session).toContain("designSystemId: loadDesignSystemId()");

    // 两个驱动入口（同步 / 流式）都要带上——本仓"只改一半"的经典位置：
    // 流式是前端主路径，只改同步等于没改。
    const driver = read("../../../lib/sliderule-marathon-driver.ts");
    const sites = driver.match(/designSystemId: opts\.designSystemId/g) ?? [];
    expect(sites.length).toBe(2);
  });

  it("后端按轮取种子色，不是读模块常量", () => {
    const block = stripComments(
      readFileSync(
        new URL(
          "../../../../../slide-rule-python/services/freeform_block.py",
          import.meta.url
        ),
        "utf8"
      ).replace(/#.*$/gm, "")
    );
    expect(block).toContain("active_brand_seed");
    // 反向：色板派生处不许再直接用模块常量 BRAND_SEED，
    // 那样选择器会变成纯装饰（UI 动了、颜色没动）。
    expect(block).not.toMatch(/derive_prompt_palette\(\s*BRAND_SEED/);
  });
});

describe("DESIGN.md 与渲染色板同源", () => {
  it("每套设计系统都有对应的 DESIGN.md，且 primary 就是种子色", () => {
    for (const sys of DESIGN_SYSTEMS) {
      const md = readFileSync(
        new URL(
          `../../../../../slide-rule-python/services/data/design-md/${sys.id}.DESIGN.md`,
          import.meta.url
        ),
        "utf8"
      );
      // primary 必须逐位等于种子色：DESIGN.md 是种子色的投影，不是另一份真相
      expect(md).toContain(`primary: "${sys.seed}"`);
      expect(md).toContain(`name: ${sys.label}`);
      // Do's and Don'ts 是模型猜不出来的那部分，缺了这份文档就只剩色值
      expect(md).toContain("## Do's and Don'ts");
    }
  });

  it("DESIGN.md 不许过期（改了表不重跑生成器 = 模型照着旧颜色写）", () => {
    /**
     * ⚠ 这是本仓「生成侧 / 消费侧」那一对的标准形状：design_systems.json 是源，
     * DESIGN.md 是投影。改了源不重跑生成器不会报错，只会让喂给模型的颜色和真正
     * 渲染的颜色悄悄分叉——identity_theme_presets.json 的 brandSeed 注释警告过。
     * 这里直接调生成器的 --check。
     */
    const { execFileSync } =
      require("node:child_process") as typeof import("node:child_process");
    const root = new URL("../../../../../", import.meta.url).pathname;
    const run = () =>
      execFileSync("node", ["scripts/generate-design-md.mjs", "--check"], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    expect(run()).toContain("matches design_systems.json");
  });
});
