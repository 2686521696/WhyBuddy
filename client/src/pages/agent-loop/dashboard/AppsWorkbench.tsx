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
 *
 * v3 布局（用户五条反馈，2026-07-15）：单排工具行（搜索 + 图标筛选卡 +
 * 排序 + 观察台按钮，tab 不再两排重复）；卡片紧凑化，一行最多 6 个。
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
  ArrowUpDown,
} from "lucide-react";
import {
  mergeFiveSystemModels,
  parseFiveSystemModelFromPerSkillEvidence,
  type FiveSystemModel,
} from "@/pages/sliderule/system-screens/five-system-model";
import {
  ACTIVE_SESSION_KEY,
  SESSIONS_UPDATED_EVENT,
  activateSession,
  newSessionId,
  notifySessionsUpdated,
} from "./SidebarSessions";
import { IS_GITHUB_PAGES } from "@/lib/deploy-target";
import {
  GITHUB_PAGES_DEMO_GOAL,
  GITHUB_PAGES_DEMO_SESSION_ID,
  createGithubPagesSlideRuleSessionStore,
  loadOrSeedGithubPagesDemoSession,
} from "@/pages/sliderule/github-pages-sliderule-demo";

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
                className="h-1 w-1 animate-pulse rounded-full bg-[#1677ff]"
                style={{ animationDelay: `${i * 160}ms` }}
              />
            ))}
          </span>
          <div className="mt-1 text-[10px] text-stone-400">
            {detail?.blocked ? "待补充信息" : "推演未闭环"}
          </div>
          {detail && (
            <div className="mx-auto mt-1.5 h-[3px] w-16 overflow-hidden rounded-full bg-stone-200">
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
      <div className="flex w-[32%] shrink-0 flex-col gap-[2px] bg-[#0d1b2e] px-1 py-1.5">
        <div className="mb-0.5 flex items-center gap-1 px-0.5">
          <span className="h-1.5 w-1.5 shrink-0 rounded-sm bg-[#1677ff]" />
          <span className="truncate text-[7px] font-semibold text-white/90">{goal}</span>
        </div>
        {detail.pageNames.slice(0, 4).map((name, i) => (
          <div
            key={name}
            className={`truncate rounded px-1 py-[2px] text-[7px] ${
              i === 0 ? "bg-[#1677ff] text-white" : "text-white/55"
            }`}
          >
            {name}
          </div>
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-stone-200/70 bg-white px-1.5 py-[3px]">
          <span className="truncate text-[6px] text-stone-400">{detail.pageNames[0]}</span>
          <span className="h-1.5 w-1.5 rounded-full bg-[#1677ff]/80" />
        </div>
        <div className="grid grid-cols-2 gap-1 px-1 pt-1">
          {detail.entityNames.slice(0, 2).map(name => (
            <div key={name} className="rounded border border-stone-200/60 bg-white px-1 py-[3px]">
              <div className="truncate text-[6px] text-stone-400">{name}</div>
              <div className="text-[8px] font-semibold text-stone-600">0</div>
            </div>
          ))}
        </div>
        <div className="mx-1 mt-1 flex-1 rounded-t border border-stone-200/60 bg-white p-1">
          {[1, 0.75, 0.5].map((op, i) => (
            <div key={i} className="mb-1 h-[3px] w-full rounded-sm bg-stone-100" style={{ opacity: op }} />
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
      className={`flex items-center gap-1.5 rounded-lg border bg-white px-3 py-2 text-[12.5px] shadow-sm transition ${
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
  // 三服务健康（原观察台独有价值下放：点健康点展开分列详情）
  const [nodeOk, setNodeOk] = React.useState<boolean | null>(null);
  const [pyOk, setPyOk] = React.useState<boolean | null>(null);
  const [llm, setLlm] = React.useState<{ provider: string; model: string; keyPresent: boolean } | null | false>(null);
  const [healthOpen, setHealthOpen] = React.useState(false);
  const [filter, setFilter] = React.useState<GalleryFilter>("all");
  const [query, setQuery] = React.useState("");
  const [sortDesc, setSortDesc] = React.useState(true);
  const [menuFor, setMenuFor] = React.useState<string | null>(null);
  // E28：订阅会话库更新事件（侧栏删会话/新话题落盘）→ 重拉画廊
  const [reloadKey, setReloadKey] = React.useState(0);
  React.useEffect(() => {
    const bump = () => setReloadKey(k => k + 1);
    window.addEventListener(SESSIONS_UPDATED_EVENT, bump);
    return () => window.removeEventListener(SESSIONS_UPDATED_EVENT, bump);
  }, []);

  React.useEffect(() => {
    let alive = true;
    if (IS_GITHUB_PAGES) {
      // 静态演示（无后端）：画廊 = 主演示会话 + 画廊示例种子（E18：新引擎
      // 真实推演的闭环终态，懒加载不进主包）。不打任何 /api/*。
      const store = createGithubPagesSlideRuleSessionStore();
      void Promise.all([
        loadOrSeedGithubPagesDemoSession(store),
        import("@/pages/sliderule/demo-gallery").then(m =>
          m.seedGalleryExamples(store)
        ),
      ])
        .then(([demoState, examples]) => {
          if (!alive) return;
          setSessions([
            { sessionId: GITHUB_PAGES_DEMO_SESSION_ID, goal: GITHUB_PAGES_DEMO_GOAL },
            ...examples.map(e => ({ sessionId: e.sessionId, goal: e.goal })),
          ]);
          setDetails({
            [GITHUB_PAGES_DEMO_SESSION_ID]: deriveAppCardDetail(demoState),
            ...Object.fromEntries(
              examples.map(e => [e.sessionId, deriveAppCardDetail(e.state)])
            ),
          });
        })
        .catch(() => alive && setSessions([]));
      return () => {
        alive = false;
      };
    }
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
    if (IS_GITHUB_PAGES) return () => { alive = false; }; // 演示态不探测
    fetch("/api/health")
      .then(r => alive && setNodeOk(r.ok))
      .catch(() => alive && setNodeOk(false));
    fetch("/api/agent-loop/health")
      .then(r => (r.ok ? r.json() : null))
      .then(d => alive && setPyOk(Boolean(d && d.status === "ok")))
      .catch(() => alive && setPyOk(false));
    fetch("/api/sliderule/llm-channel")
      .then(r => (r.ok ? r.json() : null))
      .then(d =>
        alive &&
        setLlm(
          d
            ? {
                provider: String(d.provider ?? ""),
                model: String(d.model ?? ""),
                keyPresent: Boolean(d.keyPresent),
              }
            : false
        )
      )
      .catch(() => alive && setLlm(false));
    return () => {
      alive = false;
    };
    // reloadKey：会话库变更事件（侧栏删除/话题落盘）触发整体重拉，
    // 工作台与左侧会话列表保持双向同步（E28）
  }, [reloadKey]);

  const open = (sessionId: string) => {
    activateSession(sessionId);
    // Pages 子路径部署（/<repo>/）下绝对路径 404——带 BASE_URL 前缀
    const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
    window.location.href = `${base}/agent-loop/sliderule`;
  };

  const removeApp = async (sessionId: string) => {
    // DELETE 幂等（G1 契约）；成功后本地摘卡，不整页刷新
    try {
      await fetch(`/api/sliderule/sessions/${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
      });
      const remaining = (sessions ?? []).filter(s => s.sessionId !== sessionId);
      setSessions(remaining);
      // E28：与左侧会话列表联动——广播更新事件让侧栏立即摘掉该会话；
      // 删的是当前活跃会话时切到最近剩余会话（一个不剩就开新会话），
      // 避免 active-session-id 悬空指向已删会话
      notifySessionsUpdated();
      try {
        if (localStorage.getItem(ACTIVE_SESSION_KEY) === sessionId) {
          activateSession(remaining[0]?.sessionId ?? newSessionId());
        }
      } catch {
        /* 隐私模式无存储：跳过活跃会话纠正 */
      }
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

  const llmOk = llm === null ? null : llm !== false && llm.keyPresent;
  const overall: boolean | null =
    nodeOk === null || pyOk === null || llmOk === null
      ? null
      : Boolean(nodeOk && pyOk && llmOk);
  const dotCls = (ok: boolean | null) =>
    ok == null ? "bg-stone-300" : ok ? "bg-emerald-500" : "bg-red-500";

  return (
    <div
      data-testid="apps-workbench"
      className="min-h-full bg-[#f7f8fa] px-8 py-6"
      onClick={() => {
        if (menuFor) setMenuFor(null);
        if (healthOpen) setHealthOpen(false);
      }}
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

      {/* 单排工具行：搜索 + 图标筛选卡（即 tab，不再两排重复）+ 排序 + 观察台 */}
      <div className="mt-5 flex flex-wrap items-center gap-2.5">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-300" />
          <input
            data-testid="apps-search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="搜索应用"
            className="w-60 rounded-lg border border-stone-200 bg-white py-2 pl-8 pr-3 text-[12.5px] text-stone-700 shadow-sm outline-none placeholder:text-stone-300 focus:border-[#1677ff]"
          />
        </div>
        <StatChip
          icon={<LayoutGrid size={14} className="text-stone-400" />}
          label="全部"
          count={counts.all}
          active={filter === "all"}
          onClick={() => setFilter("all")}
        />
        <StatChip
          icon={<Hourglass size={14} className="text-amber-500" />}
          label="推演中"
          count={counts.draft}
          active={filter === "draft"}
          onClick={() => setFilter("draft")}
        />
        <StatChip
          icon={<CircleCheck size={14} className="text-emerald-500" />}
          label="可运行"
          count={counts.runnable}
          active={filter === "runnable"}
          onClick={() => setFilter("runnable")}
        />
        {/* 服务健康：点开分列三服务详情（原观察台独有价值，下放到此） */}
        <span className="relative">
          <button
            data-testid="apps-health-chip"
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12.5px] text-stone-500 transition hover:bg-stone-100"
            onClick={e => {
              e.stopPropagation();
              setHealthOpen(v => !v);
            }}
          >
            <span
              className={`h-2 w-2 rounded-full ${IS_GITHUB_PAGES ? "bg-sky-400" : dotCls(overall)}`}
            />
            {IS_GITHUB_PAGES
              ? "静态演示 · 无后端"
              : overall == null
                ? "服务检查中…"
                : overall
                  ? "推演服务正常"
                  : "推演服务异常"}
          </button>
          {healthOpen && (
            <div
              data-testid="apps-health-popover"
              className="absolute left-0 top-9 z-20 w-64 rounded-xl border border-stone-200 bg-white p-3 shadow-lg"
              onClick={e => e.stopPropagation()}
            >
              <div className="space-y-2 text-[12px]">
                <div className="flex items-center gap-2">
                  <span className={`h-1.5 w-1.5 rounded-full ${dotCls(nodeOk)}`} />
                  <span className="text-stone-700">Node API</span>
                  <span className="ml-auto text-[11px] text-stone-400">/api/health</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`h-1.5 w-1.5 rounded-full ${dotCls(pyOk)}`} />
                  <span className="text-stone-700">Python 推演引擎</span>
                  <span className="ml-auto text-[11px] text-stone-400">sliderule-python</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`h-1.5 w-1.5 rounded-full ${dotCls(llmOk)}`} />
                  <span className="text-stone-700">LLM 推演通道</span>
                  <span className="ml-auto truncate text-[11px] text-stone-400">
                    {llm === null ? "…" : llm === false ? "不可用" : `${llm.provider} · ${llm.model}`}
                  </span>
                </div>
              </div>
            </div>
          )}
        </span>
        <div className="ml-auto flex items-center gap-2.5">
          <button
            className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-2 text-[12px] text-stone-500 shadow-sm hover:border-stone-300"
            onClick={() => setSortDesc(v => !v)}
          >
            <ArrowUpDown size={13} className="text-stone-400" />
            {sortDesc ? "最近更新" : "最早更新"}
          </button>
        </div>
      </div>

      {/* 卡片栅格：紧凑卡，一行最多 6 个 */}
      {listError ? (
        <div className="mt-8 text-[13px] text-red-500">会话列表拉取失败：{listError}</div>
      ) : sessions == null ? (
        <div className="mt-8 text-[13px] text-stone-400">加载中…</div>
      ) : visible.length === 0 ? (
        <div className="mt-8 text-[13px] text-stone-400">
          {paired.length === 0 ? "还没有应用——点右上角「创建新应用」开始推演" : "没有匹配的应用"}
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {visible.map(({ item, detail }) => {
            const meta = detail ? STATUS_META[detail.status] : null;
            return (
              <div
                key={item.sessionId}
                data-testid={`app-card-${item.sessionId}`}
                className="group relative cursor-pointer overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm transition hover:border-[#1677ff]/60 hover:shadow-md"
                onClick={() => open(item.sessionId)}
              >
                <div className="relative h-[104px] border-b border-stone-100">
                  <MiniAppThumb goal={item.goal} detail={detail} />
                  {meta && (
                    <span
                      className={`absolute left-2 top-2 inline-flex items-center gap-1 rounded px-1.5 py-[2px] text-[10px] font-medium shadow-sm ${meta.cls}`}
                    >
                      <span className={`h-1 w-1 rounded-full ${meta.dot}`} />
                      {meta.label}
                    </span>
                  )}
                  <button
                    data-testid={`app-menu-${item.sessionId}`}
                    className="absolute right-1.5 top-1.5 rounded bg-white/85 p-0.5 text-stone-400 opacity-0 shadow-sm transition hover:text-stone-600 group-hover:opacity-100"
                    onClick={e => {
                      e.stopPropagation();
                      setMenuFor(prev => (prev === item.sessionId ? null : item.sessionId));
                    }}
                  >
                    <MoreHorizontal size={14} />
                  </button>
                  {menuFor === item.sessionId && (
                    <div
                      className="absolute right-1.5 top-7 z-10 rounded-lg border border-stone-200 bg-white py-1 shadow-lg"
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
                <div className="px-2.5 pb-2 pt-2">
                  <div className="truncate text-[12.5px] font-semibold leading-snug text-stone-800">
                    {item.goal || "（未命名话题）"}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-[10.5px] text-stone-400">
                      {detail && detail.pageNames.length > 0
                        ? detail.pageNames.slice(0, 3).join(" · ")
                        : "推演中"}
                    </span>
                    <span className="shrink-0 text-[9.5px] text-stone-300">
                      {formatUpdatedAt(item.lastActive ?? item.createdAt).slice(5) || "—"}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2 border-t border-stone-100 pt-1.5 text-[10.5px] text-stone-500">
                    {detail ? (
                      <>
                        <span className="inline-flex items-center gap-0.5" title="实体">
                          <LayoutGrid size={11} className="text-stone-300" />
                          {detail.entities}
                        </span>
                        <span className="inline-flex items-center gap-0.5" title="页面">
                          <FileText size={11} className="text-stone-300" />
                          {detail.pages}
                        </span>
                        <span className="inline-flex items-center gap-0.5" title="流程">
                          <GitBranch size={11} className="text-stone-300" />
                          {detail.flowNodes}
                        </span>
                        <span className="inline-flex items-center gap-0.5" title="角色">
                          <Users size={11} className="text-stone-300" />
                          {detail.roles}
                        </span>
                        <span
                          className={`ml-auto font-semibold ${
                            detail.evidenceCount >= 6 ? "text-emerald-600" : "text-stone-400"
                          }`}
                          title="发布闭环证据"
                        >
                          {detail.evidenceCount}/6
                        </span>
                      </>
                    ) : (
                      <span className="text-stone-300">加载中…</span>
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
