import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const pageSource = readFileSync(
  new URL("../ComponentsLibraryPage.tsx", import.meta.url),
  "utf8"
);
const catalog = JSON.parse(
  readFileSync(
    new URL(
      "../../../../../slide-rule-python/services/data/experience_block_catalog.json",
      import.meta.url
    ),
    "utf8"
  )
) as {
  blockFamilies: string[];
  blocks: Array<{
    type: string;
    family: string;
    bindingSchema: { required?: string[]; optional?: string[] };
  }>;
};

/**
 * 2026-08-08 ①a + ①b：区块分族 + 筛选的显式连线。
 *
 * 照 nocobase 的 x-filter-targets（SchemaSettingsConnectDataBlocks.tsx）：筛选
 * 区块不是套在数据区块里面，而是作为兄弟节点用 id 连过去。位置（区域）和关系
 * （targets）是两根独立的轴。
 *
 * 这一组钉的是**那个真 bug 不再可能**：上一版筛选态是页面级一坨，
 * `visibleRows` 对页面上所有实体套同一份 enumFilters、只按字段名匹配——一页
 * 两张表只要都有 status 字段，筛一个就把两个都筛了。
 */
describe("区块分族与筛选连线", () => {
  it("四个族的取值域封闭，18 个区块都有 family", () => {
    expect(new Set(catalog.blockFamilies)).toEqual(
      new Set(["data", "filter", "action", "content"])
    );
    for (const b of catalog.blocks) {
      expect(catalog.blockFamilies).toContain(b.family);
    }
  });

  it("该有 targets 的都有 —— 不说作用于谁的就是装饰", () => {
    for (const b of catalog.blocks) {
      const bindsEntity = (b.bindingSchema.required ?? []).includes("entityRef");
      if (b.family === "action" && !bindsEntity) continue;  // 页面级动作
      if (b.family !== "filter" && b.family !== "action") continue;
      const declared = new Set([
        ...(b.bindingSchema.required ?? []),
        ...(b.bindingSchema.optional ?? []),
      ]);
      expect(declared.has("targets"), `${b.type} 是 ${b.family} 族却没声明 targets`).toBe(
        true
      );
    }
  });

  it("谁必须有 targets：filter 一律要，action 绑实体才要", () => {
    // 这条判据 2026-08-08 改过两次，教训记在这里：
    //
    //   第一版「filter/action 一律必须」→ 把 PageHeader / QuickActionPanel 也
    //     拖下水，而那两个是**完全不绑 binding** 的区块（契约明写"不使用
    //     binding"，还有门禁挡"塞了 binding"），note 变成自相矛盾。
    //   第二版「绑了实体的才必须」→ 又漏了 FilterBar：它的 entityRef 是**可选**
    //     的（不按实体筛也成立），判据把它放过去了。而筛选恰恰最需要 targets。
    //
    // 定稿按族分开说，因为两族语义本来就不同。
    const of = (t: string) => {
      const b = catalog.blocks.find(x => x.type === t)!;
      return {
        family: b.family,
        req: new Set(b.bindingSchema.required ?? []),
        opt: new Set(b.bindingSchema.optional ?? []),
      };
    };
    // filter：一律要。筛选的定义就是"筛某个东西"
    for (const t of ["FilterBar", "StatusTabs"]) {
      const { family, req, opt } = of(t);
      expect(family).toBe("filter");
      expect(req.has("targets") || opt.has("targets"), `${t} 是筛选却没有 targets`).toBe(
        true
      );
    }
    // action + 绑实体：要
    {
      const { family, req } = of("BatchActionBar");
      expect(family).toBe("action");
      expect(req.has("entityRef")).toBe(true);
      expect(req.has("targets")).toBe(true);
    }
    // action + 不绑实体：保持完全不绑
    for (const t of ["PageHeader", "QuickActionPanel"]) {
      const { family, req, opt } = of(t);
      expect(family).toBe("action");
      expect(req.has("entityRef"), `${t} 是页面级动作，不该绑实体`).toBe(false);
      expect(req.has("targets") || opt.has("targets"), `${t} 该保持完全不绑`).toBe(false);
    }
  });

  it("预览不再有页面级的一坨筛选态 —— 那正是 bug 的形状", () => {
    // 旧形状：把**页面级**的 filterState 直接摊开套到所有实体上。
    // 判据不是"有没有遍历实体"——新写法照样要遍历，区别在于套的是谁的筛选。
    expect(
      pageSource,
      "又把页面级 filterState 直接摊开了 —— 那就回到一页两张表互相干扰"
    ).not.toContain("Object.entries(filterState.enumFilters)");
    // 新形状：按"谁筛我"取，且筛选态按区块 id 分片
    expect(pageSource).toContain("const rowsForBlock");
    expect(pageSource).toContain("binding?.targets as string[] | undefined)?.includes(blockId)");
    expect(pageSource).toContain(
      "React.useState<Record<string, PageFilterState>>({})"
    );
  });

  it("区块 id 用装配结果给的，不是每次渲染重新编 —— 编的话连线会断", () => {
    expect(pageSource).toContain("const blockId = b.id ?? `${b.type}-${i}`");
    expect(pageSource).toContain("entityRows={rowsForBlock(blockId)}");
    expect(pageSource).toContain("filterState={filterState[blockId] ?? EMPTY_FILTER}");
  });
});
