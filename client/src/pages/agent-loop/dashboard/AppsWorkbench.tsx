/**
 * AppsWorkbench — 工作台首页「我的应用」画廊（E14，按用户效果图重构）。
 *
 * 每张卡片 = 一个推演会话生成的可运行系统。北极星纪律：全部真数据、
 * fail-closed——
 *   列表     — GET /api/sliderule/sessions（话题/时间/阶段）
 *   卡片详情 — GET /api/sliderule/sessions/:id 渐进拉取，
 *              五系统模型解析自持久化 perSkillEvidence（同应用舞台同源）
 *   缩略图   — 按真实模型示意渲染（导航=真实页面名，块=真实实体名），
 *              不闭环不摆假截图
 *   标签行   — 真实页面名（效果图的功能标签位）
 *   质量位   — 不发明"质量分"：显示发布闭环证据 n/6（产品的信任货币）；
 *              未闭环卡片给证据进度条（同一数据，两种读法）
 *   服务健康 — GET /api/health，失败如实显示
 */

import React from "react";
import {
  LayoutGrid,
  FileText,
  GitBranch,
  Users,
  Search,
  Hourglass,
  CircleCheck,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import {
  mergeFiveSystemModels,
  parseFiveSystemModelFromPerSkillEvidence,
  type FiveSystemModel,
} from "@/pages/sliderule/system-screens/five-system-model";
import { activateSession, newSessionId } from "./SidebarSessions";
import { MainlineWorkbench } from "./MainlineWorkbench";

// ---------------------------------------------------------------------------
// 纯函数（可单测）
// ---------------------------------------------------------------------------

export interface SessionListItem {
  sessionId: string;
  goal: string;
  createdAt?: string | null;
  lastActive?: string | null;
  artifactCount?: number;
  phase?: string | null;
}

export type AppCardStatus = "runnable" | "awaiting" | "draft";

export interface AppCardDetail {
  status: AppCardStatus;
  evidenceCount: number;
  blocked: boolean;
  entities: number;
  pages: number;
  flowNodes: number;
  roles: number;
  pageNames: string[];
  entityNames: string[];
}

/** 从持久化会话状态推导卡片详情（不发明数据：模型缺失就是 draft）。 */
export function deriveAppCardDetail(state: unknown): AppCardDetail {
  const s = (state ?? {}) as Record<string, any>;
  const closure = s.publishClosure ?? {};
  const evidenceCount = Number(closure.evidencePresentCount ?? 0) || 0;
  const blocked = Boolean(closure.blocked);
  const model: FiveSystemModel | null = mergeFiveSystemModels(
    null,
    parseFiveSystemModelFromPerSkillEvidence(closure.perSkillEvidence)
  );
  const entitiesArr = model?.datamodel?.entities ?? [];
  const pagesArr = model?.page?.pages ?? [];
  const nodesArr = (model?.workflow as any)?.nodes ?? [];
  const rolesArr = model?.rbac?.roles ?? [];
  const status: AppCardStatus =
    evidenceCount >= 6 && !blocked && model
      ? "runnable"
      : s.awaitReason
        ? "awaiting"
        : "draft";
  return {
    status,
    evidenceCount,
    blocked,
    entities: entitiesArr.length,
    pages: pagesArr.length,
    flowNodes: Array.isArray(nodesArr) ? nodesArr.length : 0,
    roles: rolesArr.length,
    pageNames: pagesArr.map((p: any) => String(p?.name ?? p?.id ?? "")).filter(Boolean).slice(0, 6),
    entityNames: entitiesArr.map((e: any) => String(e?.name ?? e?.id ?? "")).filter(Boolean).slice(0, 4),
  };
}

export type GalleryFilter = "all" | "runnable" | "draft";

export function filterCards(
  items: Array<{ item: SessionListItem; detail: AppCardDetail | null }>,
  filter: GalleryFilter,
  query: string
) {
  const q = query.trim().toLowerCase();
  return items.filter(({ item, detail }) => {
    if (q && !item.goal.toLowerCase().includes(q)) return false;
    if (filter === "all") return true;
    if (!detail) return false; // 详情未到不武断归类
    if (filter === "runnable") return detail.status === "runnable";
    return detail.status !== "runnable";
  });
}

export function formatUpdatedAt(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

const STATUS_META: Record<AppCardStatus, { label: string; cls: string; dot: string }> = {
  runnable: { label: "运行中", cls: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  awaiting: { label: "待补充", cls: "bg-amber-50 text-amber-700", dot: "bg-amber-500" },
  draft: { label: "推演中", cls: "bg-blue-50 text-[#1677ff]", dot: "bg-[#1677ff]" },
};

/** 缩略图：全部由真实模型渲染——不是截图，是「按声明重演的迷你应用」。 */
function MiniAppThumb({
  goal,
  detail,
}: {
  goal: string;
  detail: AppCardDetail | null;
}) {
  if (!detail || detail.status !== "runnable" || detail.pageNames.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#eef4ff] to-[#f7f8fa]">
        <div className="text-center">
          <span className="inline-flex items-end gap-1">
            {[0, 1, 2].map(i => (
              <span
                key={i}
                className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#1677ff]"
                style={{ animationDelay: `${i * 160}ms` }}
              />
            ))}
          </span>
          <div className="mt-1.5 text-[11px] text-stone-400">
            {detail?.blocked ? "待补充信息" : "推演未闭环"}
          </div>
          {detail && (
            <div className="mx-auto mt-2 h-1 w-24 overflow-hidden rounded-full bg-stone-200">
              <div
                className="h-full rounded-full bg-[#1677ff]"
                style={{ width: `${Math.min(100, (detail.evidenceCount / 6) * 100)}%` }}
              />
            </div>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="flex h-full w-full overflow-hidden bg-[#f4f6f9]">
      {/* 真实页面名做导航 */}
      <div className="flex w-[30%] shrink-0 flex-col gap-[3px] bg-[#0d1b2e] px-1.5 py-2">
        <div className="mb-1 flex items-center gap-1 px-0.5">
          <span className="h-2 w-2 shrink-0 rounded-sm bg-[#1677ff]" />
          <span className="truncate text-[8px] font-semibold text-white/90">{goal}</span>
        </div>
        {detail.pageNames.map((name, i) => (
          <div
            key={name}
            className={`truncate rounded px-1.5 py-[3px] text-[8px] ${
              i === 0 ? "bg-[#1677ff] text-white" : "text-white/55"
            }`}
          >
            {name}
          </div>
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 顶栏：面包屑 + 角色点 */}
        <div className="flex items-center justify-between border-b border-stone-200/70 bg-white px-2 py-1">
          <span className="truncate text-[7px] text-stone-400">
            {goal} / {detail.pageNames[0]}
          </span>
          <span className="flex items-center gap-1">
            <span className="h-1 w-6 rounded-sm bg-stone-100" />
            <span className="h-2 w-2 rounded-full bg-[#1677ff]/80" />
          </span>
        </div>
        {/* 真实实体做统计卡行 */}
        <div className="grid grid-cols-4 gap-1 px-1.5 pt-1.5">
          {detail.entityNames.map(name => (
            <div key={name} className="rounded border border-stone-200/60 bg-white px-1 py-1">
              <div className="truncate text-[7px] text-stone-400">{name}</div>
              <div className="mt-0.5 text-[9px] font-semibold text-stone-600">0</div>
            </div>
          ))}
        </div>
        {/* 表格块示意 */}
        <div className="mx-1.5 mt-1.5 flex-1 rounded-t border border-stone-200/60 bg-white p-1.5">
          <div className="flex gap-1">
            {[3, 2, 2, 3].map((w, i) => (
              <span key={i} className={`h-1.5 rounded-sm bg-stone-200/80 w-${w * 4}`} style={{ width: `${w * 14}px` }} />
            ))}
          </div>
          {[0.9, 0.75, 0.6].map((op, i) => (
            <div key={i} className="mt-1.5 flex gap-1" style={{ opacity: op }}>
              <span className="h-1 w-full rounded-sm bg-stone-100" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatChip({
  icon,
  label,
  count,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`flex items-center gap-2 rounded-xl border bg-white px-4 py-2.5 text-[13px] shadow-sm transition ${
        active
          ? "border-[#1677ff] text-[#1677ff]"
          : "border-stone-200 text-stone-600 hover:border-stone-300"
      }`}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
      <span className={`font-semibold ${active ? "text-[#1677ff]" : "text-stone-800"}`}>{count}</span>
    </button>
  );
}

export function AppsWorkbench() {
  const [sessions, setSessions] = React.useState<SessionListItem[] | null>(null);
  const [details, setDetails] = React.useState<Record<string, AppCardDetail | null>>({});
  const [listError, setListError] = React.useState<string | null>(null);
  const [healthOk, setHealthOk] = React.useState<boolean | null>(null);
  const [filter, setFilter] = React.useState<GalleryFilter>("all");
  const [query, setQuery] = React.useState("");
  const [sortDesc, setSortDesc] = React.useState(true);
  const [menuFor, setMenuFor] = React.useState<string | null>(null);
  const [showObservatory, setShowObservatory] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    fetch("/api/sliderule/sessions")
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(data => {
        if (!alive) return;
        const list: SessionListItem[] = (data?.sessions ?? []).filter(
          (s: SessionListItem) => s.sessionId
        );
        setSessions(list);
        // 渐进拉详情（并发 4；失败标 null 不武断）
        const queue = [...list];
        const workers = Array.from({ length: 4 }, async () => {
          for (;;) {
            const item = queue.shift();
            if (!item || !alive) return;
            try {
              const res = await fetch(`/api/sliderule/sessions/${encodeURIComponent(item.sessionId)}`);
              const body = res.ok ? await res.json() : null;
              if (!alive) return;
              setDetails(prev => ({
                ...prev,
                [item.sessionId]: body?.state ? deriveAppCardDetail(body.state) : null,
              }));
            } catch {
              if (!alive) return;
              setDetails(prev => ({ ...prev, [item.sessionId]: null }));
            }
          }
        });
        void Promise.all(workers);
      })
      .catch(e => alive && setListError(String(e?.message ?? e)));
    fetch("/api/health")
      .then(r => alive && setHealthOk(r.ok))
      .catch(() => alive && setHealthOk(false));
    return () => {
      alive = false;
    };
  }, []);

  const open = (sessionId: string) => {
    activateSession(sessionId);
    window.location.href = "/agent-loop/sliderule";
  };

  const removeApp = async (sessionId: string) => {
    // DELETE 幂等（G1 契约）；成功后本地摘卡，不整页刷新
    try {
      await fetch(`/api/sliderule/sessions/${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
      });
      setSessions(prev => (prev ?? []).filter(s => s.sessionId !== sessionId));
    } catch {
      /* 网络失败保持原样，用户可重试 */
    }
    setMenuFor(null);
  };

  const paired = (sessions ?? []).map(item => ({
    item,
    detail: details[item.sessionId] ?? null,
  }));
  paired.sort((a, b) => {
    const ka = String(a.item.lastActive ?? a.item.createdAt ?? "");
    const kb = String(b.item.lastActive ?? b.item.createdAt ?? "");
    return sortDesc ? kb.localeCompare(ka) : ka.localeCompare(kb);
  });
  const visible = filterCards(paired, filter, query);
  const counts = {
    all: paired.length,
    runnable: paired.filter(p => p.detail?.status === "runnable").length,
    draft: paired.filter(p => p.detail && p.detail.status !== "runnable").length,
  };

  if (showObservatory) {
    return (
      <div data-testid="apps-workbench-observatory">
        <div className="px-6 pt-4">
          <button
            className="text-[12px] text-[#1677ff] hover:underline"
            onClick={() => setShowObservatory(false)}
          >
            ← 返回我的应用
          </button>
        </div>
        <MainlineWorkbench />
      </div>
    );
  }

  return (
    <div
      data-testid="apps-workbench"
      className="min-h-full bg-[#f7f8fa] px-8 py-6"
      onClick={() => menuFor && setMenuFor(null)}
    >
      {/* 标题行 */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[24px] font-bold text-stone-800">我的应用</h1>
          <div className="mt-1 text-[13px] text-stone-400">
            由 SlideRule 推演并生成的可运行系统
          </div>
        </div>
        <button
          data-testid="apps-create-new"
          className="rounded-lg bg-[#1677ff] px-4 py-2.5 text-[13px] font-medium text-white shadow-sm hover:bg-[#1668e3]"
          onClick={() => open(newSessionId())}
        >
          + 创建新应用
        </button>
      </div>

      {/* 统计条（图标卡 + 服务健康） */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <StatChip
          icon={<LayoutGrid size={15} className="text-stone-400" />}
          label="全部"
          count={counts.all}
          active={filter === "all"}
          onClick={() => setFilter("all")}
        />
        <StatChip
          icon={<Hourglass size={15} className="text-amber-500" />}
          label="推演中"
          count={counts.draft}
          active={filter === "draft"}
          onClick={() => setFilter("draft")}
        />
        <StatChip
          icon={<CircleCheck size={15} className="text-emerald-500" />}
          label="可运行"
          count={counts.runnable}
          active={filter === "runnable"}
          onClick={() => setFilter("runnable")}
        />
        <span
          data-testid="apps-health-chip"
          className="ml-1 inline-flex items-center gap-1.5 text-[13px] text-stone-500"
        >
          <span
            className={`h-2 w-2 rounded-full ${
              healthOk == null ? "bg-stone-300" : healthOk ? "bg-emerald-500" : "bg-red-500"
            }`}
          />
          {healthOk == null ? "服务检查中…" : healthOk ? "推演服务正常" : "推演服务异常"}
        </span>
      </div>

      {/* 搜索 + 筛选 tab + 排序 */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-300" />
          <input
            data-testid="apps-search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="搜索应用"
            className="w-72 rounded-lg border border-stone-200 bg-white py-2 pl-8 pr-3 text-[13px] text-stone-700 outline-none placeholder:text-stone-300 focus:border-[#1677ff]"
          />
        </div>
        <div className="flex items-center gap-1 text-[13px]">
          {(
            [
              ["all", "全部"],
              ["draft", "推演中"],
              ["runnable", "可运行"],
            ] as Array<[GalleryFilter, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              className={`rounded-md px-3 py-1.5 transition ${
                filter === key
                  ? "bg-[#1677ff]/10 font-medium text-[#1677ff]"
                  : "text-stone-500 hover:bg-stone-100"
              }`}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          className="ml-auto rounded-lg border border-stone-200 bg-white px-3 py-2 text-[12px] text-stone-500 hover:border-stone-300"
          onClick={() => setSortDesc(v => !v)}
          title="切换排序方向"
        >
          {sortDesc ? "最近更新 ▾" : "最早更新 ▴"}
        </button>
        <button
          className="text-[12px] text-stone-400 hover:text-[#1677ff]"
          onClick={() => setShowObservatory(true)}
        >
          系统观察台 →
        </button>
      </div>

      {/* 卡片栅格 */}
      {listError ? (
        <div className="mt-8 text-[13px] text-red-500">会话列表拉取失败：{listError}</div>
      ) : sessions == null ? (
        <div className="mt-8 text-[13px] text-stone-400">加载中…</div>
      ) : visible.length === 0 ? (
        <div className="mt-8 text-[13px] text-stone-400">
          {paired.length === 0 ? "还没有应用——点右上角「创建新应用」开始推演" : "没有匹配的应用"}
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {visible.map(({ item, detail }) => {
            const meta = detail ? STATUS_META[detail.status] : null;
            return (
              <div
                key={item.sessionId}
                data-testid={`app-card-${item.sessionId}`}
                className="group relative cursor-pointer overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm transition hover:border-[#1677ff]/60 hover:shadow-md"
                onClick={() => open(item.sessionId)}
              >
                <div className="relative h-44 border-b border-stone-100">
                  <MiniAppThumb goal={item.goal} detail={detail} />
                  {meta && (
                    <span
                      className={`absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium shadow-sm ${meta.cls}`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                      {meta.label}
                      {detail && detail.status !== "runnable" && (
                        <span className="opacity-70">证据 {detail.evidenceCount}/6</span>
                      )}
                    </span>
                  )}
                  {/* … 菜单（真操作：删除应用，DELETE 幂等） */}
                  <button
                    data-testid={`app-menu-${item.sessionId}`}
                    className="absolute right-2 top-2 rounded-md bg-white/80 p-1 text-stone-400 opacity-0 shadow-sm transition hover:text-stone-600 group-hover:opacity-100"
                    onClick={e => {
                      e.stopPropagation();
                      setMenuFor(prev => (prev === item.sessionId ? null : item.sessionId));
                    }}
                  >
                    <MoreHorizontal size={15} />
                  </button>
                  {menuFor === item.sessionId && (
                    <div
                      className="absolute right-2 top-9 z-10 rounded-lg border border-stone-200 bg-white py-1 shadow-lg"
                      onClick={e => e.stopPropagation()}
                    >
                      <button
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] text-red-500 hover:bg-red-50"
                        onClick={() => void removeApp(item.sessionId)}
                      >
                        <Trash2 size={13} /> 删除应用
                      </button>
                    </div>
                  )}
                </div>
                <div className="px-4 pb-3.5 pt-3">
                  <div className="truncate text-[15px] font-semibold text-stone-800">
                    {item.goal || "（未命名话题）"}
                  </div>
                  {/* 功能标签行：真实页面名 */}
                  <div className="mt-1 truncate text-[12px] text-stone-400">
                    {detail && detail.pageNames.length > 0
                      ? detail.pageNames.slice(0, 4).join(" · ")
                      : "推演中——功能清单闭环后出现"}
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-[11px] text-stone-400">
                    <span>更新于 {formatUpdatedAt(item.lastActive ?? item.createdAt) || "—"}</span>
                    <span className="font-medium text-[#1677ff] opacity-0 transition group-hover:opacity-100">
                      打开应用 →
                    </span>
                  </div>
                  <div className="mt-2.5 flex items-center gap-3.5 border-t border-stone-100 pt-2.5 text-[11.5px] text-stone-500">
                    {detail ? (
                      <>
                        <span className="inline-flex items-center gap-1">
                          <LayoutGrid size={12} className="text-stone-300" /> {detail.entities} 实体
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <FileText size={12} className="text-stone-300" /> {detail.pages} 页面
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <GitBranch size={12} className="text-stone-300" /> {detail.flowNodes} 流程
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Users size={12} className="text-stone-300" /> {detail.roles} 角色
                        </span>
                        <span
                          className={`ml-auto font-semibold ${
                            detail.evidenceCount >= 6 ? "text-emerald-600" : "text-stone-400"
                          }`}
                        >
                          证据 {detail.evidenceCount}/6
                        </span>
                      </>
                    ) : (
                      <span className="text-stone-300">详情加载中…</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
