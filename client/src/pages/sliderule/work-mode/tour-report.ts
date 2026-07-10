/**
 * tour-report — 巡演报告留档（localStorage）+ 交付物附录 MD 投影。
 *
 * 诚实口径：报告数字全部来自执行层的真实运行时动作计数（落库行数/
 * 实例/审批步）与同源 RBAC 判定；没跑过巡演就没有段（不出空壳附录）。
 */

import type { TourReport } from "./tour-driver";

const KEY_PREFIX = "sliderule:tour-report:";

export interface StoredTourReport extends TourReport {
  finishedAt: string;
}

export function saveTourReport(
  sessionId: string,
  report: TourReport,
  finishedAt: string
): void {
  try {
    localStorage.setItem(
      `${KEY_PREFIX}${sessionId}`,
      JSON.stringify({ ...report, finishedAt } satisfies StoredTourReport)
    );
  } catch {
    /* 存储不可用 → 本次不留档（不影响巡演本身） */
  }
}

export function loadTourReport(sessionId: string): StoredTourReport | null {
  try {
    const raw = localStorage.getItem(`${KEY_PREFIX}${sessionId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredTourReport;
    if (typeof parsed?.stepsRun !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 交付物附录段：最近一次角色巡演报告（无留档返回 null，不出段）。 */
export function deriveTourReportMd(sessionId: string): string | null {
  const report = loadTourReport(sessionId);
  if (!report) return null;
  const lines: string[] = [];
  lines.push("## 附录 · 角色巡演报告（Work 模式）");
  lines.push("");
  lines.push(
    "> 各业务角色按 workflow 链路自动试跑本系统的真实记录：数据真实落库、"
  );
  lines.push("> 流程真实推进、权限拦截与运行应用同一判定函数。");
  lines.push("");
  lines.push(`- 巡演完成时间：${report.finishedAt}`);
  lines.push(`- 执行步数：${report.stepsRun}`);
  lines.push(
    `- 真实落库：${report.rowsCreated} 行 · 流程实例 ${report.instancesStarted} 个 · 审批通过 ${report.approvals} 步`
  );
  lines.push(
    `- 流程终态：${report.instanceCompleted ? "已走到 completed" : "未到终态"}`
  );
  if (report.errors.length > 0) {
    lines.push(`- 异常：${report.errors.join("；")}`);
  }
  lines.push("");
  lines.push(`### RBAC 拦截审计（${report.denials.length} 处）`);
  lines.push("");
  if (report.denials.length === 0) {
    lines.push("（无拦截——所有角色对所有页面均有权限，请复核是否符合预期）");
  } else {
    lines.push("| 角色 | 无权页面 | 缺失动作 |");
    lines.push("|---|---|---|");
    for (const d of report.denials) {
      lines.push(
        `| ${d.roleId} | ${d.pageId} | ${d.deniedActions.join(", ") || "—"} |`
      );
    }
  }
  return lines.join("\n");
}
