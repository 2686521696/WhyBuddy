/**
 * MainlineWorkbench — SlideRule 主线观察台（/agent-loop/workbench）。
 *
 * 观察黄金路径的真实状态，全部接真数据、fail-closed：
 *   服务健康   — node /api/health · python /api/agent-loop/health ·
 *                LLM 推演通道 /api/sliderule/llm-channel
 *   话题会话   — python GET /api/sliderule/sessions（话题/阶段/产物数）
 *   运行时数据 — 本机 localStorage 各话题排练数据量（行/实例）
 *   质量基线   — python GET /api/sliderule/eval-baseline（五域评测摘要）
 *
 * legacy 任务队列驾驶舱迁至 /agent-loop/workbench/legacy（摘导航留 URL）。
 * 纯数据推导拆成可单测的纯函数；接口失败如实显示"不可用"，不摆假数据。
 */

import React from "react";

// ---------------------------------------------------------------------------
// 纯函数（可单测）
// ---------------------------------------------------------------------------

export interface RuntimeStoreSummary {
  sessionId: string;
  rows: number;
  instances: number;
}

const RUNTIME_KEY_PREFIX = "sliderule:live-runtime:";

/** 扫描 localStorage 里各话题的排练数据量（损坏项跳过，不抛错）。 */
export function summarizeRuntimeStores(storage: {
  length: number;
  key(i: number): string | null;
  getItem(k: string): string | null;
}): RuntimeStoreSummary[] {
  const out: RuntimeStoreSummary[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key || !key.startsWith(RUNTIME_KEY_PREFIX)) continue;
    try {
      const parsed = JSON.parse(storage.getItem(key) ?? "");
      if (!parsed || typeof parsed !== "object") continue;
      const rows = Object.values(parsed.entities ?? {}).reduce(
        (n: number, list) => n + (Array.isArray(list) ? list.length : 0),
        0
      );
      const instances = Array.isArray(parsed.instances) ? parsed.instances.length : 0;
      out.push({ sessionId: key.slice(RUNTIME_KEY_PREFIX.length), rows, instances });
    } catch {
      /* 损坏项跳过 */
    }
  }
  return out.sort((a, b) => b.rows + b.instances - (a.rows + a.instances));
}

export interface BaselineSummary {
  generatedAt: string;
  model: string;
  domains: number;
  gatePassed: number;
  contentFails: number;
  contentWarns: number;
  judgeAvg: number | null;
}

/** 五域评测基线 JSON → 摘要卡数据；形状不符返回 null（不猜）。 */
export function summarizeBaseline(payload: unknown): BaselineSummary | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const domains = Array.isArray(p.domains) ? (p.domains as Array<Record<string, unknown>>) : null;
  if (!domains || domains.length === 0) return null;
  let gatePassed = 0;
  let contentFails = 0;
  let contentWarns = 0;
  const judgeAvgs: number[] = [];
  for (const d of domains) {
    if (d.gate_passed) gatePassed++;
    const content = (d.content ?? {}) as Record<string, unknown>;
    contentFails += Number(content.hardFailCount) || 0;
    const findings = Array.isArray(content.findings) ? content.findings : [];
    contentWarns += findings.filter(
      (f) => f && typeof f === "object" && (f as Record<string, unknown>).severity === "warn"
    ).length;
    const judge = d.judge as Record<string, unknown> | null | undefined;
    const avg = judge ? Number(judge.avg) : NaN;
    if (Number.isFinite(avg)) judgeAvgs.push(avg);
  }
  return {
    generatedAt: String(p.generatedAt ?? ""),
    model: String(p.model ?? ""),
    domains: domains.length,
    gatePassed,
    contentFails,
    contentWarns,
    judgeAvg:
      judgeAvgs.length > 0
        ? Math.round((judgeAvgs.reduce((a, b) => a + b, 0) / judgeAvgs.length) * 100) / 100
        : null,
  };
}

export const SESSION_PHASE_LABEL: Record<string, { label: string; tone: "ok" | "busy" | "idle" }> = {
  done: { label: "已闭环", tone: "ok" },
  awaiting: { label: "待介入", tone: "busy" },
  running: { label: "推演中", tone: "busy" },
  idle: { label: "就绪", tone: "idle" },
};

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

interface SessionRow {
  sessionId: string;
  goal: string;
  phase: string;
  artifactCount: number;
  lastActive: string | null;
}

type Fetched<T> = { kind: "loading" } | { kind: "ok"; data: T } | { kind: "error"; detail: string };

async function fetchJson<T>(url: string): Promise<Fetched<T>> {
  try {
    const res = await fetch(url);
    if (!res.ok) return { kind: "error", detail: `HTTP ${res.status}` };
    return { kind: "ok", data: (await res.json()) as T };
  } catch (e) {
    return { kind: "error", detail: String(e) };
  }
}

function HealthChip({
  label,
  state,
  detail,
}: {
  label: string;
  state: "ok" | "down" | "loading";
  detail?: string;
}) {
  const tone =
    state === "ok"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : state === "down"
        ? "bg-red-50 text-red-600 ring-red-200"
        : "bg-[#eef0f4] text-stone-400 ring-[#e5e7eb]";
  return (
    <div className={`flex items-center gap-2 rounded-xl px-4 py-3 ring-1 ${tone}`} data-testid={`wb-health-${label}`}>
      <span
        className={`h-2 w-2 rounded-full ${state === "ok" ? "bg-emerald-500" : state === "down" ? "bg-red-500" : "bg-stone-300 animate-pulse"}`}
      />
      <span className="text-[13px] font-semibold">{label}</span>
      {detail && <span className="ml-auto truncate font-mono text-[11px] opacity-80">{detail}</span>}
    </div>
  );
}

function SectionCard({
  title,
  extra,
  children,
}: {
  title: string;
  extra?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[#e5e7eb] bg-white p-4 shadow-[0_1px_3px_rgb(90_80_60/0.06)]">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[13px] font-bold text-stone-700">{title}</h3>
        {extra}
      </div>
      {children}
    </section>
  );
}

export function MainlineWorkbench() {
  const [nodeHealth, setNodeHealth] = React.useState<Fetched<unknown>>({ kind: "loading" });
  const [pyHealth, setPyHealth] = React.useState<Fetched<unknown>>({ kind: "loading" });
  const [channel, setChannel] = React.useState<
    Fetched<{ provider: string; model: string; keyPresent: boolean; keyMasked: string }>
  >({ kind: "loading" });
  const [sessions, setSessions] = React.useState<Fetched<{ sessions: SessionRow[] }>>({ kind: "loading" });
  const [baseline, setBaseline] = React.useState<Fetched<unknown>>({ kind: "loading" });
  const [runtimeStores, setRuntimeStores] = React.useState<RuntimeStoreSummary[]>([]);

  const refresh = React.useCallback(() => {
    void fetchJson("/api/health").then(setNodeHealth);
    void fetchJson("/api/agent-loop/health").then(setPyHealth);
    void fetchJson<{ provider: string; model: string; keyPresent: boolean; keyMasked: string }>(
      "/api/sliderule/llm-channel"
    ).then(setChannel);
    void fetchJson<{ sessions: SessionRow[] }>("/api/sliderule/sessions").then(setSessions);
    void fetchJson("/api/sliderule/eval-baseline").then(setBaseline);
    try {
      setRuntimeStores(summarizeRuntimeStores(window.localStorage));
    } catch {
      setRuntimeStores([]);
    }
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const healthState = (f: Fetched<unknown>): "ok" | "down" | "loading" =>
    f.kind === "loading" ? "loading" : f.kind === "ok" ? "ok" : "down";

  const sessionRows: SessionRow[] =
    sessions.kind === "ok"
      ? [...sessions.data.sessions]
          .sort((a, b) => String(b.lastActive ?? "").localeCompare(String(a.lastActive ?? "")))
          .slice(0, 10)
      : [];
  const baselineSummary = baseline.kind === "ok" ? summarizeBaseline(baseline.data) : null;

  return (
    <div className="mx-auto max-w-[1200px] space-y-4 p-5" data-testid="mainline-workbench">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-[19px] font-bold text-stone-800">主线观察台</h2>
          <p className="mt-0.5 text-[12px] text-stone-400">
            黄金路径的运行状态：服务 · 推演通道 · 话题会话 · 排练数据 · 生成质量基线
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          data-testid="wb-refresh"
          className="rounded-full border border-[#e5e7eb] bg-white px-4 py-1.5 text-[12px] font-semibold text-stone-600 transition hover:bg-[#eef0f4]"
        >
          ↻ 刷新
        </button>
      </div>

      {/* 服务健康 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <HealthChip label="Node API" state={healthState(nodeHealth)} detail=":3001" />
        <HealthChip label="Python 推演引擎" state={healthState(pyHealth)} detail=":9700" />
        <HealthChip
          label="LLM 推演通道"
          state={channel.kind === "loading" ? "loading" : channel.kind === "ok" && channel.data.keyPresent ? "ok" : "down"}
          detail={channel.kind === "ok" ? `${channel.data.provider} · ${channel.data.model}` : channel.kind === "error" ? "不可用" : undefined}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        {/* 话题会话 */}
        <div className="lg:col-span-3">
          <SectionCard
            title="话题会话（Python 会话库）"
            extra={
              sessions.kind === "ok" ? (
                <span className="text-[11px] text-stone-400">共 {sessions.data.sessions.length} 个 · 显示最近 10</span>
              ) : undefined
            }
          >
            {sessions.kind === "loading" && <div className="h-24 animate-pulse rounded-lg bg-[#eef0f4]" />}
            {sessions.kind === "error" && (
              <div className="rounded-lg bg-red-50/60 px-3 py-2 text-[12px] text-red-600 ring-1 ring-red-200">
                会话列表不可用：{sessions.detail}（python 服务未启动时如实显示，不摆假数据）
              </div>
            )}
            {sessions.kind === "ok" && (
              <table className="w-full text-[12px]" data-testid="wb-sessions">
                <thead>
                  <tr className="border-b border-[#e9edf2] text-left text-[11px] text-stone-400">
                    <th className="pb-1.5 font-medium">话题</th>
                    <th className="pb-1.5 font-medium">阶段</th>
                    <th className="pb-1.5 font-medium">产物</th>
                    <th className="pb-1.5 font-medium">最近活跃</th>
                  </tr>
                </thead>
                <tbody>
                  {sessionRows.map((s) => {
                    const meta = SESSION_PHASE_LABEL[s.phase] ?? { label: s.phase, tone: "idle" as const };
                    return (
                      <tr key={s.sessionId} className="border-b border-[#f8f9fb] last:border-0">
                        <td className="max-w-[280px] truncate py-1.5 pr-3 text-stone-700" title={s.goal || s.sessionId}>
                          {s.goal || s.sessionId}
                        </td>
                        <td className="py-1.5 pr-3">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                              meta.tone === "ok"
                                ? "bg-emerald-50 text-emerald-700"
                                : meta.tone === "busy"
                                  ? "bg-amber-50 text-amber-700"
                                  : "bg-[#eef0f4] text-stone-500"
                            }`}
                          >
                            {meta.label}
                          </span>
                        </td>
                        <td className="py-1.5 pr-3 font-mono text-stone-500">{s.artifactCount}</td>
                        <td className="py-1.5 font-mono text-[11px] text-stone-400">
                          {s.lastActive ? String(s.lastActive).slice(0, 19).replace("T", " ") : "—"}
                        </td>
                      </tr>
                    );
                  })}
                  {sessionRows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-4 text-center text-stone-300">
                        暂无会话——去「推演」发一句意图
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </SectionCard>
        </div>

        <div className="space-y-4 lg:col-span-2">
          {/* 质量基线 */}
          <SectionCard title="生成质量基线（五域评测）">
            {baseline.kind === "loading" && <div className="h-20 animate-pulse rounded-lg bg-[#eef0f4]" />}
            {baseline.kind === "error" && (
              <div className="text-[12px] text-stone-400">
                基线不可用（未生成或 python 未启动）。用
                <code className="mx-1 rounded bg-[#eef0f4] px-1 font-mono text-[11px]">
                  eval_five_system_generation.py --judge --json-out
                </code>
                固化。
              </div>
            )}
            {baseline.kind === "ok" && baselineSummary && (
              <div data-testid="wb-baseline">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-[#f8f9fb] px-2 py-2.5">
                    <div className="text-[17px] font-bold text-stone-800">
                      {baselineSummary.gatePassed}/{baselineSummary.domains}
                    </div>
                    <div className="text-[10px] text-stone-400">结构门通过</div>
                  </div>
                  <div className="rounded-lg bg-[#f8f9fb] px-2 py-2.5">
                    <div className={`text-[17px] font-bold ${baselineSummary.contentFails ? "text-red-600" : "text-stone-800"}`}>
                      {baselineSummary.contentFails} / {baselineSummary.contentWarns}
                    </div>
                    <div className="text-[10px] text-stone-400">内容门 fail/warn</div>
                  </div>
                  <div className="rounded-lg bg-[#f8f9fb] px-2 py-2.5">
                    <div className="text-[17px] font-bold text-stone-800">{baselineSummary.judgeAvg ?? "—"}</div>
                    <div className="text-[10px] text-stone-400">LLM 评审均分</div>
                  </div>
                </div>
                <div className="mt-2 text-[10px] text-stone-400">
                  {baselineSummary.generatedAt} · 模型 {baselineSummary.model}
                </div>
              </div>
            )}
          </SectionCard>

          {/* 运行时数据概览 */}
          <SectionCard title="排练数据（本机浏览器）">
            {runtimeStores.length === 0 ? (
              <div className="text-[12px] text-stone-300">暂无排练数据——运行应用里建行/走流程后出现</div>
            ) : (
              <ul className="space-y-1.5" data-testid="wb-runtime-stores">
                {runtimeStores.slice(0, 6).map((s) => (
                  <li key={s.sessionId} className="flex items-center justify-between text-[12px]">
                    <span className="max-w-[200px] truncate font-mono text-stone-500" title={s.sessionId}>
                      {s.sessionId}
                    </span>
                    <span className="text-stone-600">
                      {s.rows} 行 · {s.instances} 实例
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      </div>

      <div className="text-center text-[10px] text-stone-300">
        legacy 任务队列驾驶舱仍可直达 <code className="font-mono">/agent-loop/workbench/legacy</code>
      </div>
    </div>
  );
}
