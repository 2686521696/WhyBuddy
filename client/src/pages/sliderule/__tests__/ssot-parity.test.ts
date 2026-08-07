import { describe, expect, it } from "vitest";
import catalogJson from "@experience-blocks";
import legalDomains from "@legal";
import themePresets from "@identity-themes";
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

  it("全站一个颜色：任何 generatedTheme 都不再影响配色", () => {
    // 2026-08-03 用户裁决。这条锁的是"不会有半套新半套旧"——库里的存量应用
    // 各自带着 generatedTheme，如果它们还能影响配色，同一个应用中心里就会
    // 既有品牌色的新应用、又有五颜六色的老应用，而外壳（白菜单/白 Header）
    // 是统一的，混在一起比全都不统一更难看。
    const brand = resolveIdentityTheme();
    for (const input of [
      { label: "只有标签没有种子色" },
      { label: "测试主题", seed: "#123456" },
      // 2026-07-30 之前的 11 字段旧格式
      {
        primary: "#e05d38", primaryHover: "#c2410c", gradTo: "#fdba74",
        primaryFg: "#ffffff", contentBg: "#f8fafc", accentBg: "#fff0eb",
        accentFg: "#b23c17", sidebarText: "#e8d9d1", sidebarBg: "#271a15",
        charts: ["#e05d38", "#f59e0b", "#3b82f6"],
      },
      undefined,
    ]) {
      expect(resolveIdentityTheme("tangerine", input)).toEqual(brand);
    }
  });

  it("品牌色来自前后端同读的那份账本，不在前端写死", () => {
    // 写死的话改一次颜色要记得改两个地方；漏掉一边的症状是"生成提示词里
    // 说的颜色和实际渲染的颜色不一样"，只有肉眼比对才看得出来。
    expect(resolveIdentityTheme().primary.toLowerCase()).toBe(
      (themePresets as { brandSeed: { seed: string } }).brandSeed.seed.toLowerCase()
    );
  });

  it("菜单与 Header 是白的", () => {
    const t = resolveIdentityTheme();
    expect(t.sidebarBg.toLowerCase()).toBe("#ffffff");
    // 白底上必须是深字，否则菜单直接隐形
    expect(t.sidebarText.toLowerCase()).not.toBe("#ffffff");
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
    //
    // 2026-08-07 再扩量：表单/详情族四个。用户裁决"先补积木，门槛只收
    // Ant Design 官方能力"——这四个的渲染器全部来自已装的
    // @ant-design/pro-components 2.8，零新依赖：
    //
    //   RecordForm        ProForm                  内联表单
    //   RecordFormDialog  DrawerForm / ModalForm   按钮开抽屉或弹窗（mode 决定）
    //   RecordDetail      ProDescriptions          只读字段明细
    //   StepsForm         StepsForm                分步表单，步骤名跟工作流链路走
    //
    // 抽屉与弹窗做成一个积木而不是两个：它们只差呈现方式，共用同一份字段与
    // 提交回调；拆成两条会让目录里出现一对只差一个词的孪生项，AI 选型时多
    // 一次没有意义的分叉。
    //
    // 2026-08-08 再加一个 ContentCard —— 它跟其余全部不同：**不取数、不发
    // 事件，只装别的积木**。加它是因为用户裁决了"组装的时候要纯粹，该是啥
    // 组件就是啥组件"：此前组装页给每个积木一律套一层 antd Card，等于替模型
    // 决定"所有东西都装进卡片"。现在默认什么都不套，需要把几个积木圈在一起
    // 时模型自己放一个 ContentCard，把它们写进 children。
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
      "RecordForm",
      "RecordFormDialog",
      "RecordDetail",
      "StepsForm",
      "ContentCard",
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
