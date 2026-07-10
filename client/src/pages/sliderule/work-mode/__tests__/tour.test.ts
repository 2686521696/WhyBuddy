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
import { deriveTourReportMd, loadTourReport } from "../tour-report";
import { serializeSlideRuleDeliveryMd } from "../../serialize-sliderule-delivery-md";
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";

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

  it("部门分区来自 RBAC menus（真部门），工位按权限交集归属", () => {
    const script = buildTourScript(MODEL, schema)!;
    // 两个菜单 = 两个部门区：工单台、审核台
    expect(script.zones.map(z => z.label)).toEqual(["工单台", "审核台"]);
    const zoneOf = (pageId: string) =>
      script.stations.find(s => s.pageId === pageId)?.zoneId;
    expect(zoneOf("p-ticket")).toBe("zone-m1");
    expect(zoneOf("p-review")).toBe("zone-m2");
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

  it("一人一桌（Agentshire 编排）：审批在出演者自己可见页面的工位办理，不共用工作流桌", () => {
    const script = buildTourScript(MODEL, schema)!;
    const advances = script.steps.filter(s => s.kind === "advance");
    // creator 在自己的建单桌（p-ticket）办理，auditor 在自己可见的审核台（p-review）
    expect(advances[0].stationId).toBe("station-p-ticket");
    expect(advances[1].stationId).toBe("station-p-review");
    // 不同出演者不共用一张桌
    expect(new Set(advances.map(a => a.stationId)).size).toBe(2);
    // 已在自己桌上不空走：creator 全程只有建单前那一次走向 p-ticket
    const creatorWalks = script.steps.filter(
      s =>
        s.kind === "walk" &&
        s.npcId.includes("creator") &&
        s.stationId === "station-p-ticket"
    );
    expect(creatorWalks).toHaveLength(1);
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

    // 事件词汇表 GameEvent 兼容（二期含 npc_status 头顶状态）
    const types = new Set(events.map(e => e.type));
    for (const t of [
      "npc_spawn",
      "npc_move_to",
      "npc_anim",
      "npc_emoji",
      "npc_status",
      "npc_work_done",
      "fx",
      "progress",
      "narration",
    ]) {
      expect(types).toContain(t);
    }
    const statuses = events
      .filter(e => e.type === "npc_status")
      .map(e => (e as { status: string | null }).status);
    for (const s of ["移动中", "录入中", "审批中", "被拦截", "完成"]) {
      expect(statuses).toContain(s);
    }

    // 报告留档 + 交付物附录段（数字与事实一致，没跑过不出段）
    const stored = loadTourReport("tour-test-1");
    expect(stored?.rowsCreated).toBe(1);
    expect(stored?.finishedAt).toBe("2026-07-10T00:00:00.000Z");
    const md = deriveTourReportMd("tour-test-1")!;
    expect(md).toContain("## 附录 · 角色巡演报告（Work 模式）");
    expect(md).toContain("真实落库：1 行");
    expect(md).toContain("| creator | p-review |");
    expect(deriveTourReportMd("no-such-session")).toBeNull();

    // 交付物 md 组装：带 tourReportMd 才出段
    const fakeState = {
      sessionId: "tour-test-1",
      goal: { text: "测试", status: "clear" },
      artifacts: [],
      capabilityRuns: [],
      coverageGaps: [],
    } as unknown as V5SessionState;
    const delivery = serializeSlideRuleDeliveryMd(fakeState, {
      tourReportMd: md,
    });
    expect(delivery).toContain("角色巡演报告");
    const deliveryWithout = serializeSlideRuleDeliveryMd(fakeState, {});
    expect(deliveryWithout).not.toContain("角色巡演报告");
  });

  it("带分支的 workflow：按剧本约定走第一条出边，流程照样到终态（用户实测回归）", async () => {
    mem.clear();
    const branched: FiveSystemModel = {
      ...MODEL,
      workflow: {
        nodes: [
          { id: "n1", name: "提交", assigneeRole: "creator" },
          { id: "n2", name: "审核", assigneeRole: "auditor" },
          { id: "n3a", name: "归档", assigneeRole: "auditor" },
          { id: "n3b", name: "驳回返工", assigneeRole: "creator" },
        ],
        transitions: [
          { from: "n1", to: "n2" },
          { from: "n2", to: "n3a", condition: "通过" },
          { from: "n2", to: "n3b", condition: "驳回" },
        ],
      },
    };
    const bschema = deriveAppRuntimeSchema(branched, "分支应用")!;
    const script = buildTourScript(branched, bschema)!;
    const report = await runTour(script, {
      model: branched,
      schema: bschema,
      sessionId: "tour-test-branch",
      onEvent: () => {},
      pause: () => Promise.resolve(),
      now: () => "2026-07-10T00:00:00.000Z",
    });
    // 分支节点不再推进失败（曾在真实推演模型上整链卡死）
    expect(report.errors).toEqual([]);
    expect(report.instanceCompleted).toBe(true);
    // 主路径：提交 → 审核 → 归档（第一条出边）
    expect(report.approvals).toBe(3);
  });

  it("走位到位确认：每个 walk 步等 waitForArrival 兑现后才发后续事件（穿模根因回归）", async () => {
    mem.clear();
    const script = buildTourScript(MODEL, schema)!;
    const log: string[] = [];
    let pendingArrival: (() => void) | null = null;
    await runTour(script, {
      model: MODEL,
      schema,
      sessionId: "tour-test-arrival",
      onEvent: e => {
        if (e.type === "npc_move_to") log.push(`move:${e.npcId}`);
        if (e.type === "npc_status" && e.status && e.status !== "移动中")
          log.push(`work:${e.status}`);
      },
      pause: () => Promise.resolve(),
      now: () => "2026-07-10T00:00:00.000Z",
      waitForArrival: npcId => {
        log.push(`wait:${npcId}`);
        return new Promise<void>(resolve => {
          pendingArrival = resolve;
          // 模拟演出层异步到位（下一微任务兑现）
          queueMicrotask(() => {
            pendingArrival = null;
            resolve();
          });
        });
      },
    });
    // 每个 move 后紧跟同角色的 wait（先确认到位，再进下一步）
    const walkCount = script.steps.filter(s => s.kind === "walk").length;
    expect(log.filter(l => l.startsWith("wait:"))).toHaveLength(walkCount);
    for (let i = 0; i < log.length; i++) {
      if (log[i].startsWith("move:")) {
        expect(log[i + 1]).toBe(`wait:${log[i].slice("move:".length)}`);
      }
    }
    // 巡演结束时没有悬挂的到位等待
    expect(pendingArrival).toBeNull();
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
