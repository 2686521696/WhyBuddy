/**
 * 设计器二期数据层测试。
 * 锁：树操作纯函数（插入容器规则/删除根保护/移动防成环/复制重发 id）、
 * 模型级校验（绑定悬挂如实报告）、默认树推导（推演页面 → 组件树投影）、
 * 撤销重做快照栈、本地持久化 round-trip。
 */
import { describe, it, expect, beforeEach } from "vitest";

// node 测试环境无 localStorage：内存 shim（与 runtime-snapshot.test.ts 同法）
const memStore = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage ??= {
  getItem: (k: string) => memStore.get(k) ?? null,
  setItem: (k: string, v: string) => void memStore.set(k, v),
  removeItem: (k: string) => void memStore.delete(k),
  clear: () => memStore.clear(),
  key: (i: number) => [...memStore.keys()][i] ?? null,
  get length() {
    return memStore.size;
  },
} as Storage;
import {
  createNode,
  findNode,
  nodePath,
  findParent,
  countNodes,
  insertNode,
  removeNode,
  moveNode,
  updateNode,
  duplicateNode,
  validateTree,
  TreeHistory,
  type ComponentNode,
} from "../live-runtime/designer/component-schema";
import {
  getComponentDefinition,
  listComponentDefinitions,
  listComponentsByCategory,
} from "../live-runtime/designer/component-registry";
import {
  deriveDefaultPageTree,
  loadPageTrees,
  savePageTrees,
  clearPageTrees,
  countDesignedPages,
} from "../live-runtime/designer/page-tree";
import type { FiveSystemModel } from "../system-screens/five-system-model";

const getDef = getComponentDefinition;

const MODEL: FiveSystemModel = {
  datamodel: {
    entities: [
      {
        id: "course",
        name: "课程",
        fields: [
          { id: "title", name: "标题", type: "string" },
          { id: "price", name: "价格", type: "number" },
          { id: "status", name: "状态", type: "enum" },
          { id: "teacher", name: "讲师", type: "string" },
          { id: "created_at", name: "创建时间", type: "date" },
          { id: "desc", name: "简介", type: "text" },
          { id: "slogan", name: "口号", type: "string" },
        ],
      },
    ],
  },
  page: {
    pages: [
      {
        id: "page_course",
        name: "课程管理",
        fieldBindings: ["course.title", "course.price", "course.status"],
        charts: [
          { id: "c1", name: "状态分布", type: "pie", dimension: "course.status", metric: "count" },
          { id: "c_bad", name: "悬挂图", type: "bar", dimension: "course.ghost", metric: "count" },
        ],
      },
      { id: "page_blank", name: "空白页", fieldBindings: [] },
    ],
  },
  appbundle: {
    pageBindings: [{ pageRef: "page_course", workflowRef: "wf_main" }],
  },
};

function makeTree(): ComponentNode {
  const root = createNode(getDef("container")!);
  const table = createNode(getDef("data-table")!);
  table.props = { ...table.props, entityId: "course", columnFieldIds: ["title", "price"] };
  const group = createNode(getDef("group")!);
  const text = createNode(getDef("text")!);
  group.children!.push(text);
  root.children!.push(table, group);
  return root;
}

describe("注册表", () => {
  it("核心 17 组件全注册，四分类各有成员", () => {
    expect(listComponentDefinitions().length).toBe(17);
    const cats = listComponentsByCategory();
    expect(cats.map((c) => c.key)).toEqual(["layout", "basic", "input", "data"]);
    for (const c of cats) expect(c.items.length).toBeGreaterThan(0);
    // 数据组件的绑定属性是数据感知类型（属性面板只出真实字段的前提）
    const table = getDef("data-table")!;
    expect(table.propsSchema.find((p) => p.key === "entityId")?.type).toBe("entitySelect");
    expect(table.propsSchema.find((p) => p.key === "columnFieldIds")?.type).toBe(
      "fieldIdMultiSelect"
    );
  });
});

describe("树操作（纯函数）", () => {
  it("insertNode：容器接受子组件、非容器拒绝、白名单越界拒绝；原树不变", () => {
    const root = makeTree();
    const before = countNodes(root);
    const btn = createNode(getDef("button")!);
    const ok = insertNode(root, root.id, btn, getDef, 0);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.root.children![0].type).toBe("button");
    expect(countNodes(root)).toBe(before); // 纯函数：入参树没被改

    const table = root.children![0];
    const intoLeaf = insertNode(root, table.id, createNode(getDef("text")!), getDef);
    expect(intoLeaf.ok).toBe(false);

    // tabs 只接受 container
    const tabs = createNode(getDef("tabs")!);
    const withTabs = insertNode(root, root.id, tabs, getDef);
    expect(withTabs.ok).toBe(true);
    if (withTabs.ok) {
      const bad = insertNode(withTabs.root, tabs.id, createNode(getDef("button")!), getDef);
      expect(bad.ok).toBe(false);
      const good = insertNode(withTabs.root, tabs.id, createNode(getDef("container")!), getDef);
      expect(good.ok).toBe(true);
    }
  });

  it("removeNode：可删普通节点，根容器保护", () => {
    const root = makeTree();
    const table = root.children![0];
    const removed = removeNode(root, table.id);
    expect(removed.ok).toBe(true);
    if (removed.ok) expect(findNode(removed.root, table.id)).toBeNull();
    expect(removeNode(root, root.id).ok).toBe(false);
  });

  it("moveNode：可换容器与排序；移入自身/后代拒绝", () => {
    const root = makeTree();
    const table = root.children![0];
    const group = root.children![1];
    const moved = moveNode(root, table.id, group.id, getDef, 0);
    expect(moved.ok).toBe(true);
    if (moved.ok) {
      const g = findNode(moved.root, group.id)!;
      expect(g.children![0].id).toBe(table.id);
    }
    expect(moveNode(root, group.id, group.id, getDef).ok).toBe(false);
    const text = group.children![0];
    // group 移入自己的后代 text（text 非容器本会被容器规则拒，但成环守卫先拦）
    expect(moveNode(root, group.id, text.id, getDef).ok).toBe(false);
  });

  it("updateNode 浅合并 props；duplicateNode 全子树重发 id 且插在原位后", () => {
    const root = makeTree();
    const table = root.children![0];
    const updated = updateNode(root, table.id, { props: { pageSize: 10 }, name: "改名" });
    expect(updated.ok).toBe(true);
    if (updated.ok) {
      const t = findNode(updated.root, table.id)!;
      expect(t.props.pageSize).toBe(10);
      expect(t.props.entityId).toBe("course"); // 未动的键保留
      expect(t.name).toBe("改名");
    }

    const group = root.children![1];
    const dup = duplicateNode(root, group.id);
    expect(dup.ok).toBe(true);
    if (dup.ok) {
      expect(dup.root.children!.length).toBe(3);
      const copy = dup.root.children![2];
      expect(copy.type).toBe("group");
      expect(copy.id).not.toBe(group.id);
      expect(copy.children![0].id).not.toBe(group.children![0].id); // 子树也重发
    }
  });

  it("nodePath/findParent：面包屑路径", () => {
    const root = makeTree();
    const group = root.children![1];
    const text = group.children![0];
    expect(nodePath(root, text.id)!.map((n) => n.type)).toEqual(["container", "group", "text"]);
    expect(findParent(root, text.id)!.id).toBe(group.id);
  });
});

describe("validateTree（绑定悬挂如实报告）", () => {
  it("合法树零问题；悬挂实体/字段/图表维度/跳转页面逐一报出", () => {
    const root = makeTree();
    expect(validateTree(root, MODEL, getDef)).toEqual([]);

    let bad = updateNode(root, root.children![0].id, {
      props: { entityId: "ghost_entity" },
    });
    expect(bad.ok).toBe(true);
    if (bad.ok) {
      const issues = validateTree(bad.root, MODEL, getDef);
      expect(issues.some((i) => i.message.includes("ghost_entity"))).toBe(true);
    }

    const chart = createNode(getDef("chart")!);
    chart.props = { ...chart.props, dimension: "course.ghost", metric: "sum:course.ghost2" };
    const withChart = insertNode(root, root.id, chart, getDef);
    if (withChart.ok) {
      const issues = validateTree(withChart.root, MODEL, getDef);
      expect(issues.filter((i) => i.nodeId === chart.id).length).toBe(2);
    }

    const btn = createNode(getDef("button")!);
    btn.props = { ...btn.props, actionKind: "openPage", actionPageId: "page_ghost" };
    const withBtn = insertNode(root, root.id, btn, getDef);
    if (withBtn.ok) {
      const issues = validateTree(withBtn.root, MODEL, getDef);
      expect(issues.some((i) => i.nodeId === btn.id && i.message.includes("page_ghost"))).toBe(
        true
      );
    }
  });
});

describe("deriveDefaultPageTree（推演页面 → 组件树投影）", () => {
  it("主实体页：图表区(悬挂图被滤) + 表格(前6字段列) + 分组表单(绑定字段) + 审批进度", () => {
    const tree = deriveDefaultPageTree(MODEL.page!.pages![0], MODEL);
    const types = tree.children!.map((n) => n.type);
    expect(types).toEqual(["columns", "data-table", "group", "approval-progress"]);

    const chartRow = tree.children![0];
    expect(chartRow.children!.length).toBe(1); // c_bad 悬挂被滤
    expect(chartRow.children![0].props.dimension).toBe("course.status");

    const table = tree.children![1];
    expect(table.props.entityId).toBe("course");
    expect(table.props.columnFieldIds).toEqual([
      "title",
      "price",
      "status",
      "teacher",
      "created_at",
      "desc",
    ]);

    const form = tree.children![2].children![0];
    expect(form.type).toBe("data-form");
    expect(form.props.formFieldIds).toEqual(["title", "price", "status"]);

    // 推导树本身必须过校验（悬挂零容忍）
    expect(validateTree(tree, MODEL, getDef)).toEqual([]);
  });

  it("无主实体页退化为提示文本，不造假数据组件", () => {
    const tree = deriveDefaultPageTree(MODEL.page!.pages![1], MODEL);
    expect(tree.children!.map((n) => n.type)).toEqual(["text"]);
  });
});

describe("TreeHistory（撤销重做快照栈）", () => {
  it("record→undo→redo 循环；新操作清空重做栈", () => {
    const h = new TreeHistory();
    const v1 = makeTree();
    const step = updateNode(v1, v1.children![0].id, { props: { pageSize: 10 } });
    if (!step.ok) throw new Error("unreachable");
    h.record(v1);
    const v2 = step.root;

    expect(h.canUndo()).toBe(true);
    const back = h.undo(v2)!;
    expect(findNode(back, v1.children![0].id)!.props.pageSize).toBe(5);
    expect(h.canRedo()).toBe(true);
    const forward = h.redo(back)!;
    expect(findNode(forward, v1.children![0].id)!.props.pageSize).toBe(10);

    h.record(forward); // 新操作
    expect(h.canRedo()).toBe(false);
  });
});

describe("页面树持久化", () => {
  beforeEach(() => clearPageTrees("s1"));

  it("save/load round-trip；未存会话返回空表", () => {
    expect(loadPageTrees("s1")).toEqual({});
    const tree = makeTree();
    savePageTrees("s1", { page_course: tree });
    const loaded = loadPageTrees("s1");
    expect(loaded.page_course.children!.length).toBe(2);
    expect(countDesignedPages(loaded)).toBe(1);
    clearPageTrees("s1");
    expect(loadPageTrees("s1")).toEqual({});
  });
});
