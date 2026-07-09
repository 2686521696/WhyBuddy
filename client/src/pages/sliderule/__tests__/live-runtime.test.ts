import { describe, it, expect } from "vitest";
import {
  initRuntimeState,
  addRow,
  updateRow,
  deleteRow,
  validateRowValues,
  startNodeId,
  outgoingTransitions,
  startInstance,
  advanceInstance,
} from "../live-runtime/live-runtime";
import type { FiveSystemModel } from "../system-screens/five-system-model";

const NOW = "2026-07-08T00:00:00Z";

const MODEL: FiveSystemModel = {
  datamodel: {
    entities: [
      {
        id: "expense_claim",
        name: "费用报销单",
        fields: [
          { id: "title", name: "标题", type: "string" },
          { id: "amount", name: "金额", type: "number" },
        ],
      },
    ],
  },
  rbac: {
    roles: ["employee", "manager", "finance"],
    permissions: [],
    menus: [],
  },
  workflow: {
    id: "wf_expense",
    nodes: [
      { id: "submit", name: "提交报销", assigneeRole: "employee" },
      { id: "mgr", name: "经理审批", assigneeRole: "manager" },
      { id: "fin", name: "财务打款", assigneeRole: "finance" },
      { id: "rework", name: "退回修改", assigneeRole: "employee" },
    ],
    transitions: [
      { from: "submit", to: "mgr" },
      { from: "mgr", to: "fin", condition: "金额合规" },
      { from: "mgr", to: "rework", condition: "需要修改" },
      { from: "rework", to: "mgr" },
    ],
  },
};

describe("live-runtime · 行 CRUD（动态表浏览器版）", () => {
  it("init 从模型建空实体表；addRow/updateRow/deleteRow 全程不可变", () => {
    const s0 = initRuntimeState(MODEL);
    expect(s0.entities.expense_claim).toEqual([]);

    const { state: s1, row } = addRow(
      s0,
      "expense_claim",
      { title: "打车", amount: 30 },
      NOW
    );
    expect(s1.entities.expense_claim).toHaveLength(1);
    expect(s0.entities.expense_claim).toHaveLength(0); // 不可变

    const s2 = updateRow(s1, "expense_claim", row.id, { amount: 45 });
    expect(s2.entities.expense_claim[0].values.amount).toBe(45);
    expect(s2.entities.expense_claim[0].values.title).toBe("打车"); // merge 不丢字段

    const s3 = deleteRow(s2, "expense_claim", row.id);
    expect(s3.entities.expense_claim).toHaveLength(0);
  });

  it("validateRowValues：number 字段非数字如实报错", () => {
    expect(
      validateRowValues(MODEL, "expense_claim", { amount: "abc" })
    ).toHaveLength(1);
    expect(validateRowValues(MODEL, "expense_claim", { amount: "42" })).toEqual(
      []
    );
    expect(validateRowValues(MODEL, "no_such_entity", {})).toEqual([]);
  });
});

describe("live-runtime · 审批状态机（语义对齐引擎 moveToNextNode）", () => {
  it("起点 = 无入边节点；出边查询正确", () => {
    expect(startNodeId(MODEL)).toBe("submit");
    expect(outgoingTransitions(MODEL, "mgr")).toHaveLength(2);
    expect(startNodeId({})).toBeNull();
  });

  it("单出边 approve 自动推进；无出边 approve 即 completed", () => {
    let { state, instance } = startInstance(
      initRuntimeState(MODEL),
      MODEL,
      "报销-1",
      NOW
    );
    expect(instance!.currentNodeId).toBe("submit");

    ({ state } = advanceInstance(state, MODEL, instance!.id, "approve", NOW, {
      byRole: "employee",
    }));
    expect(state.instances[0].currentNodeId).toBe("mgr");

    // mgr 有两条出边：不选分支必须报错（不静默走错路）
    const branchless = advanceInstance(
      state,
      MODEL,
      instance!.id,
      "approve",
      NOW,
      { byRole: "manager" }
    );
    expect(branchless.error).toContain("分支");

    ({ state } = advanceInstance(state, MODEL, instance!.id, "approve", NOW, {
      byRole: "manager",
      viaTransitionIndex: 0, // 金额合规 → fin
    }));
    expect(state.instances[0].currentNodeId).toBe("fin");

    ({ state } = advanceInstance(state, MODEL, instance!.id, "approve", NOW, {
      byRole: "finance",
    }));
    expect(state.instances[0].status).toBe("completed");
    expect(state.instances[0].log.map(l => l.action)).toEqual([
      "start",
      "approve",
      "approve",
      "approve",
      "complete",
    ]);
  });

  it("reject 即终态；终态实例不可再推进", () => {
    let { state, instance } = startInstance(
      initRuntimeState(MODEL),
      MODEL,
      "报销-2",
      NOW
    );
    ({ state } = advanceInstance(state, MODEL, instance!.id, "reject", NOW, {
      byRole: "employee",
    }));
    expect(state.instances[0].status).toBe("rejected");
    const after = advanceInstance(state, MODEL, instance!.id, "approve", NOW);
    expect(after.error).toContain("终态");
  });

  it("回环分支可走通（mgr → rework → mgr）", () => {
    let { state, instance } = startInstance(
      initRuntimeState(MODEL),
      MODEL,
      "报销-3",
      NOW
    );
    ({ state } = advanceInstance(state, MODEL, instance!.id, "approve", NOW)); // submit→mgr
    ({ state } = advanceInstance(state, MODEL, instance!.id, "approve", NOW, {
      viaTransitionIndex: 1,
    })); // mgr→rework
    expect(state.instances[0].currentNodeId).toBe("rework");
    ({ state } = advanceInstance(state, MODEL, instance!.id, "approve", NOW)); // rework→mgr（单出边）
    expect(state.instances[0].currentNodeId).toBe("mgr");
  });
});
