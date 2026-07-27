import { describe, expect, it } from "vitest";
import catalogJson from "@experience-blocks";
import themePresets from "@identity-themes";
import legalDomains from "@legal";
import {
  EXPERIENCE_BLOCK_CATALOG,
  FREEFORM_ICON_NAME_RE,
} from "../live-runtime/block-registry";
import { LAYOUT_SLOT_KEYS } from "../live-runtime/app-runtime-schema";
import {
  DEFAULT_THEME_ID,
  allIdentityThemes,
  resolveIdentityTheme,
} from "../live-runtime/identity-themes";

/** 2026-07-26 手抄清单收编哨兵。
 *
 * 此前四处"两边各一份、靠人肉记得同步"的平行拷贝：图标形状正则、legacy
 * 图标别名表、布局槽位键、8 套主题色板 + 生成主题合格标准。现在真相源收进
 * 共享 JSON（vite alias 跨语言直读），这里锁住"派生没有被人重新硬编码"，
 * 以及唯一一处因类型系统保留的字面量（LAYOUT_SLOT_KEYS）与目录一致。 */
describe("SSOT parity（手抄清单收编）", () => {
  it("图标形状正则从目录派生", () => {
    expect(FREEFORM_ICON_NAME_RE.source).toBe(
      (catalogJson as { freeformIconNamePattern: string }).freeformIconNamePattern
    );
  });

  it("legacy 图标别名表从目录派生且映射值都是合法组件名形状", () => {
    const aliases = EXPERIENCE_BLOCK_CATALOG.freeformLegacyIconAliases;
    expect(Object.keys(aliases).length).toBeGreaterThan(0);
    for (const [alias, componentName] of Object.entries(aliases)) {
      expect(alias).not.toMatch(FREEFORM_ICON_NAME_RE); // kebab 名不是组件名
      expect(componentName).toMatch(FREEFORM_ICON_NAME_RE);
    }
  });

  it("LAYOUT_SLOT_KEYS 与目录 allowedSlots 一致（唯一保留的字面量拷贝）", () => {
    expect([...LAYOUT_SLOT_KEYS]).toEqual(
      (catalogJson as { allowedSlots: string[] }).allowedSlots
    );
  });

  it("8 套主题从 presets JSON 构建，id 清单与合法域账本一致", () => {
    const themes = allIdentityThemes();
    expect(themes.map(t => t.id).sort()).toEqual(
      [...(legalDomains as { identityThemes: string[] }).identityThemes].sort()
    );
    expect(Object.keys(themePresets.themes).sort()).toEqual(
      themes.map(t => t.id).sort()
    );
    expect(DEFAULT_THEME_ID).toBe(themePresets.defaultThemeId);
  });

  it("生成主题契约生效：缺 sidebarBg 的主题被弃用回落预设（与 Python 同判定）", () => {
    const almostValid: Record<string, unknown> = {
      primary: "#123456", primaryHover: "#123456", gradTo: "#123456",
      primaryFg: "#ffffff", contentBg: "#f0f0f0", accentBg: "#eeeeee",
      accentFg: "#333333", sidebarText: "#cccccc",
      charts: ["#111111", "#222222", "#333333"],
      // sidebarBg 缺失
    };
    const resolved = resolveIdentityTheme("forest", almostValid);
    expect(resolved.id).toBe("forest"); // 回落到 themeId 预设，不是 "generated"
  });

  it("生成主题契约生效：完整合法主题被采用", () => {
    const valid: Record<string, unknown> = {
      primary: "#123456", primaryHover: "#123456", gradTo: "#123456",
      primaryFg: "#ffffff", contentBg: "#f0f0f0", accentBg: "#eeeeee",
      accentFg: "#333333", sidebarText: "#cccccc", sidebarBg: "#101820",
      charts: ["#111111", "#222222", "#333333"],
    };
    expect(resolveIdentityTheme("forest", valid).id).toBe("generated");
  });
});
