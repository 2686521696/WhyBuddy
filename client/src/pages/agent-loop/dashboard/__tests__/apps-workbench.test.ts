/**
 * E14 我的应用画廊：卡片推导/筛选纯函数。
 * 纪律回归：不发明数据——模型缺失就是 draft，证据数如实。
 */
import { readFileSync } from "node:fs";

import { describe, it, expect } from "vitest";
import {
  deriveAppCardDetail,
  deriveDetailFromAppSummary,
  deriveDetailFromAppRecord,
  mergeGalleryItems,
  filterCards,
  formatUpdatedAt,
  formatRelativeTime,
  type SessionListItem,
} from "../AppsWorkbench";
import type { AppStoreSummary } from "../app-store-client";

const runnableState = {
  publishClosure: {
    evidencePresentCount: 6,
    blocked: false,
    perSkillEvidence: {
      datamodel: {
        modelSection: {
          entities: [
            { name: "患者", fields: [{ name: "姓名" }] },
            { name: "预约单", fields: [] },
          ],
        },
      },
      page: {
        modelSection: {
          pages: [{ id: "p1", name: "工作台" }, { id: "p2", name: "预约日历" }],
        },
      },
      rbac: { modelSection: { roles: ["dentist", "front_desk"] } },
      workflow: {
        modelSection: { nodes: [{ id: "n1" }, { id: "n2" }, { id: "n3" }], transitions: [] },
      },
    },
  },
};

describe("deriveAppCardDetail", () => {
  it("闭环 6/6 + 模型齐 → runnable，计数取真模型", () => {
    const d = deriveAppCardDetail(runnableState);
    expect(d.status).toBe("runnable");
    expect(d.evidenceCount).toBe(6);
    expect(d.entities).toBe(2);
    expect(d.pages).toBe(2);
    expect(d.flowNodes).toBe(3);
    expect(d.roles).toBe(2);
    expect(d.pageNames).toEqual(["工作台", "预约日历"]);
    expect(d.entityNames).toContain("患者");
  });

  it("证据 6/6 但无模型（确定性域）→ 不冒充可运行", () => {
    const d = deriveAppCardDetail({
      publishClosure: { evidencePresentCount: 6, blocked: false },
    });
    expect(d.status).toBe("draft");
    expect(d.entities).toBe(0);
  });

  it("停泊等待（awaitReason）→ awaiting；空状态 → draft 零计数", () => {
    expect(
      deriveAppCardDetail({ awaitReason: "route_selection", publishClosure: {} }).status
    ).toBe("awaiting");
    const empty = deriveAppCardDetail({});
    expect(empty.status).toBe("draft");
    expect(empty.evidenceCount).toBe(0);
  });

  it("blocked 闭环不算可运行", () => {
    const d = deriveAppCardDetail({
      ...runnableState,
      publishClosure: { ...runnableState.publishClosure, blocked: true },
    });
    expect(d.status).not.toBe("runnable");
  });
});

describe("filterCards", () => {
  const item = (id: string, goal: string): SessionListItem => ({ sessionId: id, goal });
  const cards = [
    { item: item("a", "宠物医院预约"), detail: deriveAppCardDetail(runnableState) },
    { item: item("b", "健身房排期"), detail: deriveAppCardDetail({}) },
    { item: item("c", "还没拉到详情"), detail: null },
  ];

  it("all 全放行；runnable/draft 按状态；详情未到不武断归类", () => {
    expect(filterCards(cards, "all", "")).toHaveLength(3);
    expect(filterCards(cards, "runnable", "").map(c => c.item.sessionId)).toEqual(["a"]);
    expect(filterCards(cards, "draft", "").map(c => c.item.sessionId)).toEqual(["b"]);
  });

  it("搜索按话题子串过滤", () => {
    expect(filterCards(cards, "all", "宠物")).toHaveLength(1);
    expect(filterCards(cards, "all", "不存在")).toHaveLength(0);
  });
});

const summary = (over: Partial<AppStoreSummary> = {}): AppStoreSummary => ({
  id: "app1",
  root_id: "app1",
  parent_id: null,
  version: 1,
  session_id: "s1",
  goal: "咖啡店管理",
  gate_passed: true,
  created_at: "2026-07-24T10:00:00Z",
  product_name: "咖营通",
  theme_id: "forest",
  theme_label: "松绿·测试",
  device: "desktop",
  landing_page_ref: "p0",
  entity_count: 3,
  page_count: 4,
  ...over,
});

describe("deriveDetailFromAppSummary", () => {
  it("App Store 摘要 → 即时 runnable 占位，计数取摘要、模型待懒拉", () => {
    const d = deriveDetailFromAppSummary(summary());
    expect(d.status).toBe("runnable"); // App Store 只存闭环应用
    expect(d.entities).toBe(3);
    expect(d.pages).toBe(4);
    expect(d.model).toBeNull(); // 摘要不含模型，进视口再拉
    expect(d.identity?.productName).toBe("咖营通");
    expect(d.identity?.theme).toBe("forest");
  });
});

describe("deriveDetailFromAppRecord", () => {
  it("完整 model_json → 全指标 + 活渲染模型（与会话卡同源口径）", () => {
    const model = {
      datamodel: { entities: [{ name: "订单" }, { name: "商品" }] },
      page: { pages: [{ id: "p0", name: "监控台" }] },
      workflow: { nodes: [{ id: "n1" }] },
      rbac: { roles: ["店长", "店员"] },
      aigc: { capabilities: [{ id: "c1" }] },
      appbundle: { appIdentity: { productName: "咖营通", theme: "forest", icon: "cart" } },
    };
    const d = deriveDetailFromAppRecord(model);
    expect(d.status).toBe("runnable");
    expect(d.entities).toBe(2);
    expect(d.pages).toBe(1);
    expect(d.roles).toBe(2);
    expect(d.aiCaps).toBe(1);
    expect(d.identity?.icon).toBe("cart");
    expect(d.model).not.toBeNull();
  });

  it("坏 model_json（非对象）→ 不崩，退成空指标 draft", () => {
    expect(deriveDetailFromAppRecord(null).model).toBeNull();
    expect(deriveDetailFromAppRecord("nope").entities).toBe(0);
  });
});

describe("mergeGalleryItems", () => {
  const sess = (id: string, goal: string): SessionListItem => ({ sessionId: id, goal });

  it("App Store 应用 + 未落库会话草稿合流，按 session_id 去重", () => {
    const apps = [summary({ id: "app1", session_id: "s1" })];
    const sessions = [sess("s1", "咖啡店（已闭环）"), sess("s2", "健身房（在推演）")];
    const items = mergeGalleryItems(apps, sessions);
    // s1 已被 App Store 卡承载 → 不再出会话草稿卡；只剩 app1 + s2
    expect(items.map(i => i.key).sort()).toEqual(["app:app1", "session:s2"]);
    const appItem = items.find(i => i.source === "app")!;
    expect(appItem.appId).toBe("app1");
    expect(appItem.version).toBe(1);
    const draft = items.find(i => i.source === "session")!;
    expect(draft.sessionId).toBe("s2");
  });

  it("无 App Store（空）→ 全是会话卡，零回退", () => {
    const items = mergeGalleryItems([], [sess("s1", "a"), sess("s2", "b")]);
    expect(items).toHaveLength(2);
    expect(items.every(i => i.source === "session")).toBe(true);
  });
});

describe("filterCards（含 App Store 卡）", () => {
  it("App Store 摘要卡即时算 runnable，进 runnable 筛选", () => {
    const cards = [
      { item: { goal: "咖营通" }, detail: deriveDetailFromAppSummary(summary()) },
      { item: { goal: "草稿" }, detail: deriveAppCardDetail({}) },
    ];
    expect(filterCards(cards, "runnable", "")).toHaveLength(1);
    expect(filterCards(cards, "draft", "")).toHaveLength(1);
  });
});

describe("formatUpdatedAt", () => {
  it("ISO → 本地紧凑格式；坏输入回空串", () => {
    expect(formatUpdatedAt("2026-07-15T06:17:00Z")).toMatch(/^2026-07-15 \d{2}:\d{2}$/);
    expect(formatUpdatedAt("garbage")).toBe("");
    expect(formatUpdatedAt(null)).toBe("");
  });
});

describe("formatRelativeTime", () => {
  const now = new Date("2026-07-26T12:00:00Z").getTime();
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const S = 1000, M = 60 * S, H = 60 * M, D = 24 * H;

  it("按跨度给人话，绝对时间由调用方兜底", () => {
    expect(formatRelativeTime(ago(10 * S), now)).toBe("刚刚");
    expect(formatRelativeTime(ago(5 * M), now)).toBe("5 分钟前");
    expect(formatRelativeTime(ago(3 * H), now)).toBe("3 小时前");
    expect(formatRelativeTime(ago(1 * D), now)).toBe("昨天");
    expect(formatRelativeTime(ago(4 * D), now)).toBe("4 天前");
    expect(formatRelativeTime(ago(2 * 7 * D), now)).toBe("2 周前");
    expect(formatRelativeTime(ago(90 * D), now)).toBe("3 个月前");
    expect(formatRelativeTime(ago(400 * D), now)).toBe("1 年前");
  });

  it("空/坏输入回空串", () => {
    expect(formatRelativeTime(null, now)).toBe("");
    expect(formatRelativeTime("garbage", now)).toBe("");
  });
});

// ── 顶栏吸顶 + 卡片墙（2026-07-31）─────────────────────────────────────
// 纯 className 的改动最容易在后续重构里被无声改掉（不报错、测试也不红，
// 只是回到"筛选 chip 跟着滚没"）。这里读源码钉住几条必要条件。
describe("应用中心顶栏吸顶", () => {
  const src = readFileSync(
    new URL("../AppsWorkbench.tsx", import.meta.url),
    "utf8"
  );

  it("标题/搜索/tab/筛选整块 sticky 在滚动容器顶部", () => {
    expect(src).toMatch(/className="sticky top-0 z-30 /);
  });

  it("吸顶块必须自带背景——sticky 元素默认透明，卡片会从字底下穿过去", () => {
    const m = src.match(/className="sticky top-0 z-30 [^"]*"/);
    expect(m).not.toBeNull();
    // 钉的是"背景走壳底色这个 token"，不是某个具体色值——底色改过一次
    // （2026-08-03 冷灰 → 白），把 hex 写进断言的话每次换色都要改测试，
    // 而真正会出事的是**忘了给背景**（sticky 默认透明，卡片从标题底下穿过去）。
    expect(m![0]).toMatch(/bg-\[var\(--sr-shell-bg,\s*#[0-9a-fA-F]{3,6}\)\]/);
  });

  it("负 margin + 同值 padding 抵掉根节点内边距，背景铺满整宽", () => {
    // 不这么做的话卡片会从左右内边距那两条缝里透出来。
    const m = src.match(/className="sticky top-0 z-30 [^"]*"/)![0];
    for (const cls of ["-mx-6", "px-6", "-mt-5", "pt-5", "md:-mx-8", "md:px-8"]) {
      expect(m).toContain(cls);
    }
  });

  it("z-30 高于卡片菜单(z-10)与健康浮层(z-20)", () => {
    // 健康浮层在吸顶块**里面**，跟着一起吸顶；卡片菜单在下面，被盖住是对的。
    expect(src).toContain("top-11 z-20"); // 健康浮层
    expect(src).toContain("top-8 z-10"); // 卡片菜单
  });

  it("卡片墙用绝对定位容器，不再是等尺寸 grid", () => {
    expect(src).toContain('data-testid="apps-wall"');
    // 旧写法：grid-cols-2 + 每卡 aspect-video，手机档被硬拉成 16:9
    expect(src).not.toMatch(/grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">\s*\{pagedMine/);
  });
});


// ── 卡片墙：masonic 瀑布流 + 图下信息区（2026-07-31）───────────────────
describe("卡片墙走 masonic，高度由内容决定", () => {
  const src = readFileSync(new URL("../AppsWorkbench.tsx", import.meta.url), "utf8");
  const scroller = readFileSync(new URL("../useScrollerIn.ts", import.meta.url), "utf8");

  it("换掉 react-photo-album——它的高度是算出来的，装不下图外文案", () => {
    // photo-album 的模型是 height = columnWidth / ratio（源码 masonry.ts），
    // 高度只能由比例反推。卡片改成「画面 + 图下信息区」之后，信息区多高取决于
    // 标题会不会换行，结构上就不该由比例决定。
    // 只禁 import——注释里为了说明取舍还会提到这个库名。
    expect(src).not.toMatch(/from "react-photo-album/);
    expect(src).not.toMatch(/import "react-photo-album/);
    expect(src).not.toContain("MasonryPhotoAlbum");
    expect(src).not.toContain("ColumnsPhotoAlbum");
    // 定位器把高度当**输入**：set(index, height)，配 ResizeObserver 量真实 DOM
    // 再回填。2026-07-31 起这一层是自建的 SpanMasonry（要支持跨列，masonic 的
    // useMasonry 把每格宽度写死成全局列宽），但"高度是输入"这条契约没变。
    expect(src).toMatch(/from "masonic"/);
    expect(src).toContain("useContainerPosition");
    expect(src).toContain("SpanMasonry");
    const positioner = readFileSync(new URL("../span-positioner.ts", import.meta.url), "utf8");
    expect(positioner).toMatch(/set\(index, height/);
    const masonry = readFileSync(new URL("../SpanMasonry.tsx", import.meta.url), "utf8");
    expect(masonry).toContain("ResizeObserver");
    // 钉的是**性质**不是那一行的写法：喂给定位器的高度必须来自真实 DOM 量高
    // （offsetHeight），不能是按比例算出来的。
    //
    // 2026-08-09 改过一次：原来写死 `positioner.set(index, el.offsetHeight)`，
    // 定位器改成从 ref 读、下标改成从 DOM 属性读之后这条就红了——而契约根本没变。
    // 这正是"钉实例不钉性质"的老毛病，改成钉两件事：量的是 offsetHeight、
    // 量到的值最终进了 positioner.set。
    expect(masonry).toContain("offsetHeight");
    expect(masonry).toMatch(/\.set\(index, h\b|\.set\(index, el\.offsetHeight\)/);
  });

  it("跨列：逐格宽度必须是自己算的，不能退回全局列宽", () => {
    // masonic use-masonry.js:93 把 style.width 写死成 positioner.columnWidth，
    // 跨列卡因此只能画一列宽。这里钉住"宽度来自该格自己的落位结果"。
    const masonry = readFileSync(new URL("../SpanMasonry.tsx", import.meta.url), "utf8");
    expect(masonry).toMatch(/width: pos\.width/);
    // 隐藏量高那一批也要用跨列后的宽度，否则量出来的高度是按一列宽换行的，偏高。
    expect(masonry).toMatch(/const w = columnWidth \* span \+ gutter \* \(span - 1\)/);
  });

  it("不用开箱的 <Masonry>——它的滚动源写死是 window", () => {
    // <Masonry> → MasonryScroller → useScroller() → @react-hook/window-scroll。
    // 本应用滚的是 .native-content，window 一格都不滚 → scrollTop 恒 0 →
    // 取件窗口锁死在首屏，往下滚只有空白。所以按官方 advanced usage 自己拼。
    expect(src).not.toMatch(/\bMasonry\b(?!Photo)\s*[,}]/);
    expect(src).toContain("useScrollerIn");
    expect(src).toContain("useContainerPosition");
  });

  it("滚动源找的是最近可滚动祖先，不是 window", () => {
    expect(scroller).toContain("findScrollParent");
    expect(scroller).toMatch(/overflowY === "auto"/);
    // scrollTop 必须是**相对网格**的（照抄官方 use-scroller.js 最后一行），
    // 否则网格上方那段顶栏高度会被当成已滚距离。
    expect(scroller).toMatch(/Math\.max\(0,\s*raw - offset\)/);
    // 视口高度取滚动容器的 clientHeight，不是 window.innerHeight
    expect(scroller).toContain("scroller.clientHeight");
  });

  it("卡片高度不写死：只给画面区高度，信息区交给浏览器量", () => {
    // 画面区高度 = 列宽 / 设备宽高比（那是图，比例是真信息）。
    expect(src).toMatch(/const mediaH = Math\.round\(cellW \/ aspectForDevice\(item\.summary\?\.device\)\)/);
    expect(src).toContain("mediaHeight={mediaH}");
    // 外框不能带 height——写死等于把「高度由内容决定」退回去了。
    expect(src).not.toMatch(/style=\{\{ width: cellW, height: cellH \}\}/);
    expect(src).not.toContain("cellH");
  });

  it("信息条压在画面上，不另占卡片高度（用户裁决，2026-07-31 改回）", () => {
    // 曾经因为"压在图上有文字宽度下限"（手机档 122px 宽时那排指标挤成两行）
    // 把信息区挪到了图下。那个下限来自 justified 排法，而 justified 已经换成
    // 瀑布流：最窄列宽 260、实测 308，跨列 632，122px 的场景不会再出现。
    // 改回压字之后同样的卡高能多显示一截应用画面。
    expect(src).toMatch(/absolute inset-x-0 bottom-0 bg-gradient-to-t from-black\//);
    // 压在深色渐变上就必须是白字
    expect(src).toMatch(/text-\[13\.5px\] font-semibold text-white/);
    expect(src).toContain("text-white/75");
    // 画面要铺满整张卡——信息条是浮层，不能再把画面挤成上半截
    expect(src).toContain("absolute inset-0 overflow-hidden");
  });

  it("压在渐变上的元素不能留浅底深字", () => {
    // 版本徽标原本是 bg-slate-100 + text-slate-600（图下白底时对的），
    // 挪到黑色渐变上就反了。这条防止以后再往信息条里加浅底元素。
    expect(src).not.toMatch(/bg-slate-100 px-1\.5 text-\[10px\] font-semibold text-slate-600/);
    expect(src).not.toMatch(/inline-flex items-center text-slate-400"\s*\n\s*title=\{formatUpdatedAt/);
  });

  it("门语言标签是中文，且筛选条与卡片徽标同源", () => {
    // 2026-07-31 用户要求汉化：原文 "closed 6/6" / "blocked" 跟旁边的「推演中」
    // 混排，一排筛选条两种语言。
    //
    // 2026-08-07 用户又裁了一刀：**把 "6/6" 去掉**（原话「用户根本不关注这些，
    // 只会增加用户负担」）。代码当天就改了，这条用例没跟上，于是它红在
    // main 上好几天——每次跑全量都要重新判一遍"是不是我弄的"。
    expect(src).toContain('label: "已闭环"');
    expect(src).toContain('label: "待补充"');
    expect(src).not.toMatch(/label:\s*"closed 6\/6"/);
    expect(src).not.toMatch(/label:\s*"blocked"/);
    // 筛选条不能再各写一份字面量——此前两处分开写，改一处漏一处就会
    // 出现"筛选叫 blocked、卡片叫待补充"。
    expect(src).toContain("label={STATUS_META.runnable.label}");
    expect(src).toContain("label={STATUS_META.awaiting.label}");
    expect(src).not.toMatch(/label="closed 6\/6"/);
    expect(src).not.toMatch(/label="blocked"/);
    // **反过来钉：6/6 不许回来。**
    //
    // 这条原来写的是"6/6 的数字不能丢：它是六个 Skill 的证据条数，不是装饰"
    // ——那个理由在 08-07 被推翻了，而推翻的论据写在 AppsWorkbench 的注释里：
    // 那个数字**只在「已闭环」这一支出现，而这一支恒等于 6/6**，所以它从来
    // 没有承担过"还差几项"的信息量。去掉不丢信息。
    expect(src).not.toMatch(/已闭环 6\/6/);
  });

  it("aspectForDevice 保持设备事实，不带任何卡片墙的钳制", () => {
    // 它还服务运行时和 dev-harness，那里要的是真实设备比例。
    const lib = readFileSync(new URL("../../../../lib/justified-rows.ts", import.meta.url), "utf8");
    expect(lib).not.toContain("WALL_MIN_ASPECT");
  });
});
