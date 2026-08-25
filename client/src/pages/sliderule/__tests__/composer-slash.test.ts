/**
 * `/` 选择器的判定层。
 *
 * 每条"该弹"都配了一条"不该弹"——错弹比不弹烦人得多，它会吃掉方向键和回车。
 */
import { describe, expect, it } from "vitest";

import {
  applySlashPick,
  filterSlashItems,
  moveHighlight,
  pickedPayload,
  slashQueryAt,
  type SlashItem,
} from "../composer-slash";

const ITEMS: SlashItem[] = [
  { key: "weather", kind: "connector", name: "天气", description: "按城市取真实天气预报" },
  { key: "stock", kind: "connector", name: "股票行情", description: "A 股与指数实时行情" },
  {
    key: "wind",
    kind: "connector",
    name: "Wind 金融数据",
    description: "机构级行情",
    unavailable: "还没配置凭据",
  },
  { key: "frontend-design", kind: "skill", name: "frontend-design", description: "前端界面风格" },
];

describe("什么时候弹", () => {
  it("行首打斜杠就弹", () => {
    expect(slashQueryAt("/", 1)).toEqual({ start: 0, end: 1, query: "" });
    expect(slashQueryAt("/天气", 3)).toEqual({ start: 0, end: 3, query: "天气" });
  });

  it("空格后面打斜杠也弹", () => {
    const q = slashQueryAt("帮我做个看板 /股票", 9);
    expect(q).toEqual({ start: 7, end: 9, query: "股" });
  });

  it("换行后面也算行首", () => {
    expect(slashQueryAt("第一行\n/天", 6)?.query).toBe("天");
  });
});

describe("什么时候不许弹（这半边才是判据的价值）", () => {
  it("网址里的斜杠不弹", () => {
    expect(slashQueryAt("https://miantuan.ai", 9)).toBeNull();
    expect(slashQueryAt("https://miantuan.ai", 19)).toBeNull();
  });

  it("日期里的斜杠不弹", () => {
    expect(slashQueryAt("2026/08/25", 7)).toBeNull();
  });

  it("词中间的斜杠不弹", () => {
    expect(slashQueryAt("and/or", 6)).toBeNull();
  });

  it("查询串里一出现空格就关掉——用户已经在写正文了", () => {
    expect(slashQueryAt("/天气 帮我做个看板", 4)).toBeNull();
    expect(slashQueryAt("/天气 帮我做个看板", 10)).toBeNull();
  });

  it("光标在斜杠段之外时不弹", () => {
    // 正文写完又把光标挪回前面
    expect(slashQueryAt("/天气", 0)).toBeNull();
    expect(slashQueryAt("没有斜杠", 4)).toBeNull();
  });
});

describe("筛选", () => {
  it("空查询给全部", () => {
    expect(filterSlashItems(ITEMS, "")).toHaveLength(ITEMS.length);
    expect(filterSlashItems(ITEMS, "   ")).toHaveLength(ITEMS.length);
  });

  it("名字前缀排在包含前面", () => {
    const r = filterSlashItems(ITEMS, "股");
    expect(r[0]!.key).toBe("stock");
  });

  it("描述里命中也算，但排在后面", () => {
    const r = filterSlashItems(ITEMS, "指数");
    expect(r.map(x => x.key)).toEqual(["stock"]);
  });

  it("英文不分大小写", () => {
    expect(filterSlashItems(ITEMS, "FRONTEND").map(x => x.key)).toEqual([
      "frontend-design",
    ]);
  });

  it("不可用的照样列出来——不然用户以为产品没这个能力", () => {
    const r = filterSlashItems(ITEMS, "wind");
    expect(r.map(x => x.key)).toEqual(["wind"]);
    expect(r[0]!.unavailable).toBeTruthy();
  });

  it("同分保持原顺序（不稳定排序会让第一项跳来跳去）", () => {
    const many: SlashItem[] = [
      { key: "a", kind: "skill", name: "同名", description: "" },
      { key: "b", kind: "skill", name: "同名", description: "" },
      { key: "c", kind: "skill", name: "同名", description: "" },
    ];
    expect(filterSlashItems(many, "同名").map(x => x.key)).toEqual(["a", "b", "c"]);
  });

  it("搜不到就是空——不许兜底给全部", () => {
    expect(filterSlashItems(ITEMS, "压根不存在")).toEqual([]);
  });
});

describe("选中之后", () => {
  it("把 /查询串 从正文里摘掉，不是替换成能力名", () => {
    const text = "帮我做个看板 /天气";
    const q = slashQueryAt(text, text.length)!;
    const r = applySlashPick(text, q);
    expect(r.text).toBe("帮我做个看板 ");
    expect(r.caret).toBe(7);
    // 反面：能力名不许留在正文里——留下的话它会跟着进提示词
    expect(r.text).not.toContain("天气");
    expect(r.text).not.toContain("/");
  });

  it("正文后半段保住", () => {
    const text = "/天气 之后还有字";
    // 光标停在 "/天" 之后（此时后面还没打空格的场景由调用方保证）
    const q = { start: 0, end: 3, query: "天气" };
    expect(applySlashPick(text, q).text).toBe(" 之后还有字");
  });
});

describe("键盘", () => {
  it("上下绕圈", () => {
    expect(moveHighlight(3, 0, 1)).toBe(1);
    expect(moveHighlight(3, 2, 1)).toBe(0);
    expect(moveHighlight(3, 0, -1)).toBe(2);
  });

  it("空列表不炸", () => {
    expect(moveHighlight(0, 0, 1)).toBe(0);
    expect(moveHighlight(0, 5, -1)).toBe(0);
  });
});

describe("载荷", () => {
  it("只带 id 和类型，不把描述文案送进推演", () => {
    const payload = pickedPayload([ITEMS[0]!, ITEMS[3]!]);
    expect(payload).toEqual([
      { kind: "connector", key: "weather" },
      { kind: "skill", key: "frontend-design" },
    ]);
    expect(JSON.stringify(payload)).not.toContain("按城市取");
  });
});
