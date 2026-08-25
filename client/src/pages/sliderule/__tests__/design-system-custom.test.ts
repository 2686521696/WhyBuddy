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
  loadCustomDesignSystems,
  saveCustomDesignSystem,
} from "../design-system";

beforeEach(() => localStorage.clear());

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

  it("清单里同一个 id 只出现一次（自建赢）", () => {
    const preset = DESIGN_SYSTEMS[0];
    // 直接塞一条撞 id 的脏数据（模拟老版本存下来的）
    localStorage.setItem(
      "sliderule:design-systems-custom",
      JSON.stringify([{ ...preset, label: "我改过的" }])
    );
    const list = allDesignSystems();
    const ids = list.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    // 自建那份赢
    expect(list.find(s => s.id === preset.id)?.label).toBe("我改过的");
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

  it("预设本身永远不进自建表", () => {
    const preset = DESIGN_SYSTEMS[1];
    saveCustomDesignSystem(preset);
    expect(loadCustomDesignSystems().some(s => s.id === preset.id)).toBe(false);
  });
});
