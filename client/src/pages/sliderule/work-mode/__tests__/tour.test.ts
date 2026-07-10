/**
 * Work 模式一期：剧本层（tour-script）+ 执行层（tour-driver）回归。
 *
 * 固定五系统模型：2 角色（creator 有 create 权限，auditor 只有审核权限
 * 且看不到工单页）、2 页面、2 流程节点。锁：
 *   - 剧本确定性：演员/工位/幕次结构、权限拦截来自与运行应用同源判定；
 *   - 执行真实性：runTour 后运行时状态真实变化（行落库、实例到终态）、
 *     事件流含 GameEvent 兼容词汇、报告数字与事实一致。
 */

import { describe, it, expect } from "vitest";
import type { FiveSystemModel } from "../../system-screens/five-system-model";
import { deriveAppRuntimeSchema } from "../../live-runtime/app-runtime-schema";
import { buildTourScript, CHARACTER_POOL } from "../tour-script";
import { runTour, sampleValuesFor, type TourEvent } from "../tour-driver";
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
      {
        id: "review",
        name: "审核记录",
        fields: [{ id: "note", name: "备注", type: "string" }],
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
        fieldBindings: ["review.note"],
        actionPermissions: ["ticket:review"],
      },
    ],
  },
  appbundle: {
    pageBindings: [{ pageRef: "p-review", workflowRef: "wf" }],
  },
};

const schema = deriveAppRuntimeSchema(MODEL, "测试应用")!;

describe("tour-script 剧本层（纯函数）", () => {
  it("无模型/无角色如实返回 null", () => {
    expect(buildTourScript(null, null)).toBeNull();
    expect(buildTourScript({}, null)).toBeNull();
  });

  it("演员表按角色分配已采购角色模型，工位来自 page 段", () => {
    const script = buildTourScript(MODEL, schema)!;
    expect(script.cast.map(a => a.roleId)).toEqual(["creator", "auditor"]);
    expect(script.cast[0].characterKey).toBe(CHARACTER_POOL[0]);
    expect(script.stations.map(s => s.pageId)).toEqual([
      "p-ticket",
      "p-review",
    ]);
  });

  it("幕次：建单（有 create 权限者）→ 审批链（节点 assigneeRole 出演）→ 权限拦截 → 收幕", () => {
    const script = buildTourScript(MODEL, schema)!;
    const kinds = script.steps.map(s => s.kind);
    expect(kinds.filter(k => k === "spawn")).toHaveLength(2);
    expect(kinds).toContain("create_row");
    expect(kinds).toContain("start_instance");
    expect(kinds.filter(k => k === "advance")).toHaveLength(2); // 提交 + 审核
    expect(kinds).toContain("denied_demo");
    expect(kinds.at(-1)).toBe("finale");

    // 建单人必须是真持有 create 权限的 creator（auditor 无权）
    const create = script.steps.find(s => s.kind === "create_row")!;
    expect(create.npcId).toContain("creator");
    // 审核节点由 auditor 出演
    const advances = script.steps.filter(s => s.kind === "advance");
    expect(advances[1].npcId).toContain("auditor");

    // 权限审计与运行应用同源：creator 看不到审核页、auditor 看不到工单页
    expect(script.denials).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ roleId: "creator", pageId: "p-review" }),
        expect.objectContaining({ roleId: "auditor", pageId: "p-ticket" }),
      ])
    );
  });
});

describe("tour-driver 执行层（真调运行时）", () => {
  it("巡演真实落库：行 + 实例到终态；事件流 GameEvent 兼容；报告与事实一致", async () => {
    mem.clear();
    const script = buildTourScript(MODEL, schema)!;
    const events: TourEvent[] = [];
    const report = await runTour(script, {
      model: MODEL,
      schema,
      sessionId: "tour-test-1",
      onEvent: e => events.push(e),
      pause: () => Promise.resolve(),
      now: () => "2026-07-10T00:00:00.000Z",
    });

    // 报告与真实运行时状态一致（不是演的）
    expect(report.rowsCreated).toBe(1);
    expect(report.instancesStarted).toBe(1);
    expect(report.approvals).toBe(2);
    expect(report.instanceCompleted).toBe(true);
    expect(report.denials.length).toBeGreaterThanOrEqual(2);
    expect(report.errors).toEqual([]);

    const state = loadRuntimeState("tour-test-1")!;
    expect(state.entities.ticket).toHaveLength(1);
    expect(state.instances).toHaveLength(1);
    expect(state.instances[0].status).toBe("completed");
    // 审批留痕记角色（byRole）——交付物快照同口径
    expect(state.instances[0].log.some(l => l.byRole === "auditor")).toBe(true);

    // 事件词汇表 GameEvent 兼容
    const types = new Set(events.map(e => e.type));
    for (const t of [
      "npc_spawn",
      "npc_move_to",
      "npc_anim",
      "npc_emoji",
      "npc_work_done",
      "fx",
      "progress",
      "narration",
    ]) {
      expect(types).toContain(t);
    }
  });

  it("样例值按字段类型确定性生成", () => {
    const values = sampleValuesFor(schema, "ticket");
    expect(values.amount).toBe(1);
    expect(String(values.title)).toContain("巡演样例");
  });

  it("取消：数据落库后停止 → 提前收幕但已落数据保留（诚实不回滚）", async () => {
    mem.clear();
    const script = buildTourScript(MODEL, schema)!;
    let sawCreate = false;
    const report = await runTour(script, {
      model: MODEL,
      schema,
      sessionId: "tour-test-2",
      onEvent: e => {
        if (e.type === "narration" && e.text.includes("已真实落库"))
          sawCreate = true;
      },
      pause: () => Promise.resolve(),
      isCancelled: () => sawCreate,
      now: () => "2026-07-10T00:00:00.000Z",
    });
    expect(report.stepsRun).toBeLessThan(script.steps.length);
    expect(report.rowsCreated).toBe(1);
    // 已落的行保留（诚实：真事实不回滚）
    const state = loadRuntimeState("tour-test-2")!;
    expect(state.entities.ticket).toHaveLength(1);
  });
});
