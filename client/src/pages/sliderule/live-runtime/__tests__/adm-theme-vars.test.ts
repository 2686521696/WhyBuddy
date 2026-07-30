/**
 * 生成主题必须喂到 antd-mobile —— 两边换肤机制不是一套（antd v5 走
 * cssinjs token，antd-mobile 走 --adm-* CSS 变量），ConfigProvider 配好
 * 主色手机档一个字都吃不到。真机实测过：主题 #C2410C，adm 按钮背景仍是
 * rgb(22,119,255)，也就是 antd-mobile 自带的默认蓝。
 */
import { describe, it, expect } from "vitest";
import { admThemeVars, resolveIdentityTheme } from "../identity-themes";
import { fallbackIdentityPalette } from "@/lib/identity-palette";

describe("admThemeVars", () => {
  it("主色/前景/强调底都取自主题，不留 antd-mobile 默认值", () => {
    const theme = resolveIdentityTheme("tangerine");
    const vars = admThemeVars(theme);
    expect(vars["--adm-color-primary"]).toBe(theme.primary);
    expect(vars["--adm-color-text-light-solid"]).toBe(theme.primaryFg);
    expect(vars["--adm-color-wathet"]).toBe(theme.accentBg);
    // 回归：antd-mobile 的默认蓝/默认浅蓝底不许出现在产物里
    expect(Object.values(vars)).not.toContain("#1677ff");
    expect(Object.values(vars)).not.toContain("#e7f1ff");
  });

  it("任意种子色派生出的主题都能产出合法色值（没有 undefined 漏进 style）", () => {
    // 2026-07-30 起没有"8 套预设"了，覆盖面换成：兜底色板 + 几个有代表性
    // 的种子色（跟 identity-palette.test.ts 的 OLD_SEEDS 同源，都是原来
    // 8 套预设的主色，用来确认派生管线接住这些真实色相时不产出坏值）。
    const themes = [
      fallbackIdentityPalette(),
      resolveIdentityTheme(undefined, { seed: "#1677ff", label: "湛蓝" }),
      resolveIdentityTheme(undefined, { seed: "#e05d38", label: "橘橙" }),
      resolveIdentityTheme(undefined, { seed: "#525252", label: "石墨" }),
    ];
    for (const theme of themes) {
      for (const [name, value] of Object.entries(admThemeVars(theme))) {
        expect(value, `${theme.id} 的 ${name}`).toMatch(
          /^(#[0-9a-fA-F]{3,8}|rgba?\(.+\))$/
        );
      }
    }
  });

  it("只碰品牌色，中性色留给 antd-mobile 自己（那套按移动端可读性调过）", () => {
    const keys = Object.keys(admThemeVars(resolveIdentityTheme("tangerine")));
    expect(keys).not.toContain("--adm-color-text");
    expect(keys).not.toContain("--adm-color-border");
    expect(keys).not.toContain("--adm-color-background");
  });
});
