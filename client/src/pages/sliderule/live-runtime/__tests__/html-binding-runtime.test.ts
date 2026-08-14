// @vitest-environment jsdom
/**
 * HTML 绑定解释器 —— 穿线那一下。
 *
 * ⚠ 这是仓里第一组真的需要浏览器 DOM 的用例（此前客户端用例都走
 * `renderToStaticMarkup`，压根不碰 document）。所以顺手把 **jsdom 写进了
 * package.json 的 devDependencies**——它本来只是个传递依赖，装着但没声明。
 * 那个形状仓里记过一次：`rank-bm25` 漏在 requirements.txt 外，代码对它
 * fail-open，于是照那个状态建镜像部署，功能**一声不吭地整个失效**，本地
 * 测试还照样绿。用着没声明的依赖，早晚是同一个结局。
 *
 * 判据全部对着**真的 DOM** 断言（jsdom），不看快照、不数字符：
 * 今天在「造一个数去替代看一眼」上连栽四次，而这一层恰好是能机械判的——
 * 加一个字段就该多一列，这是 G2 组已经验过的那条真判据。
 */

import { describe, it, expect, vi } from "vitest";

import {
  applyBindings,
  hasAnyDataSource,
  type BindingSource,
} from "../html-binding-runtime";

function dom(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

const FIELDS = [
  { id: "plate", name: "车牌号" },
  { id: "owner", name: "车主" },
  { id: "mileage", name: "里程", type: "number" },
];

const SOURCE: BindingSource = {
  rows: {
    vehicle: [
      { id: "v1", plate: "京A·11111", owner: "张师傅", mileage: 30000, brand: "甲牌" },
      { id: "v2", plate: "京B·22222", owner: "李师傅", mileage: 10000, brand: "乙牌" },
      { id: "v3", plate: "京C·33333", owner: "王师傅", mileage: 20000, brand: "甲牌" },
    ],
  },
  fields: { vehicle: FIELDS },
};

const TABLE = `
  <table>
    <thead data-head="vehicle"><tr><th data-col>列</th></tr></thead>
    <tbody data-rows="vehicle">
      <tr><td data-cell>格</td><td><button data-action="editRecord" data-entity="vehicle">编辑</button></td></tr>
    </tbody>
  </table>`;

describe("逐行展开", () => {
  it("有几行就渲染几行", () => {
    const root = dom(TABLE);
    const r = applyBindings(root, { source: SOURCE });
    expect(root.querySelectorAll("tbody tr")).toHaveLength(3);
    expect(r.filled.rows).toBe(3);
    expect(r.problems).toEqual([]);
  });

  it("表头与单元格都按字段清单展开", () => {
    const root = dom(TABLE);
    applyBindings(root, { source: SOURCE });
    expect(root.querySelectorAll("thead th")).toHaveLength(3);
    expect(root.textContent).toContain("车牌号");
    expect(root.textContent).toContain("京A·11111");
  });

  it("**加一个字段就自动多一列** —— G2 验过的那条真判据", () => {
    const root = dom(TABLE);
    applyBindings(root, { source: SOURCE });
    const before = root.querySelectorAll("thead th").length;

    const grown: BindingSource = {
      rows: { vehicle: SOURCE.rows.vehicle.map((r) => ({ ...r, brand: r.brand })) },
      fields: { vehicle: [...FIELDS, { id: "brand", name: "品牌" }] },
    };
    applyBindings(root, { source: grown });

    expect(root.querySelectorAll("thead th")).toHaveLength(before + 1);
    expect(root.textContent).toContain("品牌");
    expect(root.textContent).toContain("甲牌");
  });

  it("重复调用是重建不是叠加", () => {
    const root = dom(TABLE);
    applyBindings(root, { source: SOURCE });
    applyBindings(root, { source: SOURCE });
    applyBindings(root, { source: SOURCE });
    expect(root.querySelectorAll("tbody tr")).toHaveLength(3);
  });

  it("操作列这类不带 data-cell 的兄弟节点保住且留在最后", () => {
    const root = dom(TABLE);
    applyBindings(root, { source: SOURCE });
    const cells = root.querySelectorAll("tbody tr:first-child td");
    expect(cells).toHaveLength(4); // 3 字段 + 1 操作列
    expect(cells[3].querySelector("button")).not.toBeNull();
  });
});

describe("排序与截断", () => {
  it("data-sort + data-order 生效", () => {
    const root = dom(TABLE.replace('data-rows="vehicle"',
      'data-rows="vehicle" data-sort="mileage" data-order="desc"'));
    applyBindings(root, { source: SOURCE });
    expect(root.querySelector("tbody tr")!.textContent).toContain("京A");
  });

  it("空值恒沉底，不受升降序影响", () => {
    const src: BindingSource = {
      rows: { vehicle: [{ id: "a", plate: "有", mileage: null }, { id: "b", plate: "无", mileage: 5 }] },
      fields: { vehicle: FIELDS },
    };
    const root = dom(TABLE.replace('data-rows="vehicle"',
      'data-rows="vehicle" data-sort="mileage" data-order="desc"'));
    applyBindings(root, { source: src });
    // 空不是"最小"，是"没有"——降序也不该把它顶到最前
    expect(root.querySelectorAll("tbody tr")[1].textContent).toContain("有");
  });

  it("没写 data-limit 不等于只要 0 行", () => {
    // ⚠ Number(null) === 0 这个坑本仓踩过一次：缺省被解释成"限 0 行"，
    //    整张表当场变空，而且没有任何报错
    const root = dom(TABLE);
    applyBindings(root, { source: SOURCE });
    expect(root.querySelectorAll("tbody tr")).toHaveLength(3);
  });

  it("data-limit 生效且写坏了当没写", () => {
    const one = dom(TABLE.replace('data-rows="vehicle"', 'data-rows="vehicle" data-limit="1"'));
    applyBindings(one, { source: SOURCE });
    expect(one.querySelectorAll("tbody tr")).toHaveLength(1);

    const bad = dom(TABLE.replace('data-rows="vehicle"', 'data-rows="vehicle" data-limit="abc"'));
    applyBindings(bad, { source: SOURCE });
    expect(bad.querySelectorAll("tbody tr")).toHaveLength(3);
  });
});

describe("单值聚合", () => {
  it("count 数行数", () => {
    const root = dom('<span data-value="vehicle" data-aggregate="count"></span>');
    applyBindings(root, { source: SOURCE });
    expect(root.textContent).toBe("3");
  });

  it("sum / avg / max / min", () => {
    const mk = (k: string) => {
      const root = dom(`<span data-value="vehicle" data-aggregate="${k}" data-field="mileage"></span>`);
      applyBindings(root, { source: SOURCE });
      return root.textContent;
    };
    expect(mk("sum")).toBe("60000");
    expect(mk("avg")).toBe("20000");
    expect(mk("max")).toBe("30000");
    expect(mk("min")).toBe("10000");
  });

  it("空数据显 — 不显 0", () => {
    // 0 是个真值，拿它冒充"没有"是在撒谎（✦3 同一口径）
    const empty: BindingSource = { rows: { vehicle: [] }, fields: { vehicle: FIELDS } };
    const root = dom('<span data-value="vehicle" data-aggregate="sum" data-field="mileage"></span>');
    applyBindings(root, { source: empty });
    expect(root.textContent).toBe("—");
  });
});

describe("图表只算不画", () => {
  it("按维度分桶算出 series 挂上", () => {
    const root = dom('<div data-chart="bar" data-entity="vehicle" data-dimension="brand" data-metric="count"></div>');
    applyBindings(root, { source: SOURCE });
    const series = JSON.parse(root.querySelector("[data-chart]")!.getAttribute("data-series")!);
    expect(series).toEqual([{ name: "甲牌", value: "2" }, { name: "乙牌", value: "1" }]);
  });

  it("不在这里画 —— 画有自己一堆判据，混进来两边都测不干净", () => {
    const root = dom('<div data-chart="bar" data-entity="vehicle" data-dimension="brand"></div>');
    applyBindings(root, { source: SOURCE });
    expect(root.querySelector("canvas")).toBeNull();
    expect(root.querySelector("svg")).toBeNull();
  });
});

describe("动作：点一下真的发事件，且不发空事件", () => {
  it("行内动作带得出当前行 id", () => {
    const seen: unknown[] = [];
    const root = dom(TABLE);
    applyBindings(root, { source: SOURCE, onAction: (e) => seen.push(e) });
    (root.querySelectorAll("tbody button")[0] as HTMLElement).click();
    expect(seen).toEqual([{ kind: "editRecord", entityId: "vehicle", rowId: "v1" }]);
  });

  it("拿错行等于点了没反应 —— 第二行发的必须是 v2", () => {
    const seen: any[] = [];
    const root = dom(TABLE);
    applyBindings(root, { source: SOURCE, onAction: (e) => seen.push(e) });
    (root.querySelectorAll("tbody button")[1] as HTMLElement).click();
    expect(seen[0].rowId).toBe("v2");
  });

  it("createRecord 没有行，rowId 为 null 而不是空串", () => {
    const seen: any[] = [];
    const root = dom('<button data-action="createRecord" data-entity="vehicle">新建</button>');
    applyBindings(root, { source: SOURCE, onAction: (e) => seen.push(e) });
    (root.querySelector("button") as HTMLElement).click();
    expect(seen[0]).toEqual({ kind: "createRecord", entityId: "vehicle", rowId: null });
  });

  it("取不到行 id 就不挂监听，如实报问题", () => {
    // 静默失败的形态：照挂监听 → 点下去发一个空事件 → 页面开出一个空详情，
    // 看着像"点了没反应"。actionRef 那轮补运行时判据时点过名。
    const fn = vi.fn();
    const root = dom('<button data-action="editRecord" data-entity="vehicle">改</button>');
    const r = applyBindings(root, { source: SOURCE, onAction: fn });
    (root.querySelector("button") as HTMLElement).click();
    expect(fn).not.toHaveBeenCalled();
    expect(r.problems.some((p) => p.includes("取不到行 id"))).toBe(true);
  });

  it("键盘可达 —— axe 会报但没人跑 axe，所以直接给上", () => {
    const root = dom(TABLE);
    applyBindings(root, { source: SOURCE });
    const btn = root.querySelector("tbody button")!;
    expect(btn.getAttribute("role")).toBe("button");
    expect(btn.getAttribute("tabindex")).toBe("0");
  });

  it("词表之外的 kind 拒掉", () => {
    const root = dom('<button data-action="deleteEverything" data-entity="vehicle"></button>');
    const r = applyBindings(root, { source: SOURCE });
    expect(r.problems.some((p) => p.includes("封闭词表"))).toBe(true);
  });
});

describe("引用不存在的东西要如实报，不许静默", () => {
  it("实体不存在", () => {
    // ⚠ 必须裹 <table>：<tbody>/<tr>/<td> 塞进 <div>.innerHTML 会被解析器直接丢掉
    //   （它们只在表格里合法）。夹具第一版没裹，元素压根不存在，判据看着"不响"，
    //   差点被我当成实现有问题。
    const root = dom('<table><tbody data-rows="不存在"><tr><td data-cell></td></tr></tbody></table>');
    const r = applyBindings(root, { source: SOURCE });
    expect(r.problems.some((p) => p.includes("不存在"))).toBe(true);
  });

  it("data-field 不是所在 data-rows 那个实体的字段", () => {
    // 作用域判据：字段是真的，但拿工单表的一行去取客户的字段，
    // 取出来是别人的数据。跟自由树 rowsRef/fieldRef 的树级校验同口径。
    const root = dom(
      '<table><tbody data-rows="vehicle"><tr><td data-field="customer_name"></td></tr></tbody></table>');
    const r = applyBindings(root, { source: SOURCE });
    expect(r.problems.some((p) => p.includes("customer_name"))).toBe(true);
  });
});

describe("一个孔都没打的页面不许看起来完美通过", () => {
  it("problems 空 + filled 全 0，但那不代表做完了", () => {
    const root = dom("<div><h1>标题</h1><p>一段字</p></div>");
    const r = applyBindings(root, { source: SOURCE });
    expect(r.problems).toEqual([]);            // 没有绑定就没有错误的绑定
    expect(Object.values(r.filled).every((n) => n === 0)).toBe(true);
  });

  it("所以另有 hasAnyDataSource 单独守这一条", () => {
    // 今天在这个形状上栽了五次（调度核 startswith / nav 顺序 / 第4步整页丢 /
    // 第5步可溯率 / 第6步过结构闸）。判据只查"产出的对不对"，
    // 不查"该有的在不在"，就必然漏。
    expect(hasAnyDataSource(dom("<div><h1>死页</h1></div>"))).toBe(false);
    expect(hasAnyDataSource(dom(TABLE))).toBe(true);
  });
});

describe("enum 字段显标签，不显内部 id", () => {
  /**
   * ⚠ 这组是补的，因为 BindingField.options 头一版写成 `{ value, label }`，
   * 而 formatFieldText 读的是 `o.id`——两边对不上的后果不是报错，是
   * **enum 恒显内部 id**（`music_member` 这种漏到界面上，线上截图逮到过）。
   *
   * 那时唯一的迹象只是 tsc 的一条类型错。而"类型不对但跑得动"正是这个仓
   * 反复栽的形状：页面照渲染、problems 是空的、消毒器照常成功。
   * 所以判据落在**渲染出来的字**上，不落在类型上。
   */
  const SRC: BindingSource = {
    rows: { order: [{ id: "o1", status: "in_transit" }, { id: "o2", status: "unknown_x" }] },
    fields: {
      order: [
        { id: "status", name: "状态", type: "enum",
          options: [{ id: "in_transit", label: "运输中" }, { id: "done", label: "已完成" }] },
      ],
    },
  };

  it("行内 data-field 出中文标签", () => {
    const root = dom(
      '<table><tbody data-rows="order"><tr><td data-field="status"></td></tr></tbody></table>');
    const r = applyBindings(root, { source: SRC });
    const cells = Array.from(root.querySelectorAll("td")).map((td) => td.textContent);
    expect(cells[0]).toBe("运输中");
    expect(r.problems).toEqual([]);
  });

  it("值不在 options 里就如实出原文 —— 不猜、不显空", () => {
    const root = dom(
      '<table><tbody data-rows="order"><tr><td data-field="status"></td></tr></tbody></table>');
    applyBindings(root, { source: SRC });
    const cells = Array.from(root.querySelectorAll("td")).map((td) => td.textContent);
    expect(cells[1]).toBe("unknown_x");
  });

  it("data-cell 展开的单元格走同一条格式化 —— 两条读路不许分叉", () => {
    const root = dom(
      '<table><tbody data-rows="order"><tr><td data-cell>格</td></tr></tbody></table>');
    applyBindings(root, { source: SRC });
    expect(root.querySelector("tbody tr td")?.textContent).toBe("运输中");
  });

  it("label 缺席时回落 id，不显 undefined", () => {
    const src: BindingSource = {
      rows: { order: [{ id: "o1", status: "in_transit" }] },
      fields: { order: [{ id: "status", type: "enum", options: [{ id: "in_transit" }] }] },
    };
    const root = dom(
      '<table><tbody data-rows="order"><tr><td data-field="status"></td></tr></tbody></table>');
    applyBindings(root, { source: src });
    expect(root.querySelector("td")?.textContent).toBe("in_transit");
  });
});
