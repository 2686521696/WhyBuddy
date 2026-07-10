/**
 * tour-flavor — Work 模式五期「LLM 入魂档」：角色台词 + 建单样例值。
 *
 * 走既有 Python 真通道（/api/sliderule/tour-flavor，与 /prompt-refine 同一
 * 诚实契约）。**fail-closed**：通道关闭、请求失败、超时、返回不可解析——
 * 一律返回 null，巡演回落 sampleValuesFor 的确定性样例并如实标注，
 * 绝不装作 LLM 参与过。
 *
 * 消毒是权威防线（LLM 输出要落进真运行时）：
 * - rows 只保留 model 里真实存在的实体/字段；number 字段强制数字化
 *   （非数字丢弃回落确定性值）；字符串截断防溢出；
 * - lines 只保留合法步骤 index，截断到 24 字。
 */

import type { FiveSystemModel } from "../system-screens/five-system-model";
import type { TourScript } from "./tour-script";

export interface TourFlavor {
  /** entityId → { fieldId: 值 }（已消毒，可直接并入建单 values） */
  rows: Record<string, Record<string, unknown>>;
  /** 步骤 index（0 起）→ 角色台词（已消毒） */
  lines: Record<number, string>;
}

const LINE_MAX = 24;
const STRING_MAX = 40;

/** 从 LLM 原始输出消毒出可安全落库/上台的 flavor（纯函数，可测） */
export function sanitizeTourFlavor(
  model: FiveSystemModel,
  script: TourScript,
  raw: unknown
): TourFlavor | null {
  if (!raw || typeof raw !== "object") return null;
  const rawRows = (raw as { rows?: unknown }).rows;
  const rawLines = (raw as { lines?: unknown }).lines;

  const fieldTypeByEntity = new Map<string, Map<string, string>>();
  for (const entity of model.datamodel?.entities ?? []) {
    const fields = new Map<string, string>();
    for (const f of entity.fields ?? []) fields.set(f.id, f.type ?? "string");
    fieldTypeByEntity.set(entity.id, fields);
  }

  const rows: TourFlavor["rows"] = {};
  if (rawRows && typeof rawRows === "object") {
    for (const [entityId, values] of Object.entries(
      rawRows as Record<string, unknown>
    )) {
      const fields = fieldTypeByEntity.get(entityId);
      if (!fields || !values || typeof values !== "object") continue;
      const clean: Record<string, unknown> = {};
      for (const [fieldId, value] of Object.entries(
        values as Record<string, unknown>
      )) {
        const type = fields.get(fieldId);
        if (type === undefined) continue; // 幻觉字段丢弃
        if (type === "number") {
          const n = Number(value);
          if (Number.isFinite(n)) clean[fieldId] = n;
          // 非数字丢弃 → 该字段回落确定性样例
        } else if (typeof value === "string" || typeof value === "number") {
          clean[fieldId] = String(value).slice(0, STRING_MAX);
        }
      }
      if (Object.keys(clean).length > 0) rows[entityId] = clean;
    }
  }

  const lines: TourFlavor["lines"] = {};
  if (rawLines && typeof rawLines === "object") {
    for (const [key, value] of Object.entries(
      rawLines as Record<string, unknown>
    )) {
      const index = Number(key);
      if (!Number.isInteger(index)) continue;
      if (index < 0 || index >= script.steps.length) continue; // 幻觉步骤丢弃
      const text = typeof value === "string" ? value.trim() : "";
      if (text) lines[index] = text.slice(0, LINE_MAX);
    }
  }

  if (Object.keys(rows).length === 0 && Object.keys(lines).length === 0)
    return null;
  return { rows, lines };
}

/** 请求 LLM 台词/样例；任何失败返回 null（fail-closed，回落确定性样例） */
export async function fetchTourFlavor(
  model: FiveSystemModel,
  script: TourScript,
  appTitle: string,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<TourFlavor | null> {
  const { timeoutMs = 15000, fetchImpl = fetch } = opts;

  // 只送建单涉及的实体（create_row 步骤的 entityId）
  const creationEntityIds = new Set(
    script.steps.flatMap(s => (s.kind === "create_row" ? [s.entityId] : []))
  );
  const entities = (model.datamodel?.entities ?? [])
    .filter(e => creationEntityIds.has(e.id))
    .map(e => ({
      id: e.id,
      name: e.name,
      fields: (e.fields ?? []).map(f => ({
        id: f.id,
        name: f.name,
        type: f.type ?? "string",
      })),
    }));

  const roleOf = (npcId: string | undefined) =>
    script.cast.find(a => a.npcId === npcId)?.roleId ?? "";
  const steps = script.steps.map((step, index) => ({
    index,
    kind: step.kind,
    role: "npcId" in step ? roleOf(step.npcId) : "",
    target:
      step.kind === "advance"
        ? step.nodeName
        : "stationId" in step
          ? step.stationId
          : "",
  }));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl("/api/sliderule/tour-flavor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appTitle, entities, steps }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      ok?: boolean;
      rows?: unknown;
      lines?: unknown;
    };
    if (!body?.ok) return null;
    return sanitizeTourFlavor(model, script, body);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
