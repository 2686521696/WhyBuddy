import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowLeft,
  Bot,
  CheckCircle2,
  Clock3,
  ExternalLink,
  RefreshCw,
  Rows3,
  Server,
  TriangleAlert,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type AgentLoopHealth = {
  status?: string;
  backend?: string;
  mode?: string;
  version?: string;
};

type AgentLoopRunSummary = {
  runId: string;
  status?: string | null;
  task?: string | null;
  runMode?: string | null;
  iterations?: number | null;
  fixAgent?: string | null;
  reviewAgent?: string | null;
  runTimeLocal?: string | null;
  runTimeUtc?: string | null;
  metadata?: Record<string, unknown>;
};

type LoadState = "idle" | "loading" | "ready" | "error";

const RUNS_ENDPOINT = "/api/agent-loop/runs/overview";
const HEALTH_ENDPOINT = "/api/agent-loop/health";

function isDoneStatus(status?: string | null) {
  const s = String(status || "").toUpperCase();
  return s.startsWith("DONE");
}

function isAttentionStatus(status?: string | null) {
  const s = String(status || "").toUpperCase();
  return (
    s.startsWith("HALT") ||
    s.includes("FAILED") ||
    s.includes("CONFLICT") ||
    s === "DEGRADED"
  );
}

function statusTone(status?: string | null) {
  if (isDoneStatus(status)) return "success";
  if (isAttentionStatus(status)) return "danger";
  if (String(status || "").toUpperCase().includes("REVIEW")) return "warning";
  return "info";
}

function compactTaskName(task?: string | null) {
  if (!task) return "未绑定任务";
  const parts = task.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || task;
}

function formatAgentPair(run: AgentLoopRunSummary) {
  const fix = run.fixAgent || "worker";
  const review = run.reviewAgent || "none";
  return `${fix} / ${review}`;
}

function MetricCard({
  label,
  value,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  icon: typeof Activity;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  const toneClass = {
    neutral: "border-slate-200 bg-white text-slate-700",
    success: "border-emerald-100 bg-emerald-50/70 text-emerald-700",
    warning: "border-amber-100 bg-amber-50/70 text-amber-700",
    danger: "border-rose-100 bg-rose-50/70 text-rose-700",
  }[tone];

  return (
    <div className={cn("rounded-lg border p-4 shadow-sm", toneClass)}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            {label}
          </div>
          <div className="mt-2 font-data text-2xl font-black text-slate-950">
            {value}
          </div>
        </div>
        <span className="flex size-10 items-center justify-center rounded-lg bg-white/80 shadow-sm">
          <Icon className="size-5" />
        </span>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status?: string | null }) {
  const tone = statusTone(status);
  const className =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone === "danger"
        ? "border-rose-200 bg-rose-50 text-rose-700"
        : tone === "warning"
          ? "border-amber-200 bg-amber-50 text-amber-700"
          : "border-sky-200 bg-sky-50 text-sky-700";

  return (
    <Badge variant="outline" className={className}>
      {status || "UNKNOWN"}
    </Badge>
  );
}

function RunsTable({
  runs,
  selectedRunId,
  onSelect,
}: {
  runs: AgentLoopRunSummary[];
  selectedRunId: string | null;
  onSelect: (run: AgentLoopRunSummary) => void;
}) {
  return (
    <div
      className="overflow-hidden rounded-lg border border-slate-200 bg-white"
      data-testid="agent-loop-runs"
    >
      <table className="workspace-data-table w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-[0.08em]">
          <tr>
            <th className="px-4 py-3">任务</th>
            <th className="px-4 py-3">状态</th>
            <th className="px-4 py-3">Agent</th>
            <th className="px-4 py-3">迭代</th>
            <th className="px-4 py-3">最后更新</th>
          </tr>
        </thead>
        <tbody>
          {runs.length === 0 ? (
            <tr>
              <td className="px-4 py-8 text-center text-slate-500" colSpan={5}>
                暂无运行记录。请确认 Python 后端已设置 AGENT_LOOP_RUNS_DIR。
              </td>
            </tr>
          ) : (
            runs.slice(0, 30).map(run => (
              <tr
                key={run.runId}
                className={cn(
                  "border-t border-slate-100 transition-colors hover:bg-slate-50",
                  selectedRunId === run.runId && "bg-sky-50/70"
                )}
              >
                <td className="min-w-[280px] px-4 py-3">
                  <button
                    type="button"
                    onClick={() => onSelect(run)}
                    className="block w-full text-left"
                  >
                    <span className="block truncate font-semibold text-slate-900">
                      {compactTaskName(run.task)}
                    </span>
                    <span className="mt-1 block truncate font-data text-xs text-slate-500">
                      {run.runId}
                    </span>
                  </button>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={run.status} />
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {formatAgentPair(run)}
                </td>
                <td className="px-4 py-3 font-data text-slate-700">
                  {run.iterations ?? 0}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {run.runTimeLocal || run.runTimeUtc || "-"}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function DetailPanel({ run }: { run: AgentLoopRunSummary | null }) {
  if (!run) {
    return (
      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle>运行详情</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-500">
          选择一条运行记录查看任务、Agent、状态和 Python API 入口。
        </CardContent>
      </Card>
    );
  }

  const detailHref = `/api/agent-loop/runs/${encodeURIComponent(run.runId)}`;

  return (
    <Card className="rounded-lg">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>运行详情</CardTitle>
          <StatusBadge status={run.status} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div>
          <div className="text-xs font-semibold text-slate-500">Run ID</div>
          <div className="mt-1 break-all font-data text-slate-900">{run.runId}</div>
        </div>
        <div>
          <div className="text-xs font-semibold text-slate-500">任务</div>
          <div className="mt-1 text-slate-900">{run.task || "-"}</div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-slate-50 p-3">
            <div className="text-xs text-slate-500">运行模式</div>
            <div className="mt-1 font-semibold text-slate-900">
              {run.runMode || "-"}
            </div>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <div className="text-xs text-slate-500">Agent</div>
            <div className="mt-1 font-semibold text-slate-900">
              {formatAgentPair(run)}
            </div>
          </div>
        </div>
        <Button asChild variant="outline" className="w-full justify-between">
          <a href={detailHref} target="_blank" rel="noreferrer">
            打开 Python 详情 JSON
            <ExternalLink className="size-4" />
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}

export default function AgentLoopPage() {
  const [runs, setRuns] = useState<AgentLoopRunSummary[]>([]);
  const [health, setHealth] = useState<AgentLoopHealth | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const selectedRun = useMemo(
    () => runs.find(run => run.runId === selectedRunId) ?? runs[0] ?? null,
    [runs, selectedRunId]
  );

  const stats = useMemo(() => {
    const done = runs.filter(run => isDoneStatus(run.status)).length;
    const attention = runs.filter(run => isAttentionStatus(run.status)).length;
    const active = Math.max(0, runs.length - done - attention);
    return { total: runs.length, done, attention, active };
  }, [runs]);

  async function load() {
    setLoadState("loading");
    setError(null);
    try {
      const [healthRes, runsRes] = await Promise.all([
        fetch(HEALTH_ENDPOINT),
        fetch(RUNS_ENDPOINT),
      ]);

      if (!healthRes.ok) {
        throw new Error(`health ${healthRes.status}`);
      }
      if (!runsRes.ok) {
        throw new Error(`runs ${runsRes.status}`);
      }

      const nextHealth = (await healthRes.json()) as AgentLoopHealth;
      const nextRuns = (await runsRes.json()) as AgentLoopRunSummary[];
      setHealth(nextHealth);
      setRuns(Array.isArray(nextRuns) ? nextRuns : []);
      setSelectedRunId(current => {
        if (current && nextRuns.some(run => run.runId === current)) return current;
        return nextRuns[0]?.runId ?? null;
      });
      setLoadState("ready");
    } catch (err) {
      setLoadState("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <main
      className="min-h-screen bg-slate-50 px-5 py-5 text-slate-900 md:px-8"
      data-testid="agent-loop-page"
    >
      <div className="mx-auto flex max-w-[1480px] flex-col gap-5">
        <header className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <div className="flex min-w-0 items-center gap-4">
            <Button asChild variant="outline" size="sm">
              <a href="/sliderule">
                <ArrowLeft className="size-4" />
                返回 SlideRule
              </a>
            </Button>
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                <Bot className="size-4" />
                AgentLoop
              </div>
              <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950">
                运行队列工作台
              </h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-700">
              <Server className="size-3" />
              Python Runtime {health?.status || "checking"}
            </Badge>
            <Button
              type="button"
              onClick={() => void load()}
              disabled={loadState === "loading"}
              size="sm"
            >
              <RefreshCw
                className={cn("size-4", loadState === "loading" && "animate-spin")}
              />
              刷新
            </Button>
          </div>
        </header>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <MetricCard label="总运行" value={stats.total} icon={Rows3} />
          <MetricCard label="已完成" value={stats.done} icon={CheckCircle2} tone="success" />
          <MetricCard label="需关注" value={stats.attention} icon={TriangleAlert} tone="danger" />
          <MetricCard label="进行中/其他" value={stats.active} icon={Clock3} tone="warning" />
        </section>

        <section className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <Card className="rounded-lg">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle>运行队列</CardTitle>
                  <p className="mt-1 text-sm text-slate-500">
                    数据来自 <code>{RUNS_ENDPOINT}</code>
                  </p>
                </div>
                {loadState === "error" ? (
                  <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">
                    {error || "加载失败"}
                  </Badge>
                ) : null}
              </div>
            </CardHeader>
            <CardContent>
              <RunsTable
                runs={runs}
                selectedRunId={selectedRun?.runId ?? null}
                onSelect={run => setSelectedRunId(run.runId)}
              />
            </CardContent>
          </Card>

          <div className="space-y-5">
            <DetailPanel run={selectedRun} />
            <Card className="rounded-lg">
              <CardHeader>
                <CardTitle>运行入口</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-slate-600">
                <div className="rounded-lg bg-slate-50 p-3">
                  <div className="text-xs font-semibold text-slate-500">
                    Health
                  </div>
                  <div className="mt-1 font-data text-slate-900">
                    {HEALTH_ENDPOINT}
                  </div>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <div className="text-xs font-semibold text-slate-500">
                    Backend
                  </div>
                  <div className="mt-1 text-slate-900">
                    {health?.backend || "sliderule-python"}
                    {health?.mode ? ` / ${health.mode}` : ""}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>
      </div>
    </main>
  );
}
