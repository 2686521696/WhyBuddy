/**
 * project-activity — 工程动作流：**发生了什么就显示什么**。
 *
 * ## 修的是什么（2026-09-13，用户对照 Manus 截图：「页面没跟上」第 3 件）
 *
 * 原来的 `ProjectTaskChecklist` 是一份写死的六行清单：
 *
 *     创建工程 / 写入源码 / 运行命令 / 启动预览 / 浏览器检查 / 确认交付
 *
 * 固定模板下够用，但下一步就是「模板之外的增量需求」（§27 第 3 项）。那时
 * 模型会 restore 一个旧版本、export 一份源码、连跑三次 patch——清单还是那
 * 六行，一个字都说不出来，而且**三次 patch 会被折成一行**（原实现用
 * `Map<capabilityId>`，同一工具后写覆盖先写）。
 *
 * Manus 那边是涌现式的：「编辑了 4 个文件」「修正回复发送状态的 TypeScript
 * 类型: Home.tsx」「运行 TicketStream 类型检查与生产构建」——行从真实动作
 * 长出来，跑了几次就是几行。
 *
 * ## 细节从**结构化字段**来，不从 label 里解析
 *
 * 后端 `yield {"type": "control_tool_result", "tool": name, **body}` 把整个
 * 工具返回体摊进事件，里面有 `command` / `exitCode` / `revision` /
 * `parentRevision` / `errorCode`。前端原来只读 `tool`/`ok`/`error`，其余全扔。
 *
 * ⚠ 不去解析 `label` 里的文字。本仓在「锚点窗口 / 前缀匹配」上栽过多次
 *   （见 `derive-turn-phases` 的 `phaseKeyForStep`、以及 2026-09-05 那条
 *   「往后数 900 个字符」的判据）。文案一改判据就哑，而结构化字段不会。
 *
 * ## 保住原来那三条诚实性质
 *
 *   1. 没有任何工程事件时 → 空数组，不凭空造清单
 *   2. 只有 `completed` 能算「完成」，不因为轮次存在就算
 *   3. 失败要留在台面上，不许被后续动作抹掉
 */

import type { TurnStep, UiTurn } from "./types";

export type ProjectActionStatus = "running" | "done" | "failed";

export type ProjectActionRow = {
  /** 稳定 key：取开启这一行的那个 step id。 */
  id: string;
  tool: string;
  label: string;
  /** 真实细节（命令 / 版本 / 退出码 / 错误码）。没有就没有，不编。 */
  detail?: string;
  status: ProjectActionStatus;
};

/** 人话标签。未知的 `project_*` 也要有行——正是「模板之外」要显示的东西。 */
const TOOL_LABELS: Readonly<Record<string, string>> = {
  project_create: "创建工程",
  project_patch: "写入源码",
  project_exec: "运行命令",
  project_start: "启动预览",
  project_verify: "浏览器检查",
  project_status: "查看运行状态",
  project_logs: "读取运行日志",
  project_cancel: "取消运行",
  project_read: "读取源码",
  project_revisions: "查看历史版本",
  project_restore: "恢复到历史版本",
  project_export: "导出源码",
  project_verification: "读取验收结果",
  project_delivery: "确认交付",
};

export function projectActionLabel(tool: string): string {
  return TOOL_LABELS[tool] || tool.replace(/^project_/, "");
}

function short(revision: unknown): string {
  const value = String(revision ?? "").trim();
  return value.length > 12 ? value.slice(0, 12) : value;
}

/**
 * 从**真实的工具结果字段**里取一句细节。
 *
 * 顺序即优先级：先说坏消息，再说这次具体干了什么。拿不到就返回空串——
 * 「没有细节」是一个诚实的结果，不许用 kind 之类的内部名凑数。
 */
export function projectActionDetail(
  event: Record<string, unknown> | null | undefined
): string {
  if (!event || typeof event !== "object") return "";
  const text = (key: string): string => {
    const value = event[key];
    return typeof value === "string" ? value.trim() : "";
  };
  const failure = text("error") || text("errorCode") || text("message");
  if (failure) return failure;

  const exit = event.exitCode;
  if (typeof exit === "number" && exit !== 0) return `退出码 ${exit}`;

  const command = text("command");
  if (command) return command.length > 80 ? command.slice(0, 80) + "…" : command;

  const revision = short(event.revision);
  const parent = short(event.parentRevision);
  if (revision && parent && revision !== parent) return `${parent} → ${revision}`;
  if (revision) return revision;

  return "";
}

function isProjectChip(
  step: TurnStep
): step is Extract<TurnStep, { kind: "chip" }> {
  return (
    step.kind === "chip" &&
    String((step as { capabilityId?: string }).capabilityId || "").startsWith(
      "project_"
    )
  );
}

/**
 * 把平铺的步骤配成一行一次调用。
 *
 * ⚠ **按顺序配对，不按工具名归并**。原实现用 `Map<capabilityId, status>`，
 *   连跑三次 `project_patch` 只剩一行、只留最后一次的状态——中间那次失败
 *   就这么消失了。判据 `连跑三次 patch 要有三行` 钉的就是这条。
 */
export function deriveProjectActivity(turns: UiTurn[]): ProjectActionRow[] {
  const steps = (Array.isArray(turns) ? turns : []).flatMap(
    turn => (turn && Array.isArray(turn.steps) ? turn.steps : []) as TurnStep[]
  );
  const rows: ProjectActionRow[] = [];
  for (const step of steps) {
    if (!isProjectChip(step)) continue;
    const tool = String(step.capabilityId);
    const progress = step.progressType;
    const detail = String(
      (step as { projectDetail?: string }).projectDetail || ""
    ).trim();

    if (progress === "completed" || progress === "failed") {
      // 收尾：优先合进**同一工具最近一个还开着的行**。找不到说明只剩结果
      // （刷新后从持久化恢复的典型形态），那就单独成行——有结果却不显示，
      // 就是「闸全绿但东西没了」的另一种写法。
      const open = [...rows]
        .reverse()
        .find(row => row.tool === tool && row.status === "running");
      if (open) {
        open.status = progress === "failed" ? "failed" : "done";
        if (detail) open.detail = detail;
        continue;
      }
      rows.push({
        id: step.id,
        tool,
        label: projectActionLabel(tool),
        status: progress === "failed" ? "failed" : "done",
        ...(detail ? { detail } : {}),
      });
      continue;
    }
    // acting / observing / thinking：开一行，等结果来收。
    rows.push({
      id: step.id,
      tool,
      label: projectActionLabel(tool),
      status: "running",
      ...(detail ? { detail } : {}),
    });
  }
  return rows;
}

/** 已完成的条数 / 总条数——分母是**真实发生的动作数**，不是写死的 6。 */
export function projectActivityProgress(rows: ProjectActionRow[]): {
  done: number;
  total: number;
  failed: number;
} {
  return {
    done: rows.filter(row => row.status === "done").length,
    total: rows.length,
    failed: rows.filter(row => row.status === "failed").length,
  };
}
