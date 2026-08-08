/**
 * 意图搜索的**质量用例**（2026-08-08）。
 *
 * 用户给了四句话当验收标准：
 *
 *     「我要选择客户」「做一个订单筛选」「显示销售趋势」「上传并预览合同」
 *
 * 这几条钉的不是"函数跑不跑得通"，是**搜出来的东西对不对**。搜索这种东西，
 * 跑通和好用之间差着十万八千里——所以每条都写清楚"期望里面有谁"。
 *
 * 语料里有一条硬约束值得记住：基础组件目录明令**不许出现业务词**（「订单」
 * 「门店」出现就是滑回业务积木那一层了）。所以「客户」「合同」「销售」在
 * 语料里一次都不出现，纯全文检索永远搜不到——能搜到全靠意图词表。
 */
import { describe, expect, it } from "vitest";

import { buildIndex, expandIntent, tokenize } from "../component-search";

const index = buildIndex(
  () => undefined,
  () => []
);

/** 前 N 名里有没有它。搜索只看第一名太苛刻，也不符合真实用法。 */
const topNames = (q: string, n = 12) =>
  index.search(q).slice(0, n).map(d => d.name);

describe("分词", () => {
  it("中文出单字 + 相邻二字 —— 打半个词也要能搜到", () => {
    const t = tokenize("订单筛选");
    expect(t).toContain("订单");
    expect(t).toContain("单筛"); // 真分词器会把这里切断，bigram 不会
    expect(t).toContain("筛");
  });

  it("驼峰拆得开 —— 打 form 要能命中 ProFormSelect", () => {
    expect(tokenize("ProFormSelect")).toEqual(
      expect.arrayContaining(["proformselect", "pro", "form", "select"])
    );
  });
});

describe("意图词表", () => {
  it("业务话展开成能力词，原话保留", () => {
    const out = expandIntent("我要选择客户");
    expect(out).toContain("我要选择客户");
    expect(out).toContain("关联"); // 客户 → 关联/选择/记录
    expect(out).toContain("下拉"); // 选择 → 下拉/单选/多选
  });

  it("没命中词表就原样返回 —— 不给它硬塞词", () => {
    expect(expandIntent("zzz")).toBe("zzz");
  });
});

describe("用户给的四句验收", () => {
  // 前三名就要给对东西。放到前十二名太松——搜索这种东西，"在列表里"和"看得见"
  // 是两回事。
  const top3 = (q: string) => topNames(q, 3);

  it("「我要选择客户」→ 选择类控件排前三", () => {
    const got = top3("我要选择客户");
    expect(
      got.every(n => /Select|Cascader|TreeSelect|Picker|Selector/.test(n)),
      `搜出来的是：${got.join(", ")}`
    ).toBe(true);
  });

  it("「做一个订单筛选」→ 四个筛选区块排前四", () => {
    const got = topNames("做一个订单筛选", 4);
    expect(
      got.every(n => /StatusTabs|SearchBox|TagFilterRow|FilterBar/.test(n)),
      `搜出来的是：${got.join(", ")}`
    ).toBe(true);
  });

  it("「显示销售趋势」→ 指标/趋势/占比三个区块排前三", () => {
    const got = top3("显示销售趋势");
    expect(
      got.every(n => /MetricGrid|TrendChart|ProportionPie/.test(n)),
      `搜出来的是：${got.join(", ")}`
    ).toBe(true);
  });

  it("「上传并预览合同」→ 上传控件在前", () => {
    const got = topNames("上传并预览合同", 5);
    expect(
      got.some(n => /Upload/.test(n)),
      `搜出来的是：${got.join(", ")}`
    ).toBe(true);
  });

  it("「审批记录」→ 流程条第一，动态流也召得回来", () => {
    // ActivityFeed 一度被截断削没了（头名 WorkflowTimeline 太突出，25% 那条
    // 线把它划下去）。修法是每档留够最少个数，见 MIN_HITS_PER_KIND ——
    // 截断要防的是"一句话跟整份目录都沾边"，不是把 23 个区块削成 1 个。
    const blocks = index.search("审批记录").filter(d => d.kind === "block").map(d => d.name);
    expect(blocks[0], `区块顺序：${blocks.join(", ")}`).toBe("WorkflowTimeline");
    expect(blocks, "动态流被截没了").toContain("ActivityFeed");
  });

  it("只有一个正解的查询不会拖出一长串 —— 截断得真的在截", () => {
    const blocks = index.search("批量导出").filter(d => d.kind === "block").map(d => d.name);
    expect(blocks[0]).toBe("BatchActionBar");
    expect(blocks.length, `拖出了 ${blocks.join(", ")}`).toBeLessThanOrEqual(4);
  });
});

/**
 * 能力面的中文词是**内容**，不是排序参数。
 *
 * 区块目录里 capability / dataKinds 全是英文（filter、aggregate、entityRows），
 * 基础组件那边的分组却是中文。不补这一层，中文查询在区块档只能命中说明正文，
 * 标签字段（权重是说明的两倍）等于空转——实测「订单筛选」搜不到 FilterBar，
 * 而它的能力面正是 filter。
 */
describe("区块的能力面要有中文词", () => {
  it("每个真实用到的能力面都译了 —— 漏一个，那一类区块中文搜不到", () => {
    const caps = new Set(
      index.docs
        .filter(d => d.kind === "block")
        .flatMap(d => d.tags.split(" "))
        .filter(t => /^[a-zA-Z]+$/.test(t))
    );
    // 目录里真实出现的能力面（从 tags 里的英文词取），每个都得有中文伴随
    const untranslated = [...caps].filter(cap => {
      const docs = index.docs.filter(d => d.kind === "block" && d.tags.includes(cap));
      return docs.every(d => !/[一-龥]/.test(d.tags));
    });
    expect(untranslated, `这些能力面没有中文词：${untranslated.join(", ")}`).toEqual([]);
  });
});

describe("普通搜索没被意图层搞坏", () => {
  it("打组件名照样第一名", () => {
    expect(index.search("ProFormRate")[0]?.name).toBe("ProFormRate");
    expect(index.search("DataTable")[0]?.name).toBe("DataTable");
  });

  it("罕见词不被高频词淹掉 —— 这是用 BM25 而不是 includes 计数的理由", () => {
    // 「签名」全语料只有一条，「选择」有几十条。朴素计数会让含「选择」的
    // 一堆条目挤在前面。
    expect(index.search("签名")[0]?.name).toBe("SignaturePad");
  });

  it("空串不返回全部 —— 那会让搜索框一打开就铺满", () => {
    expect(index.search("")).toEqual([]);
    expect(index.search("   ")).toEqual([]);
  });

  it("区块和基础组件一起给 —— 用户要的是「能直接装进应用的东西」", () => {
    const kinds = new Set(index.search("批量").slice(0, 15).map(d => d.kind));
    expect(kinds.has("block") || kinds.has("base")).toBe(true);
    expect(index.docs.filter(d => d.kind === "block").length).toBeGreaterThan(20);
    expect(index.docs.filter(d => d.kind === "base").length).toBeGreaterThan(200);
  });
});
