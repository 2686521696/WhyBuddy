/**
 * Work 五期 LLM 入魂档：消毒纯函数 + driver 注入回归。
 *
 * 锁的性质：
 *  - sanitizeTourFlavor 是权威防线：幻觉实体/字段/步骤 index 全部丢弃，
 *    number 字段强制数字化（非数字丢弃回落确定性值），台词截断；
 *  - driver flavor 注入：LLM 样例只覆盖不缺省（确定性样例兜底字段齐全），
 *    npc_line 事件带 source:"llm" 如实标注；不给 flavor 时行为不变
 *    （fail-closed 回退路径 = 五期之前的行为）。
 */

import { describe, it, expect } from "vitest";
import type { FiveSystemModel } from "../../system-screens/five-system-model";
import { deriveAppRuntimeSchema } from "../../live-runtime/app-runtime-schema";
import { buildTourScript } from "../tour-script";
import { runTour, type TourEvent } from "../tour-driver";
import { sanitizeTourFlavor } from "../tour-flavor";
import { loadRuntimeState } from "../../live-runtime/runtime-persistence";

// node 环境 localStorage shim（runtime-persistence 读写）
const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage ??= {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
};

const MODEL: FiveSystemModel = {
  datamodel: {
    entities: [
      {
        id: "ticket",
        name: "工单",
        fields: [
          { id: "title", name: "标题", type: "string" },
          { id: "amount", name: "金额", type: "number" },
        ],
      },
    ],
  },
  rbac: {
    roles: ["creator", "auditor"],
    permissions: ["ticket:create", "ticket:review"],
    menus: [
      {
        id: "m1",
        label: "工单台",
        roleRefs: ["creator"],
        permissionRefs: ["ticket:create"],
      },
      {
        id: "m2",
        label: "审核台",
        roleRefs: ["auditor"],
        permissionRefs: ["ticket:review"],
      },
    ],
  },
  workflow: {
    nodes: [
      { id: "n1", name: "提交", assigneeRole: "creator" },
      { id: "n2", name: "审核", assigneeRole: "auditor" },
    ],
    transitions: [{ from: "n1", to: "n2" }],
  },
  page: {
    pages: [
      {
        id: "p-ticket",
        name: "工单页",
        fieldBindings: ["ticket.title", "ticket.amount"],
        actionPermissions: ["ticket:create"],
      },
      {
        id: "p-review",
        name: "审核页",
        fieldBindings: ["ticket.title"],
        actionPermissions: ["ticket:review"],
      },
    ],
  },
  appbundle: { pageBindings: [{ pageRef: "p-review", workflowRef: "wf" }] },
};

const schema = deriveAppRuntimeSchema(MODEL, "测试应用")!;
const script = buildTourScript(MODEL, schema)!;

describe("sanitizeTourFlavor 消毒（权威防线）", () => {
  it("幻觉实体/字段/步骤丢弃；number 强制数字化；台词截断", () => {
    const raw = {
      rows: {
        ticket: {
          title: "官网改版报价单",
          amount: "12800", // 字符串数字 → 数字
          ghost_field: "幻觉字段", // 丢弃
        },
        ghost_entity: { x: 1 }, // 丢弃
      },
      lines: {
        "0": "  今天必须把这单提上去，老板还等着看结果呢加油 ", // 截断到 24 字
        "999": "幻觉步骤", // 越界丢弃
        "-1": "负数", // 丢弃
        abc: "非数字键", // 丢弃
      },
    };
    const flavor = sanitizeTourFlavor(MODEL, script, raw)!;
    expect(flavor.rows.ticket.title).toBe("官网改版报价单");
    expect(flavor.rows.ticket.amount).toBe(12800);
    expect("ghost_field" in flavor.rows.ticket).toBe(false);
    expect("ghost_entity" in flavor.rows).toBe(false);
    expect(flavor.lines[0].length).toBeLessThanOrEqual(24);
    expect(flavor.lines[0].startsWith("今天必须")).toBe(true);
    expect(999 in flavor.lines).toBe(false);
    expect((-1) in flavor.lines).toBe(false);
  });

  it("number 字段给了非数字 → 该字段丢弃（回落确定性样例）", () => {
    const flavor = sanitizeTourFlavor(MODEL, script, {
      rows: { ticket: { amount: "看情况", title: "t" } },
    })!;
    expect("amount" in flavor.rows.ticket).toBe(false);
    expect(flavor.rows.ticket.title).toBe("t");
  });

  it("全空/不可解析 → null（fail-closed）", () => {
    expect(sanitizeTourFlavor(MODEL, script, null)).toBeNull();
    expect(sanitizeTourFlavor(MODEL, script, "not-an-object")).toBeNull();
    expect(
      sanitizeTourFlavor(MODEL, script, { rows: {}, lines: {} })
    ).toBeNull();
  });
});

describe("tour-driver flavor 注入", () => {
  it("LLM 样例覆盖建单值（缺省字段确定性兜底）；npc_line 带 llm 来源标注", async () => {
    mem.clear();
    const events: TourEvent[] = [];
    const createIndex = script.steps.findIndex(s => s.kind === "create_row");
    await runTour(script, {
      model: MODEL,
      schema,
      sessionId: "tour-flavor-1",
      onEvent: e => events.push(e),
      pause: () => Promise.resolve(),
      now: () => "2026-07-10T00:00:00.000Z",
      flavor: {
        // 只给 title——amount 必须由确定性样例兜底（LLM 不能让建单缺字段）
        valuesFor: entityId =>
          entityId === "ticket" ? { title: "官网改版报价单" } : null,
        lineFor: stepIndex => (stepIndex === createIndex ? "这单我来录" : null),
      },
    });

    const state = loadRuntimeState("tour-flavor-1")!;
    const row = state.entities.ticket[0].values as Record<string, unknown>;
    expect(row.title).toBe("官网改版报价单"); // LLM 覆盖
    expect(row.amount).toBe(1); // 确定性兜底

    const lines = events.filter(e => e.type === "npc_line");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      text: "这单我来录",
      source: "llm",
    });
    expect((lines[0] as { npcId: string }).npcId).toContain("creator");
  });

  it("不给 flavor → 无 npc_line、样例值为确定性（五期前行为不变）", async () => {
    mem.clear();
    const events: TourEvent[] = [];
    await runTour(script, {
      model: MODEL,
      schema,
      sessionId: "tour-flavor-2",
      onEvent: e => events.push(e),
      pause: () => Promise.resolve(),
      now: () => "2026-07-10T00:00:00.000Z",
    });
    expect(events.some(e => e.type === "npc_line")).toBe(false);
    const state = loadRuntimeState("tour-flavor-2")!;
    const row = state.entities.ticket[0].values as Record<string, unknown>;
    expect(String(row.title)).toContain("巡演样例");
  });
});
