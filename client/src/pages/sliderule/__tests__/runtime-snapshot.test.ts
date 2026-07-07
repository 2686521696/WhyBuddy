import { describe, it, expect } from "vitest";

// node 测试环境无 localStorage：给 runtime-persistence 一个内存 shim
const _store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => _store.get(k) ?? null,
  setItem: (k: string, v: string) => void _store.set(k, v),
  removeItem: (k: string) => void _store.delete(k),
};
import {
  deriveRuntimeSnapshotMd,
  RUNTIME_SNAPSHOT_HEADER,
} from "../live-runtime/runtime-snapshot";
import {
  assembleRuntimeSnapshotMdForState,
  serializeSlideRuleDeliveryMd,
} from "../serialize-sliderule-delivery-md";
import { saveRuntimeState, saveRuntimeRole } from "../live-runtime/runtime-persistence";
import type { RuntimeState } from "../live-runtime/live-runtime";
import type { FiveSystemModel } from "../system-screens/five-system-model";

const MODEL: FiveSystemModel = {
  datamodel: {
    entities: [
      {
        id: "plot",
        name: "地块",
        fields: [
          { id: "code", name: "地块编号", type: "string" },
          { id: "area", name: "面积", type: "number" },
        ],
      },
    ],
  },
  workflow: {
    nodes: [
      { id: "submit", name: "提交申请" },
      { id: "review", name: "经理审核" },
    ],
    transitions: [{ from: "submit", to: "review" }],
  },
};

const RUNTIME: RuntimeState = {
  entities: {
    plot: [
      { id: "row-1", values: { code: "A-01", area: 20 }, createdAt: "2026-07-07T00:00:00Z" },
    ],
  },
  instances: [
    {
      id: "inst-2",
      title: "市场页 · A-01",
      currentNodeId: "review",
      status: "running",
      log: [
        { at: "t1", nodeId: "submit", action: "start" },
        { at: "t2", nodeId: "submit", action: "approve", byRole: "adopter" },
      ],
    },
  ],
  seq: 2,
};

describe("runtime-snapshot（交付物运行时快照附录）", () => {
  it("无运行时数据 → null（不出段、不伪造）", () => {
    expect(deriveRuntimeSnapshotMd(MODEL, null, "adopter")).toBeNull();
    expect(
      deriveRuntimeSnapshotMd(MODEL, { entities: { plot: [] }, instances: [], seq: 0 }, null)
    ).toBeNull();
  });

  it("实体行渲染成 md 表（字段名来自模型），实例带状态机日志与节点名", () => {
    const md = deriveRuntimeSnapshotMd(MODEL, RUNTIME, "adopter")!;
    expect(md).toContain(RUNTIME_SNAPSHOT_HEADER);
    expect(md).toContain("非生产数据");
    expect(md).toContain("**导出时角色视角**：adopter");
    expect(md).toContain("### 地块 · 1 行");
    expect(md).toContain("| 地块编号 | 面积 |");
    expect(md).toContain("| A-01 | 20 |");
    expect(md).toContain("### 审批流程实例 · 1 件");
    expect(md).toContain("**市场页 · A-01** · 进行中 · 当前节点：经理审核");
    expect(md).toContain("approve@提交申请 by adopter");
  });

  it("模型缺字段定义时回退行键名；竖线转义防表格串列", () => {
    const runtime: RuntimeState = {
      entities: { ghost: [{ id: "r", values: { raw: "a|b" }, createdAt: "t" }] },
      instances: [],
      seq: 1,
    };
    const md = deriveRuntimeSnapshotMd({}, runtime, null)!;
    expect(md).toContain("### ghost · 1 行");
    expect(md).toContain("| raw |");
    expect(md).toContain("a\\|b");
  });

  it("assembleRuntimeSnapshotMdForState 从 localStorage 装配（导出出口的真实路径）", () => {
    const sessionId = "snap-export-t1";
    saveRuntimeState(sessionId, RUNTIME);
    saveRuntimeRole(sessionId, "adopter");
    const md = assembleRuntimeSnapshotMdForState({ sessionId } as any)!;
    expect(md).toContain(RUNTIME_SNAPSHOT_HEADER);
    expect(md).toContain("**导出时角色视角**：adopter");
    expect(md).toContain("A-01"); // 行值来自 localStorage（模型缺省时回退键名列）
    // 无 sessionId / 无数据 → null
    expect(assembleRuntimeSnapshotMdForState({} as any)).toBeNull();
    expect(assembleRuntimeSnapshotMdForState({ sessionId: "never-touched" } as any)).toBeNull();
  });

  it("serializeSlideRuleDeliveryMd 注入 opts 才出段，缺省逐字节不变", () => {
    const state = { sessionId: "s1", artifacts: [] } as any;
    const base = serializeSlideRuleDeliveryMd(state);
    expect(base).not.toContain(RUNTIME_SNAPSHOT_HEADER);
    expect(serializeSlideRuleDeliveryMd(state, {})).toBe(base);

    const snapshot = deriveRuntimeSnapshotMd(MODEL, RUNTIME, "adopter");
    const withSnap = serializeSlideRuleDeliveryMd(state, { runtimeSnapshotMd: snapshot });
    expect(withSnap).toContain(RUNTIME_SNAPSHOT_HEADER);
    expect(withSnap).toContain("| A-01 | 20 |");
    // 附录插在审计明细之前
    expect(withSnap.indexOf(RUNTIME_SNAPSHOT_HEADER)).toBeLessThan(
      withSnap.indexOf("## 审计明细")
    );
  });
});
