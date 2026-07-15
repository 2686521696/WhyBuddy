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
 *   质量位   — 不发明"质量分"：显示发布闭环证据 n/6（产品的信任货币）
 *   服务健康 — GET /api/health，失败如实显示
 */

import React from "react";
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

const STATUS_META: Record<AppCardStatus, { label: string; cls: string }> = {
  runnable: { label: "可运行", cls: "bg-emerald-50 text-emerald-700" },
  awaiting: { label: "待补充", cls: "bg-amber-50 text-amber-700" },
  draft: { label: "推演中", cls: "bg-blue-50 text-[#1677ff]" },
};

function MiniAppThumb({
  goal,
  detail,
}: {
  goal: string;
  detail: AppCardDetail | null;
}) {
  if (!detail || detail.status !== "runnable" || detail.pageNames.length === 0) {
    // 不闭环不摆假截图：给推演态示意（哲学：证据未齐就是未齐）
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
        </div>
      </div>
    );
  }
  return (
    <div className="flex h-full w-full overflow-hidden bg-white">
      {/* 真实页面名做导航示意 */}
      <div className="flex w-[34%] shrink-0 flex-col gap-1 bg-[#0d1b2e] px-2 py-2">
        <div className="mb-1 truncate text-[9px] font-semibold text-white/90">{goal}</div>
        {detail.pageNames.map((name, i) => (
          <div
            key={name}
            className={`truncate rounded px-1.5 py-[3px] text-[8px] ${
              i === 0 ? "bg-[#1677ff] text-white" : "text-white/60"
            }`}
          >
            {name}
          </div>
        ))}
      </div>
      {/* 真实实体名做数据块示意 */}
      <div className="grid flex-1 grid-cols-2 content-start gap-1.5 p-2">
        {detail.entityNames.map(name => (
          <div key={name} className="rounded border border-stone-100 bg-[#fafbfc] px-1.5 py-1.5">
            <div className="truncate text-[8px] text-stone-400">{name}</div>
            <div className="mt-0.5 h-1.5 w-2/3 rounded-sm bg-stone-200" />
          </div>
        ))}
        <div className="col-span-2 rounded border border-stone-100 bg-[#fafbfc] p-1.5">
          <div className="h-1 w-full rounded-sm bg-stone-100" />
          <div className="mt-1 h-1 w-4/5 rounded-sm bg-stone-100" />
        </div>
      </div>
    </div>
  );
}

export function AppsWorkbench() {
  const [sessions, setSessions] = React.useState<SessionListItem[] | null>(null);
  const [details, setDetails] = React.useState<Record<string, AppCardDetail | null>>({});
  const [listError, setListError] = React.useState<string | null>(null);
  const [healthOk, setHealthOk] = React.useState<boolean | null>(null);
  const [filter, setFilter] = React.useState<GalleryFilter>("all");
  const [query, setQuery] = React.useState("");
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
        list.sort((a, b) =>
          String(b.lastActive ?? b.createdAt ?? "").localeCompare(
            String(a.lastActive ?? a.createdAt ?? "")
          )
        );
        setSessions(list);
        // 渐进拉详情（并发 4，一次一批；失败标 null 不武断）
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

  const paired = (sessions ?? []).map(item => ({
    item,
    detail: details[item.sessionId] ?? null,
  }));
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
    <div data-testid="apps-workbench" className="min-h-full bg-[#f7f8fa] px-8 py-6">
      {/* 标题行 */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[22px] font-bold text-stone-800">我的应用</h1>
          <div className="mt-1 text-[12px] text-stone-400">
            由 SlideRule 推演并生成的可运行系统
          </div>
        </div>
        <button
          data-testid="apps-create-new"
          className="rounded-lg bg-[#1677ff] px-4 py-2 text-[13px] font-medium text-white shadow-sm hover:bg-[#1668e3]"
          onClick={() => open(newSessionId())}
        >
          + 创建新应用
        </button>
      </div>

      {/* 统计条 */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {(
          [
            ["all", `全部 ${counts.all}`],
            ["draft", `推演中 ${counts.draft}`],
            ["runnable", `可运行 ${counts.runnable}`],
          ] as Array<[GalleryFilter, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            className={`rounded-lg border px-3 py-1.5 text-[12px] ${
              filter === key
                ? "border-[#1677ff] bg-white font-medium text-[#1677ff]"
                : "border-stone-200 bg-white text-stone-500 hover:border-stone-300"
            }`}
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
        <span
          data-testid="apps-health-chip"
          className="ml-2 inline-flex items-center gap-1.5 text-[12px] text-stone-500"
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              healthOk == null ? "bg-stone-300" : healthOk ? "bg-emerald-500" : "bg-red-500"
            }`}
          />
          {healthOk == null ? "服务检查中…" : healthOk ? "推演服务正常" : "推演服务异常"}
        </span>
        <button
          className="ml-auto text-[12px] text-stone-400 hover:text-[#1677ff]"
          onClick={() => setShowObservatory(true)}
        >
          系统观察台 →
        </button>
      </div>

      {/* 搜索 */}
      <div className="mt-3">
        <input
          data-testid="apps-search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="搜索应用"
          className="w-72 rounded-lg border border-stone-200 bg-white px-3 py-2 text-[13px] text-stone-700 outline-none placeholder:text-stone-300 focus:border-[#1677ff]"
        />
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
                className="group cursor-pointer overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm transition hover:border-[#1677ff]/50 hover:shadow-md"
                onClick={() => open(item.sessionId)}
              >
                <div className="relative h-40 border-b border-stone-100">
                  <MiniAppThumb goal={item.goal} detail={detail} />
                  {meta && (
                    <span
                      className={`absolute right-3 top-3 rounded-md px-2 py-0.5 text-[11px] font-medium shadow-sm ${meta.cls}`}
                    >
                      {meta.label}
                    </span>
                  )}
                </div>
                <div className="px-4 pb-3 pt-3">
                  <div className="truncate text-[14px] font-semibold text-stone-800">
                    {item.goal || "（未命名话题）"}
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[11px] text-stone-400">
                    <span>更新于 {formatUpdatedAt(item.lastActive ?? item.createdAt) || "—"}</span>
                    <span className="font-medium text-[#1677ff] opacity-0 transition group-hover:opacity-100">
                      打开应用 →
                    </span>
                  </div>
                  <div className="mt-2.5 flex items-center gap-3 border-t border-stone-100 pt-2.5 text-[11px] text-stone-500">
                    {detail ? (
                      <>
                        <span>实体 {detail.entities}</span>
                        <span>页面 {detail.pages}</span>
                        <span>流程 {detail.flowNodes}</span>
                        <span>角色 {detail.roles}</span>
                        <span
                          className={`ml-auto font-medium ${
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
