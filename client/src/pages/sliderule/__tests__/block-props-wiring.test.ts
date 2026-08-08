/**
 * 区块 props 接线护栏（2026-08-08，②阶段复盘的产物）。
 *
 * ## 这条护栏是怎么来的
 *
 * 搬到第 23 个区块时做了一次复盘，本来是想找"哪些逻辑在反复重写、该抽成
 * schema"。找到的不是重复代码，是**一条一直在漏的缝**：
 *
 * 批次 1-4 给渲染器加了六个新 prop（selection / onSelectionChange /
 * columnState / onColumnStateChange / targetColumns / focus）。装配预览
 * （ComponentsLibraryPage）每个都接了，**真实运行时（AppRuntimeScreen）一个
 * 都没接**。于是这六个 prop 撑起来的那些区块在真实应用里全是死壳：
 *
 *     BatchActionBar    永远显示「勾选左侧的行」
 *     DataTable         没有勾选列
 *     ColumnSettingPanel 「没有连到任何表格」
 *     关联单据表         「先选中一条主记录」
 *     TagFilterRow      勾了标签没反应
 *     SearchBox         敲了词没反应
 *
 * 每一个都渲染得**完全正常**，只是点不动——这正是这个项目已经踩过一次的
 * 形状（QuickActionPanel 拿不到 pageActions，一直渲染成空气、没人发现）。
 *
 * AppRuntimeScreen 里那份 `sharedBlockRendererProps` 当初就是为了防这件事
 * 建的，它的注释写着"逐个列举等于每加一个 prop 就埋一次漏传"。**但它自己
 * 就是逐个列举的**，只是把三个调用点收成了一处——加新 prop 时照样要记得回来
 * 补，漏了不报错。
 *
 * ## 所以这条护栏钉的是什么
 *
 * 渲染器接口里每一个 prop，要么被宿主真的传了，要么写进下面的豁免名单并
 * 说明为什么。**沉默的漏传变成红用例。**
 *
 * 这不是"抽象"——四种页面态的形状还没稳定到该合并（见文件末尾的观察）。
 * 这是在真正抽象之前，先把已经在流血的地方止住。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (rel: string) =>
  readFileSync(new URL(rel, import.meta.url), "utf8");

const registry = read("../live-runtime/block-registry.tsx");
const runtime = read("../live-runtime/AppRuntimeScreen.tsx");
const library = read("../ComponentsLibraryPage.tsx");

/** 渲染器接口里声明的 prop 名（不含下划线开头的遗留字段）。 */
function declaredProps(): string[] {
  const start = registry.indexOf("export interface ExperienceBlockRendererProps {");
  expect(start, "找不到渲染器 props 接口 —— 是不是改名了？").toBeGreaterThan(-1);
  const end = registry.indexOf("\n}", start);
  return [...registry.slice(start, end).matchAll(/^ {2}(\w+)\??:/gm)]
    .map(m => m[1])
    .filter(name => !name.startsWith("_"));
}

/**
 * 不需要宿主传的 prop，逐个说明理由。
 *
 * **加东西进这张表要写清楚为什么**——它是豁免名单，不是待办清单。
 */
const NOT_FROM_HOST: Record<string, string> = {
  block: "每个调用点单独传的那一个，本来就不在共享包里",
  children: "遗留 children 透传，装配路径不用",
  previewId: "只有落地页自审那条路用得上",
  sessionId: "只有需要解析生成资产的宿主传（AppRuntimeScreen 传了，对照台不需要）",
  pageActions: "QuickActionPanel 专用，对照台用自己那份 previewActions",
  targetColumns: "**按区块算**，不能进整页共享的那一份，各调用点单独传",
  workflow: "五系统数据，只有拿得到 model 的宿主传",
};

describe("渲染器的每个 prop 都得有人真的传", () => {
  const props = declaredProps();

  it("接口不是空的（正则没写错）", () => {
    expect(props.length).toBeGreaterThan(15);
    expect(props).toContain("filterState");
    expect(props).toContain("focus");
  });

  it("**真实运行时**接齐了 —— 装配预览好使、真应用是死壳，是这条护栏的由来", () => {
    const start = runtime.indexOf("const sharedBlockRendererProps = {");
    expect(start, "sharedBlockRendererProps 不见了").toBeGreaterThan(-1);
    const shared = runtime.slice(start, runtime.indexOf("\n  };", start));
    const passed = new Set([...shared.matchAll(/^ {4}(\w+)[,:]/gm)].map(m => m[1]));
    const missing = props.filter(p => !passed.has(p) && !(p in NOT_FROM_HOST));
    expect(
      missing,
      `AppRuntimeScreen 没传：${missing.join(", ")}。` +
        "要么补进 sharedBlockRendererProps，要么写进 NOT_FROM_HOST 并说明理由——" +
        "不传而不说明的后果是区块渲染正常但点不动，没人会发现。"
    ).toEqual([]);
  });

  it("**装配预览**接齐了 —— 它是审阅区块的地方，缺一个就审不出真假", () => {
    const start = library.indexOf("const renderBlock = (b: AssembledBlock, i: number) => {");
    expect(start).toBeGreaterThan(-1);
    const seg = library.slice(start, library.indexOf("\n  };", start));
    const passed = new Set([...seg.matchAll(/\b(\w+)=\{/g)].map(m => m[1]));
    const missing = props.filter(p => !passed.has(p) && !(p in NOT_FROM_HOST));
    expect(
      missing,
      `ComponentsLibraryPage 没传：${missing.join(", ")}`
    ).toEqual([]);
  });

  it("豁免名单里的每一条都写了理由，且确实还在接口里", () => {
    for (const [name, why] of Object.entries(NOT_FROM_HOST)) {
      expect(why.length, `${name} 的豁免理由太短，说不清楚`).toBeGreaterThan(8);
      expect(props, `${name} 已经不在接口里了，豁免名单该删掉它`).toContain(name);
    }
  });
});

/**
 * 筛选通道同理：区块往 filterState 里写了什么，宿主就得读什么。
 *
 * 这一条是分开钉的，因为漏的形状不一样——上面那条漏的是 prop 没传，这条漏
 * 的是 prop 传了、但宿主的 reducer 逐字段重建时把新字段吞了。实际发生过：
 * `handlePageFilterChange` 只重建 enumFilters 和 dateRange，TagFilterRow 和
 * SearchBox 发过去的补丁被默默丢掉。
 */
describe("筛选态的每条通道，写的人和读的人对得上", () => {
  const channels = [...registry.matchAll(
    /^ {2}(enumFilters|dateRange|enumMulti|keyword)\??:/gm
  )].map(m => m[1]);

  it("契约里有四条通道", () => {
    expect(new Set(channels)).toEqual(
      new Set(["enumFilters", "dateRange", "enumMulti", "keyword"])
    );
  });

  it("真实运行时的过滤函数四条都读", () => {
    const start = runtime.indexOf("function applyPageFilter");
    const body = runtime.slice(start, runtime.indexOf("\n}", start));
    for (const c of channels) {
      expect(body, `applyPageFilter 没读 ${c} —— 那条筛选点了不会有反应`).toContain(c);
    }
  });

  it("真实运行时的 reducer 四条都保留", () => {
    const start = runtime.indexOf("const handlePageFilterChange");
    const body = runtime.slice(start, runtime.indexOf("\n  };", start));
    for (const c of channels) {
      expect(
        body,
        `handlePageFilterChange 把 ${c} 吞了 —— 逐字段重建的写法每加一条就要回来补`
      ).toContain(c);
    }
  });
});

/**
 * ── 复盘留下的一条观察，暂时**不**动手 ─────────────────────────────────
 *
 * 四份页面态现在是这样：
 *
 *     filterState   Record<区块id, {...}>     键是**筛选区块自己**的 id
 *     columnState   Record<区块id, {...}>     键是**目标表格**的 id
 *     selection     { rowIds: Record<实体, string[]> }   键是实体
 *     focus         Record<实体, string>                  键是实体
 *
 * 两套键并存（区块 id / 实体名），而且同样是"按区块 id"，filterState 存的是
 * 源、columnState 存的是目标。这看着像该统一，但**现在统一是错的**：
 *
 * - 按实体存是对的那两个（选中、聚焦），本来就是实体级概念——一页两张表
 *   绑同一个实体时，选中态本来就该共享。
 * - 按区块存的那两个，源/目标的区别是真实的：一个筛选条可以筛两张表
 *   （一对多），一张表的列设置只属于它自己（一对一）。
 *
 * 硬合成一个 `Record<key, unknown>` 只会把这些区别抹平，然后在每个读的地方
 * 重新判一次。等到出现**第三个**按目标存的状态、或者真的需要跨实体共享选中
 * 态时，再回来看。阶段③的触发条件是"真的看到重复"，这里看到的是**四份各不
 * 相同的东西长得有点像**——那不是重复。
 */

/**
 * 筛选**真的作用到区块上**了吗（2026-08-08，接线台逮到的）。
 *
 * 上面那两条钉的是"prop 传了"和"reducer 没吞"。这条钉的是第三种漏法，也是
 * 藏得最深的一种：prop 传了、reducer 也对，但**区块拿到的是全量行**。
 *
 * `applyPageFilter` 算出来的 `rows` 只喂给内置骨架那张表；区块拿的是
 * `state.entities`。于是 FilterBar / StatusTabs / TagFilterRow / SearchBox
 * 连着 DataTable 时，勾了、敲了，表一动不动——**从一开始就没接通**，
 * 不是这次新通道的问题。
 */
describe("筛选真的收窄了区块看到的行", () => {
  it("区块按 targets 拿自己那一份行，不是全量", () => {
    expect(
      runtime,
      "区块还在直接吃 state.entities —— 筛选作用不到它们身上"
    ).toContain("entityRows={rowsForBlockOf(block.id)}");
    expect(runtime).toContain("const rowsForBlockOf");
  });

  it("判据是「谁在筛我」，不是页面上有筛选就一律筛", () => {
    const start = runtime.indexOf("const rowsForBlockOf");
    const body = runtime.slice(start, start + 700);
    expect(body).toContain("targets as string[] | undefined)?.includes(blockId)");
    // 没人筛它的区块拿全量，不该被别的表的筛选连累
    expect(body).toContain("if (!applies) return state.entities;");
  });
});

/**
 * 页面级管道（2026-08-08，列表页归属三步走的第①步）。
 *
 * 新建表单 / 行详情 / 演示数据徽标这三样，此前**长在固定骨架身上**：骨架自己
 * 调 setFormOpen / setDetailRow，积木那条路想干同一件事没有入口——于是积木
 * 永远只能"显示"，不能"打开点什么"。
 *
 * 这一步把它们摘成整页共用的服务。分层照 nocobase 的 ActionContext /
 * ActionContainer：**容器（drawer/modal/page）由页面按设备决定，不由触发它的
 * 那个组件决定**；积木只说"打开这条记录"。
 */
describe("页面级管道：骨架和积木走同一条", () => {
  it("三条管道都收在一处，不再散在各调用点", () => {
    expect(runtime).toContain("const pagePipes");
    for (const pipe of ["openCreate", "openRecord", "openRecordById"]) {
      expect(runtime, `管道 ${pipe} 不见了`).toContain(pipe);
    }
  });

  it("**骨架不再自己 setState** —— 它跟积木用的是同一条", () => {
    const start = runtime.indexOf("<LazyProWorkbenchSurface");
    const body = runtime.slice(start, runtime.indexOf("/>", start));
    expect(body, "骨架的新建没走管道").toContain("onCreate={pagePipes.openCreate}");
    expect(body, "骨架的行点击没走管道").toContain("onOpenRow={pagePipes.openRecord}");
  });

  it("积木的 createRequest / editRequest 接进了管道", () => {
    const start = runtime.indexOf("const handleBlockAction");
    const body = runtime.slice(start, start + 2200);
    expect(body).toContain('actionId === "createRequest"');
    expect(body).toContain("pagePipes.openCreate()");
    expect(body).toContain('actionId === "editRequest"');
    expect(body).toContain("pagePipes.openRecordById(rowId)");
  });

  it("**rowSelect 只聚焦，不弹抽屉** —— 页面上可能已经摆了详情区块", () => {
    const start = runtime.indexOf('if (actionId === "rowSelect")');
    const body = runtime.slice(start, start + 420);
    expect(body).toContain("setFocus");
    expect(body, "rowSelect 弹了抽屉 —— 那就跟同页的 RecordDetail 做了两遍同一件事")
      .not.toContain("openRecord");
  });

  it("演示数据徽标抽成了独立节点", () => {
    expect(runtime).toContain("const seedNotice");
    // 抽出来之后不该还有第二份内联的
    expect(
      (runtime.match(/data-testid="app-runtime-seed-tag"/g) ?? []).length,
      "徽标出现了不止一处 —— 抽出来的意义就是只剩一份"
    ).toBe(1);
  });
});
