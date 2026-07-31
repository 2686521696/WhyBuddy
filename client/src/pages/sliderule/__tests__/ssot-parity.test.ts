import { describe, expect, it } from "vitest";
import catalogJson from "@experience-blocks";
import legalDomains from "@legal";
import { FALLBACK_SEED } from "@/lib/identity-palette";
import {
  EXPERIENCE_BLOCK_CATALOG,
  EXPERIENCE_BLOCK_RENDERERS,
  ExistingContentAdapter,
  FREEFORM_ICON_NAME_RE,
} from "../live-runtime/block-registry";
import { LAYOUT_SLOT_KEYS } from "../live-runtime/app-runtime-schema";
import { LEGAL_THEME_IDS, resolveIdentityTheme } from "../live-runtime/identity-themes";

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

  // 2026-07-30 起不再有"8 套主题从 presets JSON 构建"这件事——presets JSON
  // 不再有 themes 键（手工色值收到 1 个 FALLBACK_SEED），这条哨兵锁的结构
  // 已经不存在了。identityThemes 的 8 个合法 id 仍在账本里、仍被 gate/repair
  // 校验（那两处没有改），下面这条只锁"导出的合法 id 清单跟账本一致"，
  // 不再要求它们各自对应一套色板。
  it("LEGAL_THEME_IDS 与合法域账本一致", () => {
    expect(LEGAL_THEME_IDS).toEqual(
      (legalDomains as { identityThemes: string[] }).identityThemes
    );
  });

  it("生成主题契约生效：缺 seed 的主题被弃用回落 FALLBACK_SEED（与 Python 同判定）", () => {
    const invalid: Record<string, unknown> = { label: "只有标签没有种子色" };
    const resolved = resolveIdentityTheme("azure", invalid);
    expect(resolved.id).toBe("fallback");
    expect(resolved.primary).toBe(FALLBACK_SEED);
  });

  it("生成主题契约生效：合法种子色被采用", () => {
    const valid: Record<string, unknown> = { label: "测试主题", seed: "#123456" };
    const resolved = resolveIdentityTheme("azure", valid);
    expect(resolved.id).toBe("generated");
    expect(resolved.primary).toBe("#123456");
  });

  it("旧格式（11 字段）生成主题仍可用：primary 当种子色读", () => {
    // 2026-07-30 之前生成的存量会话没有 seed 字段，只有 primary——见
    // identity-themes.ts 的 extractSeed 注释：这不是兼容层，primary 本来
    // 就是"原样保留的种子色"，拿它当新种子色语义上是同一件事。
    const legacy: Record<string, unknown> = {
      primary: "#e05d38", primaryHover: "#c2410c", gradTo: "#fdba74",
      primaryFg: "#ffffff", contentBg: "#f8fafc", accentBg: "#fff0eb",
      accentFg: "#b23c17", sidebarText: "#e8d9d1", sidebarBg: "#271a15",
      charts: ["#e05d38", "#f59e0b", "#3b82f6"],
    };
    const resolved = resolveIdentityTheme("tangerine", legacy);
    expect(resolved.id).toBe("generated");
    expect(resolved.primary).toBe("#e05d38");
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
