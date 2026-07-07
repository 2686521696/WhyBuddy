/**
 * runtime-snapshot — 排练运行时状态 → 交付物 md 附录（浏览器运行时 M3）。
 *
 * 把用户在「运行应用 / 数据表 / 工作流试运行」里真实操作出来的数据
 * （实体行、审批实例与状态机日志、当前角色）序列化成一段 markdown，
 * 由交付导出出口附在交付包末尾——交付物固定格式不变，只多一个附录。
 *
 * 诚实边界：无任何运行时数据时返回 null（不出段、不伪造）；有数据时
 * 明示这是浏览器运行时里的排练数据，非生产数据。纯函数，便于单测。
 */

import type { FiveSystemModel } from "../system-screens/five-system-model";
import type { RuntimeState } from "./live-runtime";

export const RUNTIME_SNAPSHOT_HEADER = "## 排练运行时快照（浏览器运行时）";

function mdEscape(v: unknown): string {
  return String(v ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function deriveRuntimeSnapshotMd(
  model: FiveSystemModel | null | undefined,
  runtime: RuntimeState | null | undefined,
  role: string | null | undefined
): string | null {
  if (!runtime) return null;
  const entityRows = Object.entries(runtime.entities ?? {}).filter(
    ([, rows]) => (rows ?? []).length > 0
  );
  const instances = runtime.instances ?? [];
  if (entityRows.length === 0 && instances.length === 0) return null;

  const entityById = new Map(
    (model?.datamodel?.entities ?? []).map((e) => [e.id, e] as const)
  );
  const nodeName = (nodeId: string) =>
    (model?.workflow?.nodes ?? []).find((n) => n.id === nodeId)?.name || nodeId;

  const lines: string[] = [RUNTIME_SNAPSHOT_HEADER, ""];
  lines.push(
    "> 以下为本话题在浏览器运行时（运行应用 / 数据表 / 工作流试运行）中的排练数据，非生产数据。"
  );
  lines.push("");
  if (role) {
    lines.push(`**导出时角色视角**：${role}`);
    lines.push("");
  }

  for (const [entityId, rows] of entityRows) {
    const entity = entityById.get(entityId);
    const fields =
      entity?.fields && entity.fields.length > 0
        ? entity.fields.map((f) => ({ id: f.id, label: f.name || f.id }))
        : [...new Set(rows.flatMap((r) => Object.keys(r.values)))].map((id) => ({
            id,
            label: id,
          }));
    lines.push(`### ${entity?.name || entityId} · ${rows.length} 行`);
    lines.push("");
    lines.push(`| ${fields.map((f) => mdEscape(f.label)).join(" | ")} |`);
    lines.push(`| ${fields.map(() => "---").join(" | ")} |`);
    for (const row of rows) {
      lines.push(`| ${fields.map((f) => mdEscape(row.values[f.id]) || "—").join(" | ")} |`);
    }
    lines.push("");
  }

  if (instances.length > 0) {
    lines.push(`### 审批流程实例 · ${instances.length} 件`);
    lines.push("");
    const statusLabel: Record<string, string> = {
      running: "进行中",
      completed: "已完成",
      rejected: "已驳回",
    };
    for (const inst of instances) {
      lines.push(
        `- **${mdEscape(inst.title)}** · ${statusLabel[inst.status] ?? inst.status} · 当前节点：${mdEscape(
          nodeName(inst.currentNodeId)
        )}`
      );
      for (const log of inst.log) {
        lines.push(
          `  - ${log.action}@${mdEscape(nodeName(log.nodeId))}${log.byRole ? ` by ${mdEscape(log.byRole)}` : ""} (${log.at})`
        );
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}
