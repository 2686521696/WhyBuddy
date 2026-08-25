// @vitest-environment jsdom
/**
 * 自建设计系统的 id 规矩。
 *
 * ⚠ 2026-08-25 真机 bug：编辑预设后点「应用」，清单里出现**两条「面团·品牌」**，
 *   而且两条都打勾。因为 apply 直接 saveCustomDesignSystem(sys) —— sys.id 仍是
 *   预设的 `miantuan`，于是自建表和预设表各有一条同 id，
 *   allDesignSystems() 把两份都铺出来，`on = sys.id === appliedId` 又让两条同时选中。
 *
 * 判据两层：
 *   一、存的时候就不许沿用预设 id（根因）；
 *   二、allDesignSystems 去重兜底（防别处再写出同 id）。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  DESIGN_SYSTEMS,
  allDesignSystems,
  deriveCustomFrom,
  isCustomDesignSystem,
  loadCustomDesignSystems,
  saveCustomDesignSystem,
} from "../design-system";

beforeEach(() => localStorage.clear());

describe("自由风格 = 默认档", () => {
  it("默认没有选择：loadDesignSystemId 返回 null", async () => {
    const { loadDesignSystemId } = await import("../design-system");
    expect(loadDesignSystemId()).toBeNull();
  });

  it("自由风格不是清单里的一条数据", async () => {
    const { allDesignSystems } = await import("../design-system");
    /**
     * ⚠ 它是 `appliedId === null` 这个状态的名字，不是一条假数据。
     * 做成假数据的话，"没选"和"选了自由风格"又会变成两个状态，而它们本来
     * 就是同一件事（后端收不到 designSystemId → 模型自己写风格段）。
     */
    expect(allDesignSystems().some(s => s.id === "free")).toBe(false);
  });

  it("切回自由风格要清掉 localStorage，否则下一轮还带着旧的皮", () => {
    const ctx = readFileSync(
      resolve(
        process.cwd(),
        "client/src/pages/sliderule/DesignSystemContext.tsx"
      ),
      "utf8"
    );
    expect(ctx).toContain("const applyFree");
    expect(ctx).toContain('localStorage.removeItem("sliderule:design-system")');
    expect(ctx).toContain("setAppliedId(null)");
  });

  it("作曲家上自由风格只显示图标，不带字", () => {
    const dock = readFileSync(
      resolve(process.cwd(), "client/src/pages/sliderule/ComposerDock.tsx"),
      "utf8"
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    /**
     * ⚠ 用户原话「底部直接显示这个图标」。挂个「设计系统」的字在那儿会让人以为
     * 已经选了某套；光一个图标才读作"还没钉死，交给 AI"。
     * 把那段文案加回来必红。
     */
    expect(dock).toContain("hero && designSystem ? designSystem.label : null");
    expect(dock).not.toMatch(/:\s*"设计系统"/);
  });
});

describe("自建设计系统不许和预设撞 id", () => {
  it("以预设为基础另存 → 必须换一个新 id", () => {
    const preset = DESIGN_SYSTEMS[0];
    const mine = deriveCustomFrom({ ...preset, seed: "#123456" });
    expect(mine.id).not.toBe(preset.id);
    expect(DESIGN_SYSTEMS.some(s => s.id === mine.id)).toBe(false);
    // 内容带过来，只有 id/label 变
    expect(mine.seed).toBe("#123456");
  });

  it("已经是自建的再存一次 → id 不变（不该每次保存都克隆一份）", () => {
    const preset = DESIGN_SYSTEMS[0];
    const mine = deriveCustomFrom(preset);
    saveCustomDesignSystem(mine);
    const again = deriveCustomFrom({ ...mine, seed: "#abcdef" });
    expect(again.id).toBe(mine.id);
    saveCustomDesignSystem(again);
    expect(loadCustomDesignSystems()).toHaveLength(1);
  });

  it("清单里同一个 id 只出现一次", () => {
    /**
     * ⚠ 这条原本写的是"撞预设 id 时自建赢"——那是**上一版较弱的行为**（只去重）。
     * 现在撞预设 id 的自建数据在读取时就被滤掉了（见下面那条用例），所以这里
     * 只钉"不重复"这件事，用一个真正的自建 id 来验。
     */
    const mine = deriveCustomFrom(DESIGN_SYSTEMS[0]);
    saveCustomDesignSystem(mine);
    saveCustomDesignSystem({ ...mine, label: "改过一次" });
    const list = allDesignSystems();
    const ids = list.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(list.find(s => s.id === mine.id)?.label).toBe("改过一次");
  });

  it("面板的「应用」必须过 deriveCustomFrom，不能直接存 sys", () => {
    /**
     * ⚠ 根因就在这一行。直接 saveCustomDesignSystem(sys) 会沿用预设 id，
     * 清单里出现两条同名同 id、还都打勾。绕过它必红。
     */
    // ⚠ 不能用 `new URL(..., import.meta.url)`：这份用例跑在 jsdom 环境
    //   （要 localStorage），import.meta.url 是 http scheme，readFileSync 会报
    //   "The URL must be of scheme file"。改从仓根算（vitest 的 cwd 是仓根）。
    const panel = readFileSync(
      resolve(
        process.cwd(),
        "client/src/pages/sliderule/DesignSystemPanel.tsx"
      ),
      "utf8"
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(panel).toContain("deriveCustomFrom(sys)");
    expect(panel).not.toMatch(/saveCustomDesignSystem\(sys\)/);
  });

  it("⚠ 撞预设 id 的脏数据要被滤掉，不能只靠 allDesignSystems 去重", () => {
    /**
     * 2026-08-25 真机：旧 bug 存下的那条 id=miantuan 的自建数据，去重之后清单里
     * 只剩一条没错，但 isCustomDesignSystem("miantuan") 仍返回 true，
     * 于是「面团·品牌」被归到「我的设计体系」组里 —— 用户截图就是这么显示的。
     * 所以读的时候就要滤掉。
     */
    const preset = DESIGN_SYSTEMS[0];
    localStorage.setItem(
      "sliderule:design-systems-custom",
      JSON.stringify([{ ...preset, label: "脏数据" }])
    );
    expect(loadCustomDesignSystems()).toHaveLength(0);
    expect(isCustomDesignSystem(preset.id)).toBe(false);
    // 清单里那条仍是预设本身（不是脏数据的 label）
    expect(allDesignSystems().find(s => s.id === preset.id)?.label).toBe(
      preset.label
    );
  });

  it("预设本身永远不进自建表", () => {
    const preset = DESIGN_SYSTEMS[1];
    saveCustomDesignSystem(preset);
    expect(loadCustomDesignSystems().some(s => s.id === preset.id)).toBe(false);
  });
});
