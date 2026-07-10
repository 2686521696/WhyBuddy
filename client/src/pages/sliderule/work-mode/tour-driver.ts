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
  | {
      type: "npc_work_done";
      npcId: string;
      status: "completed" | "failed";
      note?: string;
    }
  | { type: "fx"; effect: "denied" | "celebrate"; npcId?: string }
  | { type: "progress"; current: number; total: number; label: string }
  | { type: "narration"; text: string; tone: "info" | "ok" | "blocked" };

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
  const narrate = (text: string, tone: "info" | "ok" | "blocked" = "info") =>
    emit({ type: "narration", text, tone });

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
        narrate(step.narration);
        emit({ type: "npc_anim", npcId: step.npcId, anim: "Walk" });
        emit({
          type: "npc_move_to",
          npcId: step.npcId,
          stationId: step.stationId,
        });
        break;
      }
      case "create_row": {
        const values = sampleValuesFor(schema, step.entityId);
        const r = addRow(state, step.entityId, values, now());
        state = r.state;
        activeRowRef = { entityId: step.entityId, rowId: r.row.id };
        report.rowsCreated += 1;
        persist();
        emit({ type: "npc_anim", npcId: step.npcId, anim: "PickUp" });
        narrate(`${step.narration}（row ${r.row.id} 已真实落库）`, "ok");
        break;
      }
      case "start_instance": {
        const r = startInstance(state, model, step.title, now(), activeRowRef);
        state = r.state;
        if (r.instance) {
          activeInstanceId = r.instance.id;
          report.instancesStarted += 1;
          persist();
          narrate(`${step.narration}（实例 ${r.instance.id} 运行中）`, "ok");
        } else {
          report.errors.push("工作流无起始节点，流程未发起");
          narrate("工作流无起始节点，流程未发起", "blocked");
        }
        break;
      }
      case "advance": {
        if (!activeInstanceId) break;
        emit({ type: "npc_anim", npcId: step.npcId, anim: "Interact" });
        const actor = script.cast.find(a => a.npcId === step.npcId);
        const r = advanceInstance(
          state,
          model,
          activeInstanceId,
          "approve",
          now(),
          { byRole: actor?.roleId }
        );
        if (r.error) {
          report.errors.push(`节点「${step.nodeName}」推进失败：${r.error}`);
          narrate(`「${step.nodeName}」推进失败：${r.error}`, "blocked");
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
          narrate(`${step.narration} → 流程走到终态（completed）`, "ok");
        } else {
          narrate(`${step.narration} → 通过`, "ok");
        }
        break;
      }
      case "denied_demo": {
        emit({ type: "npc_emoji", npcId: step.npcId, emoji: "🚫" });
        emit({ type: "fx", effect: "denied", npcId: step.npcId });
        emit({
          type: "npc_work_done",
          npcId: step.npcId,
          status: "failed",
          note: "RBAC 拦截",
        });
        narrate(step.narration, "blocked");
        break;
      }
      case "finale": {
        for (const actor of script.cast) {
          emit({ type: "npc_anim", npcId: actor.npcId, anim: "Victory" });
        }
        emit({ type: "fx", effect: "celebrate" });
        narrate(step.narration, "ok");
        break;
      }
    }
    await pause();
  }

  persist();
  return report;
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
