/**
 * tour-driver — Work 模式执行层：按剧本真跑浏览器运行时，emit 演出事件。
 *
 * 诚实原则的落点：每个演出事件绑定一次真实运行时动作——
 *   create_row → live-runtime addRow（数据真落库，切应用模式可见）；
 *   start_instance / advance → startInstance / advanceInstance（真流程推进）；
 *   denied_demo → 与运行应用同源的 RBAC 判定（rbac-preview 纯函数）。
 * 巡演结束 saveRuntimeState + notifyRuntimeChanged：应用/数据表实时联动。
 *
 * 事件词汇表为 GameEvent 兼容子集（npc_spawn/npc_move_to/npc_anim/
 * npc_emoji/npc_work_done/fx/progress）——演出层（three.js 舞台或未来的
 * Agentshire 器官）只订阅事件，不知道运行时存在。
 */

import type { FiveSystemModel } from "../system-screens/five-system-model";
import type { AppRuntimeSchema } from "../live-runtime/app-runtime-schema";
import {
  addRow,
  advanceInstance,
  initRuntimeState,
  startInstance,
  type RuntimeState,
} from "../live-runtime/live-runtime";
import {
  loadRuntimeState,
  notifyRuntimeChanged,
  saveRuntimeState,
} from "../live-runtime/runtime-persistence";
import type { TourScript, TourStep } from "./tour-script";
import { saveTourReport } from "./tour-report";

export type TourEvent =
  | {
      type: "npc_spawn";
      npcId: string;
      roleId: string;
      characterKey: string;
      slot: number;
    }
  | { type: "npc_move_to"; npcId: string; stationId: string }
  | { type: "npc_anim"; npcId: string; anim: string }
  | { type: "npc_emoji"; npcId: string; emoji: string | null }
  | { type: "npc_status"; npcId: string; status: string | null }
  /** LLM 生成的角色台词（五期入魂档；source 恒为 "llm"，如实标注来源） */
  | { type: "npc_line"; npcId: string; text: string; source: "llm" }
  | {
      type: "npc_work_done";
      npcId: string;
      status: "completed" | "failed";
      note?: string;
    }
  | { type: "fx"; effect: "denied" | "celebrate"; npcId?: string }
  | { type: "progress"; current: number; total: number; label: string }
  | {
      type: "narration";
      text: string;
      tone: "info" | "ok" | "blocked";
      /** 台词归属的出演者（演出层据此冒对话气泡）；finale 等全场旁白不带 */
      npcId?: string;
    };

export interface TourReport {
  rowsCreated: number;
  instancesStarted: number;
  approvals: number;
  /** 全量权限拦截（含未演出的）：来自剧本层与运行应用同源的判定 */
  denials: Array<{ roleId: string; pageId: string; deniedActions: string[] }>;
  instanceCompleted: boolean;
  stepsRun: number;
  errors: string[];
}

export interface RunTourOptions {
  model: FiveSystemModel;
  schema: AppRuntimeSchema;
  sessionId: string;
  onEvent: (event: TourEvent) => void;
  /** 步间停顿（演出节奏）；测试传 () => Promise.resolve() */
  pause?: () => Promise<void>;
  now?: () => string;
  /** 外部取消：返回 true 时提前收幕（已落的数据保留——诚实，不回滚真事实） */
  isCancelled?: () => boolean;
  /**
   * 走位到位确认（演出层提供）：walk 步等角色真站定再进下一步。
   * 不提供则不等（测试/无舞台场景）。没有它时"审批中"会打在角色
   * 半路滑行的身上，同桌多人时表现为穿身叠站（用户三轮实测的根因）。
   */
  waitForArrival?: (npcId: string) => Promise<void>;
  /**
   * LLM 入魂档（五期，默认无）：建单样例值覆盖 + 每步角色台词。
   * 值已由 tour-flavor 消毒（只含真实字段、number 已数字化）；缺省字段
   * 仍由 sampleValuesFor 兜底——LLM 只能丰富数据，不能让建单缺字段。
   */
  flavor?: {
    valuesFor?: (entityId: string) => Record<string, unknown> | null;
    lineFor?: (stepIndex: number) => string | null;
  };
}

/** 巡演样例值：按字段类型给可读的确定性值（不造假业务语义，标注来源） */
export function sampleValuesFor(
  schema: AppRuntimeSchema,
  entityId: string
): Record<string, unknown> {
  const page = schema.pages.find(p => p.entityId === entityId);
  const fields = page?.formFields?.length
    ? page.formFields
    : (page?.columns ?? []);
  const values: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.type === "number") values[f.id] = 1;
    else if (f.type === "date" || f.type === "datetime")
      values[f.id] = "2026-07-10";
    else if (f.type === "enum" && f.options?.length)
      values[f.id] = f.options[0].id;
    else values[f.id] = `巡演样例 · ${f.label}`;
  }
  return values;
}

export async function runTour(
  script: TourScript,
  opts: RunTourOptions
): Promise<TourReport> {
  const {
    model,
    schema,
    sessionId,
    onEvent,
    pause = () => new Promise(r => setTimeout(r, 900)),
    now = () => new Date().toISOString(),
    isCancelled = () => false,
    waitForArrival,
    flavor,
  } = opts;

  let state: RuntimeState =
    loadRuntimeState(sessionId) ?? initRuntimeState(model);
  const report: TourReport = {
    rowsCreated: 0,
    instancesStarted: 0,
    approvals: 0,
    denials: script.denials,
    instanceCompleted: false,
    stepsRun: 0,
    errors: [],
  };
  let activeInstanceId: string | null = null;
  let activeRowRef: { entityId: string; rowId: string } | undefined;

  const total = script.steps.length;
  let index = 0;

  const emit = onEvent;
  const narrate = (
    text: string,
    tone: "info" | "ok" | "blocked" = "info",
    npcId?: string
  ) => emit({ type: "narration", text, tone, npcId });

  const persist = () => {
    saveRuntimeState(sessionId, state);
    notifyRuntimeChanged(sessionId);
  };

  for (const step of script.steps) {
    if (isCancelled()) {
      narrate("巡演已停止（已落的数据保留）", "info");
      break;
    }
    index += 1;
    report.stepsRun += 1;
    emit({
      type: "progress",
      current: index,
      total,
      label: stepLabel(step),
    });

    switch (step.kind) {
      case "spawn": {
        const actor = script.cast.find(a => a.npcId === step.npcId);
        if (actor) {
          emit({
            type: "npc_spawn",
            npcId: actor.npcId,
            roleId: actor.roleId,
            characterKey: actor.characterKey,
            slot: script.cast.indexOf(actor),
          });
        }
        break;
      }
      case "walk": {
        narrate(step.narration, "info", step.npcId);
        emit({ type: "npc_status", npcId: step.npcId, status: "移动中" });
        emit({ type: "npc_anim", npcId: step.npcId, anim: "Walk" });
        emit({
          type: "npc_move_to",
          npcId: step.npcId,
          stationId: step.stationId,
        });
        // 等真站定再进下一步：后续的录入/审批状态只打在到位的人身上
        if (waitForArrival) {
          await settleWalk(waitForArrival(step.npcId), isCancelled);
        }
        break;
      }
      case "create_row": {
        // LLM 样例只做覆盖：确定性样例兜底保证字段齐全（fail-closed）
        const values = {
          ...sampleValuesFor(schema, step.entityId),
          ...(flavor?.valuesFor?.(step.entityId) ?? {}),
        };
        const r = addRow(state, step.entityId, values, now());
        state = r.state;
        activeRowRef = { entityId: step.entityId, rowId: r.row.id };
        report.rowsCreated += 1;
        persist();
        emit({ type: "npc_status", npcId: step.npcId, status: "录入中" });
        emit({ type: "npc_anim", npcId: step.npcId, anim: "PickUp" });
        narrate(
          `${step.narration}（row ${r.row.id} 已真实落库）`,
          "ok",
          step.npcId
        );
        break;
      }
      case "start_instance": {
        const r = startInstance(state, model, step.title, now(), activeRowRef);
        state = r.state;
        if (r.instance) {
          activeInstanceId = r.instance.id;
          report.instancesStarted += 1;
          persist();
          narrate(
            `${step.narration}（实例 ${r.instance.id} 运行中）`,
            "ok",
            step.npcId
          );
        } else {
          report.errors.push("工作流无起始节点，流程未发起");
          narrate("工作流无起始节点，流程未发起", "blocked");
        }
        break;
      }
      case "advance": {
        if (!activeInstanceId) break;
        emit({ type: "npc_status", npcId: step.npcId, status: "审批中" });
        emit({ type: "npc_anim", npcId: step.npcId, anim: "Interact" });
        const actor = script.cast.find(a => a.npcId === step.npcId);
        // 分支节点按剧本层同一约定走第一条出边（viaTransitionIndex: 0
        // 对单出边同样成立）——巡演验证主路径，分支覆盖是后续档的事
        const r = advanceInstance(
          state,
          model,
          activeInstanceId,
          "approve",
          now(),
          { byRole: actor?.roleId, viaTransitionIndex: 0 }
        );
        if (r.error) {
          report.errors.push(`节点「${step.nodeName}」推进失败：${r.error}`);
          narrate(
            `「${step.nodeName}」推进失败：${r.error}`,
            "blocked",
            step.npcId
          );
          break;
        }
        state = r.state;
        report.approvals += 1;
        persist();
        const inst = state.instances.find(i => i.id === activeInstanceId);
        if (inst?.status === "completed") {
          report.instanceCompleted = true;
          emit({
            type: "npc_work_done",
            npcId: step.npcId,
            status: "completed",
            note: step.nodeName,
          });
          narrate(
            `${step.narration} → 流程走到终态（completed）`,
            "ok",
            step.npcId
          );
        } else {
          narrate(`${step.narration} → 通过`, "ok", step.npcId);
        }
        break;
      }
      case "denied_demo": {
        emit({ type: "npc_status", npcId: step.npcId, status: "被拦截" });
        emit({ type: "npc_emoji", npcId: step.npcId, emoji: "🚫" });
        emit({ type: "fx", effect: "denied", npcId: step.npcId });
        emit({
          type: "npc_work_done",
          npcId: step.npcId,
          status: "failed",
          note: "RBAC 拦截",
        });
        narrate(step.narration, "blocked", step.npcId);
        break;
      }
      case "finale": {
        for (const actor of script.cast) {
          // 清掉拦截演示留下的 🚫（收幕清场——用户实测残留）
          emit({ type: "npc_emoji", npcId: actor.npcId, emoji: null });
          emit({ type: "npc_status", npcId: actor.npcId, status: "完成" });
          emit({ type: "npc_anim", npcId: actor.npcId, anim: "Victory" });
        }
        emit({ type: "fx", effect: "celebrate" });
        narrate(step.narration, "ok");
        break;
      }
    }
    // LLM 台词（五期）：只给有出演者的步骤配音；narration 事实记录不动
    if (flavor?.lineFor && "npcId" in step) {
      const line = flavor.lineFor(index - 1);
      if (line) {
        emit({
          type: "npc_line",
          npcId: step.npcId,
          text: line,
          source: "llm",
        });
      }
    }
    await pause();
  }

  persist();
  // 报告留档：交付物附录（最近一次巡演）从这里取——没跑过就没有段
  saveTourReport(sessionId, report, now());
  return report;
}

/**
 * 等走位到位，但不无限等：停止巡演即时打断（200ms 轮询），
 * 10s 兜底超时（对角线走位 ~9s 封顶）——演出层出错也不卡死巡演。
 */
function settleWalk(
  arrived: Promise<void>,
  isCancelled: () => boolean
): Promise<void> {
  return new Promise<void>(resolve => {
    let done = false;
    let poll: ReturnType<typeof setInterval> | null = null;
    let cap: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      if (done) return;
      done = true;
      if (poll) clearInterval(poll);
      if (cap) clearTimeout(cap);
      resolve();
    };
    poll = setInterval(() => {
      if (isCancelled()) finish();
    }, 200);
    cap = setTimeout(finish, 10000);
    void arrived.then(finish);
  });
}

function stepLabel(step: TourStep): string {
  switch (step.kind) {
    case "spawn":
      return "角色入场";
    case "walk":
      return "走位";
    case "create_row":
      return "录入数据";
    case "start_instance":
      return "发起流程";
    case "advance":
      return "流程推进";
    case "denied_demo":
      return "权限拦截";
    case "finale":
      return "收幕";
  }
}
