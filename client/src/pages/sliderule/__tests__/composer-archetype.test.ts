/**
 * 作曲家产品原型下拉：业务 / 内容 / 自由类型。
 *
 * ⚠ 2026-08-31 用户圈了空态 Web/应用/平板 下拉要加「自由类型」。
 * 那是设备轴，自由类型是原型轴，两轴不许混进同一颗钮。
 * 把 自由类型 塞进 composer-device、或把原型下拉从 ComposerDock 拆掉，下面必红。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  composerArchetypeMenu,
  composerArchetypeTriggerLabel,
} from "../composer-archetype";
import { defaultArchetype } from "../product-archetypes";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("composerArchetypeMenu", () => {
  it("接通三档含自由类型，默认仍是业务", () => {
    expect(defaultArchetype()).toBe("business_app");
    expect(composerArchetypeTriggerLabel("business_app")).toBe("业务");
    expect(composerArchetypeTriggerLabel("content_app")).toBe("内容");
    expect(composerArchetypeTriggerLabel("free_app")).toBe("自由类型");

    const menu = composerArchetypeMenu();
    expect(menu.map(row => row.id)).toEqual(
      expect.arrayContaining(["business_app", "content_app", "free_app"])
    );
    expect(menu.map(row => row.id)).not.toContain("casual_game");
    expect(menu.find(row => row.id === "free_app")?.label).toBe("自由类型");
  });

  it("空态原型下拉接在 ComposerDock，不进设备那颗钮", () => {
    const dock = stripComments(
      readFileSync(new URL("../ComposerDock.tsx", import.meta.url), "utf8")
    );
    expect(dock).toContain("composerArchetypeMenu()");
    expect(dock).toContain("setProductArchetype(opt.id)");
    expect(dock).toContain('data-testid="sliderule-composer-archetype-trigger"');
    expect(dock).toContain('data-testid="sliderule-composer-archetype-menu"');
    expect(dock).toContain("sliderule-composer-archetype-${opt.id}");

    const device = stripComments(
      readFileSync(new URL("../composer-device.ts", import.meta.url), "utf8")
    );
    expect(device).not.toContain("free_app");
    expect(device).not.toContain("自由类型");
    expect(device).not.toContain("business_app");
  });
});
