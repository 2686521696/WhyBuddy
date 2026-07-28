import { describe, expect, it } from "vitest";
import catalogJson from "@experience-blocks";
import themePresets from "@identity-themes";
import legalDomains from "@legal";
import {
  EXPERIENCE_BLOCK_CATALOG,
  EXPERIENCE_BLOCK_RENDERERS,
  ExistingContentAdapter,
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

// ── 区块渲染器状态与目录对账（2026-07-27）─────────────────────
// 历史事故：QuickActionPanel/FilterBar（07-22）、WorkflowTimeline/FreeformInsight
// （07-23）陆续接了真实渲染器，但生成侧 prompt 里那句"渲染器还没上线，不要输出
// page.blocks"没人回头取下来——能用的区块一次都没被渲染过。现在放开名单由目录的
// generationEnabled 决定，而它以 rendererStatus 为前提，所以 rendererStatus 必须
// 与这张渲染表逐条对得上，否则"放开了却渲染成惰性占位卡"会重演。
describe("体验区块渲染器状态 SSOT", () => {
  it("目录 rendererStatus 与渲染表逐条一致", () => {
    for (const entry of EXPERIENCE_BLOCK_CATALOG.blocks) {
      const renderer = EXPERIENCE_BLOCK_RENDERERS[entry.rendererKey];
      expect(renderer, `${entry.type} 未登记渲染器`).toBeDefined();
      const actual = renderer === ExistingContentAdapter ? "placeholder" : "real";
      expect(
        entry.rendererStatus,
        `${entry.type}: 目录写 ${entry.rendererStatus}，渲染表实际是 ${actual}`
      ).toBe(actual);
    }
  });

  it("放开生成的区块必须有真渲染器", () => {
    for (const entry of EXPERIENCE_BLOCK_CATALOG.blocks) {
      if (!entry.generationEnabled) continue;
      expect(
        entry.rendererStatus,
        `${entry.type} 放开了生成，但渲染器是占位——用户会看到死卡片`
      ).toBe("real");
    }
  });

  it("放开名单是显式的（灰度哨兵，扩量时同步改这里）", () => {
    // 2026-07-28 扩量：五个数据区块补上真渲染器后，连同两个早就就绪的辅助
    // 区块一起放开。这条哨兵的价值就是逼这次改动变成一次显式决定——改目录
    // 时它会红，必须回来把新名字写进这里，不会有人"顺手"多开一个。
    const enabled = EXPERIENCE_BLOCK_CATALOG.blocks
      .filter(b => b.generationEnabled)
      .map(b => b.type);
    expect(enabled).toEqual([
      "MetricGrid",
      "TrendChart",
      "RankedList",
      "ActivityFeed",
      "DataTable",
      "QuickActionPanel",
      "FilterBar",
      "WorkflowTimeline",
    ]);
  });

  it("FreeformInsight 仍不放开 —— 它不是 LLM 往 page.blocks 里写的东西", () => {
    // 总览版式由 enrich_monitor_page_overviews 读 page.stats/charts 之后合成，
    // 属于过门之后的增强步骤。放开它等于允许 LLM 绕过那条流程直接塞版式，
    // 方案 C 的归属划分会立刻失效（总览页会同时有两份设计）。
    const ff = EXPERIENCE_BLOCK_CATALOG.blocks.find(
      b => b.type === "FreeformInsight"
    );
    expect(ff?.generationEnabled).toBe(false);
  });
});
