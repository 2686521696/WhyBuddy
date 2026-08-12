import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { semanticOf } from "../demo-seed-semantics";

/**
 * 首页 KPI 的两处毛病 + 散文词表漏词（2026-08-12）。
 *
 * 出处是一次**真实链路跑**：话题「连锁健身房私教排课与会员续卡系统」，
 * 走完 generate → gate → theme → freeform → monitor overview 全程 13 分钟，
 * 然后把产物在真实运行时渲染出来看。三条毛病全是那张截图上一眼可见的。
 *
 * ## ① 百分比丢了单位
 *
 *     数据模型：store_metric.consumption_rate  format="percent"
 *               store_metric.renewal_rate      format="percent"
 *     渲染出来：49.3        46.2
 *
 * 声明是确定的事实，渲染这一步却没人读它——`computeDataRefText` 从上线起
 * 就没接过字段 schema。这跟 2026-08-11 修表格那次是同一个洞的另一半（那次
 * 是 `fieldSemantic` 读不到 schema、只能按名字猜）。
 *
 * ## ② 数字和它的标签落到了不同的行
 *
 * 设计把「续卡率」写成一行 `[图标, 标签, 数字]`（父容器 display:flex），
 * 而运行时在数字节点**里面**又塞了两层：环比小字 + 32px 迷你走势线。
 * 那个 `<strong>` 从一行变三行高，旁边的图标和标签被垂直居中到这坨的中间，
 * 读起来就是「46.2 在上、续卡率 在下」——数字看着像属于上一张卡。
 *
 * ## ③ 「提醒内容 1」
 *
 * `renewal_reminder.message「提醒内容」` 没被认成散文，掉进
 * `${label} ${index+1}` 兜底。跟上一次的「经营表现摘要 1」同一类伤害，
 * 只是换了个词——第一版词表列的是**那次见到的词**，不是这类字段的说法全集。
 */

const SRC = new URL("..", import.meta.url).pathname;
const registry = readFileSync(`${SRC}block-registry.tsx`, "utf8");

describe("① KPI 百分比要带单位", () => {
  it("computeDataRefText 接得到字段声明", () => {
    const i = registry.indexOf("function computeDataRefText(");
    expect(i, "函数没了 —— 断言锚点要重找").toBeGreaterThan(-1);
    const body = registry.slice(i, i + 2600);
    expect(body, "还是只算数不看声明，percent 会继续丢").toContain("fieldSchemaOf");
    expect(body, "没走补单位那一步").toContain("withDeclaredUnit");
  });

  it("**它真的被接上了** —— 上一条只证明函数长了个参数", () => {
    expect(
      registry,
      "调用点没传 fieldSchemaOf —— 参数加了也是摆设"
    ).toContain("computeDataRefText(n.dataRef, entityRows, ctx.blockProps.fieldSchemaOf)");
  });

  it("单位判据跟表格共用一把尺，不另写一套「什么算百分比」", () => {
    const i = registry.indexOf("function withDeclaredUnit(");
    const body = registry.slice(i, i + 900);
    expect(body, "没用共用的档位表 resolveValueType").toContain("resolveValueType");
    // 三档的写法必须跟 renderCell 逐字一致，否则同一个字段在 KPI 和表格里
    // 读起来是两个东西
    expect(body).toContain("%");
    expect(body).toContain("¥");
    expect(body).toContain("分");
  });

  it("count 不补单位 —— 它数的是「多少条」，跟被聚合字段无关", () => {
    const i = registry.indexOf("function computeDataRefText(");
    const body = registry.slice(i, i + 2600);
    const countAt = body.indexOf('aggregate === "count"');
    const unitAt = body.indexOf("withDeclaredUnit");
    expect(countAt, "count 分支没了").toBeGreaterThan(-1);
    expect(countAt, "count 走到了补单位那一步").toBeLessThan(unitAt);
  });
});

describe("② 横排时环比收成一行", () => {
  it("renderDataRefTrend 认得「我在一行里」", () => {
    const i = registry.indexOf("function renderDataRefTrend(");
    const body = registry.slice(i, i + 3000);
    expect(body, "不知道自己在不在横排里，版式会继续串").toContain("inline");
    expect(
      body,
      "横排还画 32px 走势线 —— 一行文字里塞不下，正是把一行撑成三行的那一步"
    ).toContain("inline\n    ? null");
  });

  it("横排判据认 flexDirection 默认值 —— 不写就是 row", () => {
    const i = registry.indexOf("function isRowFlex(");
    expect(i, "判据函数没了").toBeGreaterThan(-1);
    const body = registry.slice(i, i + 500);
    expect(body, "没兜住「没写 flexDirection」这个默认情况").toContain('?? "row"');
    expect(body, "把竖排也当成横排了").toContain("row-reverse");
  });

  it("**它真的被接上了** —— 父节点得把这件事传下去", () => {
    expect(
      registry,
      "没往下传 inRow —— 子节点永远以为自己是竖排"
    ).toContain("inRow: isRowFlex(n.style)");
    expect(
      registry,
      "调用点没用 ctx.inRow"
    ).toContain("renderDataRefTrend(n.dataRef, entityRows, chartPalette, ctx.inRow)");
  });
});

describe("③ 散文词表补「内容」一族", () => {
  it("真跑漏掉的那个词现在认得出来", () => {
    expect(semanticOf("message", "提醒内容"), "「提醒内容」还会渲染成「提醒内容 1」").toBe("prose");
  });

  it("同一族的其它说法一并收", () => {
    for (const label of ["公告内容", "回复文案", "工单正文", "处理详情"]) {
      expect(semanticOf(undefined, label), `${label} 没被认成散文`).toBe("prose");
    }
    expect(semanticOf("content", undefined)).toBe("prose");
  });

  it("仍然垫在最后 —— 更具体的规则先拿走它该拿的", () => {
    // 「内容编号」里的「内容」不许抢在「编号」前面
    expect(semanticOf("content_code", "内容编号")).toBe("code");
    expect(semanticOf("manual_code", "说明书编号")).toBe("code");
    expect(semanticOf("owner_note", "负责人说明")).toBe("person");
  });

  it("认不出的仍然认不出 —— 加词不等于放松「宁可少认不可认错」", () => {
    expect(semanticOf("flavor", "风味")).toBeNull();
    expect(semanticOf("", "")).toBeNull();
  });
});
