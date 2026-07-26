/**
 * AppsWorkbench — 「应用中心」（E42，按用户定稿要求重构）。
 *
 * 布局定稿（用户三条硬性要求，2026-07-17）：
 *   1. 卡片一律 16:9，字段内容以底部浮层压在图上（不再图上字下两段式）；
 *   2. 「我的应用 / 官方示例库」tab 切换——筛选口径不同，卡片样式相同；
 *   3. 一行 4 张、每页最多三行（12 张），超出走分页器。
 *
 * 北极星纪律不变：全部真数据、fail-closed——
 *   列表     — GET /api/sliderule/sessions（话题/时间/阶段）
 *   卡片详情 — GET /api/sliderule/sessions/:id 渐进拉取，
 *              五系统模型解析自持久化 perSkillEvidence（同应用舞台同源）
 *   我的应用缩略 — 按真实模型示意渲染（导航=真实页面名），不闭环不摆假截图
 *   示例库   — GET /api/sliderule/builtin-examples（E35 冻结过门模型投影）
 *              + 真截图资产；拉不到就如实空态
 *   状态     — 门语言（closed 6/6 / blocked / 推演中），不发明"质量分"
 */

import React from "react";
import { Pagination } from "antd";
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
  Boxes,
  BarChart3,
  ShieldCheck,
  ShoppingCart,
  Calendar,
  FileText as FileIcon,
  Sparkles,
  Globe,
  Wrench,
  Heart,
  BookOpen,
} from "lucide-react";
import { resolveIdentityTheme } from "@/pages/sliderule/live-runtime/identity-themes";
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
import {
  listApps,
  getApp,
  forkApp,
  deleteApp,
  type AppStoreSummary,
} from "./app-store-client";
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
  /** AI 能力数（model.aigc.capabilities，E41 指标行） */
  aiCaps: number;
  pageNames: string[];
  entityNames: string[];
  /** 应用身份（E40.2）：产品名/主题/图标——应用中心卡片的"脸" */
  identity: { productName: string; theme: string; icon: string } | null;
  /** Phase A：用于缩略图缓存失效的稳定摘要（stableDigest from publishClosure） */
  stableDigest?: string;
  /** 2026-07-23：完整五系统模型——「活渲染缩略图」直接拿它挂 AppRuntimeScreen，
   *  不再截图。null 表示模型不完整（非 runnable），缩略图走占位态。 */
  model: FiveSystemModel | null;
}

/**
 * 五系统模型 → 卡片详情的核心（会话态与 App Store 记录共用同一套读法：
 * 都是从同一份 five-system 模型抽指标，保证两条数据源的卡片指标口径一致）。
 */
export function buildDetailFromModel(
  model: FiveSystemModel | null,
  opts: { evidenceCount: number; blocked: boolean; awaitReason?: unknown; stableDigest?: string }
): AppCardDetail {
  const entitiesArr = model?.datamodel?.entities ?? [];
  const pagesArr = model?.page?.pages ?? [];
  const nodesArr = (model?.workflow as any)?.nodes ?? [];
  const rolesArr = model?.rbac?.roles ?? [];
  const capsArr = model?.aigc?.capabilities ?? [];
  const rawIdentity = (model?.appbundle as any)?.appIdentity;
  const identity =
    rawIdentity && (rawIdentity.productName || rawIdentity.theme)
      ? {
          productName: String(rawIdentity.productName ?? "").trim(),
          theme: String(rawIdentity.theme ?? "azure").trim() || "azure",
          icon: String(rawIdentity.icon ?? "boxes").trim() || "boxes",
        }
      : null;
  const status: AppCardStatus =
    opts.evidenceCount >= 6 && !opts.blocked && model
      ? "runnable"
      : opts.awaitReason
        ? "awaiting"
        : "draft";
  return {
    status,
    evidenceCount: opts.evidenceCount,
    blocked: opts.blocked,
    entities: entitiesArr.length,
    pages: pagesArr.length,
    flowNodes: Array.isArray(nodesArr) ? nodesArr.length : 0,
    roles: rolesArr.length,
    aiCaps: capsArr.length,
    identity,
    pageNames: pagesArr.map((p: any) => String(p?.name ?? p?.id ?? "")).filter(Boolean).slice(0, 6),
    entityNames: entitiesArr.map((e: any) => String(e?.name ?? e?.id ?? "")).filter(Boolean).slice(0, 4),
    stableDigest: opts.stableDigest,
    model,
  };
}

/** 从持久化会话状态推导卡片详情（不发明数据：模型缺失就是 draft）。 */
export function deriveAppCardDetail(state: unknown): AppCardDetail {
  const s = (state ?? {}) as Record<string, any>;
  const closure = s.publishClosure ?? {};
  const model: FiveSystemModel | null = mergeFiveSystemModels(
    null,
    parseFiveSystemModelFromPerSkillEvidence(closure.perSkillEvidence)
  );
  return buildDetailFromModel(model, {
    evidenceCount: Number(closure.evidencePresentCount ?? 0) || 0,
    blocked: Boolean(closure.blocked),
    awaitReason: s.awaitReason,
    stableDigest: String(closure.stableDigest ?? closure.closureHash ?? "").slice(0, 32) || undefined,
  });
}

/**
 * App Store 完整记录（含 model_json）→ 卡片详情。App Store 只存闭环应用，
 * model_json 就是那份 five-system 模型，直接喂 buildDetailFromModel（证据满 6、
 * 不 blocked），得到的指标/身份/活渲染模型跟会话卡完全同源。
 */
export function deriveDetailFromAppRecord(modelJson: unknown): AppCardDetail {
  const model = (modelJson && typeof modelJson === "object"
    ? (modelJson as FiveSystemModel)
    : null);
  return buildDetailFromModel(model, { evidenceCount: 6, blocked: false });
}

/**
 * App Store 列表摘要 → 卡片「即时」详情（模型加载前的占位）。摘要不含完整模型，
 * 所以 model=null、roles/aiCaps 暂 0，进视口懒拉到 model 后由 deriveDetailFromAppRecord
 * 升级。产品名/主题/页面数/实体数摘要里就有，先渲染出来。
 */
export function deriveDetailFromAppSummary(s: AppStoreSummary): AppCardDetail {
  return {
    status: "runnable", // App Store 只存闭环应用
    evidenceCount: 6,
    blocked: false,
    entities: s.entity_count || 0,
    pages: s.page_count || 0,
    flowNodes: 0,
    roles: 0,
    aiCaps: 0,
    identity:
      s.product_name || s.theme_id
        ? {
            productName: s.product_name || "",
            theme: s.theme_id || "azure",
            icon: "boxes", // 摘要不含 icon，默认；模型加载后升级
          }
        : null,
    pageNames: [],
    entityNames: [],
    stableDigest: undefined,
    model: null, // 懒加载：卡进视口再 getApp 拉完整模型
  };
}

/**
 * 画廊统一条目（两条数据源合流）：
 *   - source "app"     ── App Store 闭环应用（有血缘/版本，可复刻、可删记录）
 *   - source "session" ── 尚未落库的在推演会话草稿（推演中/blocked）
 * 卡片 UI 一套壳，只按 source 分派封面来源 / 菜单动作。
 */
export interface GalleryItem {
  key: string;
  source: "app" | "session";
  goal: string;
  createdAt?: string | null;
  lastActive?: string | null;
  /** session 源必有；app 源 = 记录里的 session_id（可能为空） */
  sessionId?: string;
  /** app 源必有：App Store 记录 id（复刻/删记录/按 id 拉模型） */
  appId?: string;
  rootId?: string;
  parentId?: string | null;
  version?: number;
  /** app 源必有：列表摘要（模型加载前即时渲染卡片） */
  summary?: AppStoreSummary;
  phase?: string | null;
}

/**
 * 合并两条数据源：App Store 闭环应用（主）∪ 未落库的在推演会话草稿。
 * 按 session_id 去重——某个会话已闭环落库（App Store 里有），就不再把它的会话
 * 草稿卡重复摆出来（App Store 卡取代之，因为它带血缘/版本/可复刻）。
 * 保证零回退：当前所有会话卡仍在，只是闭环的那些改由 App Store 卡承载。
 */
export function mergeGalleryItems(
  apps: AppStoreSummary[],
  sessions: SessionListItem[]
): GalleryItem[] {
  const appItems: GalleryItem[] = apps.map(a => ({
    key: `app:${a.id}`,
    source: "app",
    goal: a.goal || a.product_name || "",
    createdAt: a.created_at,
    lastActive: a.created_at,
    sessionId: a.session_id || undefined,
    appId: a.id,
    rootId: a.root_id,
    parentId: a.parent_id,
    version: a.version,
    summary: a,
  }));
  const claimed = new Set(
    apps.map(a => a.session_id).filter((x): x is string => Boolean(x))
  );
  const sessionItems: GalleryItem[] = sessions
    .filter(s => s.sessionId && !claimed.has(s.sessionId))
    .map(s => ({
      key: `session:${s.sessionId}`,
      source: "session",
      goal: s.goal,
      createdAt: s.createdAt,
      lastActive: s.lastActive,
      sessionId: s.sessionId,
      phase: s.phase,
    }));
  return [...appItems, ...sessionItems];
}

export type GalleryFilter = "all" | "runnable" | "draft" | "blocked";

/** 筛选口径 = 门语言（E41）：closed 6/6（runnable）/ blocked / 推演中（其余）。 */
export function filterCards<
  T extends { item: { goal: string }; detail: AppCardDetail | null },
>(items: T[], filter: GalleryFilter, query: string): T[] {
  const q = query.trim().toLowerCase();
  return items.filter(({ item, detail }) => {
    if (q && !item.goal.toLowerCase().includes(q)) return false;
    if (filter === "all") return true;
    if (!detail) return false; // 详情未到不武断归类
    if (filter === "runnable") return detail.status === "runnable";
    if (filter === "blocked") return detail.blocked && detail.status !== "runnable";
    return detail.status !== "runnable" && !detail.blocked;
  });
}

export function formatUpdatedAt(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 相对时间「3 分钟前 / 2 小时前 / 昨天 …」（对标 moment().fromNow()，不引新依赖）。
 * 画廊看的是"新不新、活跃不活跃"，相对时间比绝对时间戳直观。绝对时间由调用方
 * 放进 title 悬浮兜底。now 参数注入便于确定性单测。坏输入回空串。
 */
export function formatRelativeTime(iso?: string | null, now: number = Date.now()): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const sec = Math.floor((now - t) / 1000);
  if (sec < 60) return "刚刚";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "昨天";
  if (day < 7) return `${day} 天前`;
  const week = Math.floor(day / 7);
  if (week < 5) return `${week} 周前`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month} 个月前`;
  return `${Math.floor(day / 365)} 年前`;
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

// E41 品牌图标封闭集（id 合法域 = @legal identityIcons，与运行时同套语义）
const BRAND_LUCIDE: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  boxes: Boxes,
  chart: BarChart3,
  shield: ShieldCheck,
  cart: ShoppingCart,
  users: Users,
  calendar: Calendar,
  file: FileIcon,
  spark: Sparkles,
  globe: Globe,
  wrench: Wrench,
  heart: Heart,
  book: BookOpen,
};

function themePrimary(themeId: string): string {
  return resolveIdentityTheme(themeId).primary;
}

// E41：徽标 = 全线统一的门语言（closed 6/6 / blocked / 推演中），
// 不再另造"运行中/待补充"一套。dot 色在深色浮层上仍可辨。
const STATUS_META: Record<AppCardStatus, { label: string; cls: string; dot: string }> = {
  runnable: { label: "closed 6/6", cls: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-400" },
  awaiting: { label: "blocked", cls: "bg-amber-50 text-amber-700", dot: "bg-amber-400" },
  draft: { label: "推演中", cls: "bg-blue-50 text-[#1677ff]", dot: "bg-[#4d9aff]" },
};

/** 每页 12 张 = 一行 4 × 最多三行（用户硬性要求），超出走分页器。 */
const PAGE_SIZE = 12;

/** 未闭环/无模型时的占位态（推演中 / blocked）——不是缩略图失败兜底，是诚实展示进度。 */
function PendingAppThumb({ detail }: { detail: AppCardDetail | null }) {
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
        <div className="mt-1 text-[11px] text-stone-400">
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

/**
 * 骨架卡（对标 ToolJet AppList 的 react-loading-skeleton）：加载时铺等尺寸的
 * 16:9 灰块占位——结构跟真卡片一致，数据到了直接"填进去"不跳版。用 animate-pulse
 * 做呼吸微光，不引新依赖。
 */
function SkeletonCard() {
  return (
    <div className="aspect-video overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
      <div className="flex h-full w-full animate-pulse flex-col justify-end bg-gradient-to-br from-stone-100 to-stone-50 p-3.5">
        <div className="flex items-center gap-1.5">
          <div className="h-5 w-5 shrink-0 rounded-[6px] bg-stone-200" />
          <div className="h-3 w-2/5 rounded bg-stone-200" />
        </div>
        <div className="mt-2 flex items-center gap-2">
          <div className="h-2.5 w-12 rounded bg-stone-200" />
          <div className="h-2.5 w-12 rounded bg-stone-200" />
          <div className="h-2.5 w-10 rounded bg-stone-200" />
          <div className="ml-auto h-2.5 w-14 rounded bg-stone-200" />
        </div>
      </div>
    </div>
  );
}

/** 空态插画（内联 SVG，无外部资产、离线可用、跟随主题）：叠放的卡片 + 一点星光。 */
function EmptyGalleryArt() {
  return (
    <svg width="132" height="104" viewBox="0 0 132 104" fill="none" aria-hidden="true">
      <rect x="26" y="30" width="80" height="52" rx="8" fill="#eef2ff" />
      <rect x="34" y="20" width="80" height="52" rx="8" fill="#e0e7ff" />
      <rect x="42" y="10" width="80" height="52" rx="8" fill="#fff" stroke="#c7d2fe" strokeWidth="2" />
      <rect x="50" y="20" width="30" height="6" rx="3" fill="#c7d2fe" />
      <rect x="50" y="32" width="64" height="4" rx="2" fill="#e0e7ff" />
      <rect x="50" y="42" width="52" height="4" rx="2" fill="#e0e7ff" />
      <path d="M18 16l2.2 5.3L25.5 23l-5.3 2.2L18 30.5l-2.2-5.3L10.5 23l5.3-1.7L18 16z" fill="#5b6cff" opacity="0.9" />
      <circle cx="112" cy="86" r="3" fill="#5b6cff" opacity="0.55" />
      <circle cx="24" cy="72" r="2.5" fill="#5b6cff" opacity="0.4" />
    </svg>
  );
}

// AppRuntimeScreen 很重（antd 表格/echarts 懒 chunk）——App Center 一页最多
// 12 张卡，独立分包 + 视口内才挂载，避免把这份重量压进应用中心首屏包。
const LazyAppRuntimeScreen = React.lazy(() =>
  import("@/pages/sliderule/live-runtime/AppRuntimeScreen").then(m => ({
    default: m.AppRuntimeScreen,
  }))
);

/**
 * 活渲染缩略图（2026-07-23，取代 Phase A 的服务端截图方案）。
 *
 * 应用本来就是拿 five-system 模型实时渲染出来的（AppRuntimeScreen），缩略图
 * 没必要额外截一张图存起来——直接把同一个组件按卡片尺寸挂载、禁用交互即可：
 * 永远最新、零缓存失效问题、不用额外的存储/沙盒基建。
 *
 * AppRuntimeScreen 自己的 useScaleToFit 会把 1440×810 画布按容器实际尺寸
 * 等比缩小，这里只需要给够 h-full w-full 的容器；设备切换条经 controlsContainer
 * portal 到一个隐藏节点，缩略图里不需要看见它。
 */
function LiveAppThumb({
  sessionId,
  model,
  goal,
}: {
  sessionId: string;
  model: FiveSystemModel;
  goal: string;
}) {
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const [hiddenControls, setHiddenControls] = React.useState<HTMLDivElement | null>(null);
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={wrapRef}
      className="pointer-events-none h-full w-full overflow-hidden bg-[#f0f2f5]"
      data-testid="app-thumb-live"
    >
      <div ref={setHiddenControls} style={{ display: "none" }} />
      {visible && (
        <React.Suspense fallback={<div className="h-full w-full bg-[#f0f2f5]" />}>
          <LazyAppRuntimeScreen
            model={model}
            sessionId={sessionId}
            appTitle={goal}
            controlsContainer={hiddenControls}
          />
        </React.Suspense>
      )}
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
  // 扁平筛选 chip：圆角收成 lg，避免全圆胶囊过圆
  return (
    <button
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition ${
        active
          ? "bg-[#e8eeff] text-[#3b5bdb]"
          : "bg-transparent text-slate-500 hover:bg-white/60 hover:text-slate-700"
      }`}
      onClick={onClick}
    >
      <span className={active ? "opacity-100" : "opacity-70"}>{icon}</span>
      <span>{label}</span>
      <span
        className={`tabular-nums text-[11px] ${
          active ? "text-[#3b5bdb]/80" : "text-slate-400"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

/**
 * 应用中心统一卡片壳（E42 硬性要求）：16:9 画面铺满整卡，字段内容
 * 以底部渐变浮层压在图上——我的应用与官方示例库共用同一张壳，
 * 只有 media / 指标 / 状态注入不同。
 */
function CenterCard({
  testid,
  title,
  titleAttr,
  iconBg,
  Icon,
  media,
  metrics,
  statusDot,
  statusLabel,
  onClick,
  topRight,
}: {
  testid: string;
  title: string;
  titleAttr?: string;
  iconBg?: string;
  Icon?: React.ComponentType<{ size?: number; className?: string }>;
  media: React.ReactNode;
  metrics: React.ReactNode;
  statusDot: string;
  statusLabel: string;
  onClick: () => void;
  topRight?: React.ReactNode;
}) {
  return (
    <div
      data-testid={testid}
      title={titleAttr}
      className="group relative aspect-video cursor-pointer overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm transition hover:border-[#1677ff]/60 hover:shadow-lg"
      onClick={onClick}
    >
      <div className="absolute inset-0">{media}</div>
      {/* 底部浮层：字段内容压在画面上（16:9 定稿要求） */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/45 to-transparent px-3.5 pb-2.5 pt-12">
        <div className="flex items-center gap-1.5">
          {Icon && (
            <span
              className="flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-[6px] text-white"
              style={{ background: iconBg }}
            >
              <Icon size={12} />
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-white">
            {title}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2.5 text-[11px] text-white/80">
          {metrics}
          <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 font-medium text-white/95">
            <span className={`h-1.5 w-1.5 rounded-full ${statusDot}`} />
            {statusLabel}
          </span>
        </div>
      </div>
      {topRight}
    </div>
  );
}

/** 官方示例（E41）：E35 冻结过门模型的摘要投影（API 返回，全真数据）。 */
export interface BuiltinExample {
  domain: string;
  productName: string;
  theme: string;
  icon: string;
  nav: string;
  intent: string;
  category: string;
  pages: number;
  roles: number;
  aiCapabilities: number;
  tags: string[];
}

/** 点模板 = 新会话 + 暂存起手意图（SlideRule 页挂载时消费预填输入框）。 */
export const PENDING_TEMPLATE_INTENT_KEY = "sliderule:pending-template-intent";

export function AppsWorkbench() {
  // 两条数据源：apps = App Store 闭环应用（摘要，有血缘/版本/可复刻）；
  // sessions = 会话（含尚未落库的在推演草稿）。合并成画廊条目（mergeGalleryItems）。
  const [apps, setApps] = React.useState<AppStoreSummary[] | null>(null);
  const [sessions, setSessions] = React.useState<SessionListItem[] | null>(null);
  // 详情按画廊条目 key（app:<id> / session:<id>）索引——两条源共用一张 map。
  const [details, setDetails] = React.useState<Record<string, AppCardDetail | null>>({});
  const [listError, setListError] = React.useState<string | null>(null);
  // 三服务健康（原观察台独有价值下放：点健康点展开分列详情）
  const [nodeOk, setNodeOk] = React.useState<boolean | null>(null);
  const [pyOk, setPyOk] = React.useState<boolean | null>(null);
  const [llm, setLlm] = React.useState<{ provider: string; model: string; keyPresent: boolean } | null | false>(null);
  const [healthOpen, setHealthOpen] = React.useState(false);
  const [tab, setTab] = React.useState<"mine" | "examples">("mine");
  const [filter, setFilter] = React.useState<GalleryFilter>("all");
  const [query, setQuery] = React.useState("");
  const [sortDesc, setSortDesc] = React.useState(true);
  const [menuFor, setMenuFor] = React.useState<string | null>(null);
  // 复刻改名弹框（对标 Budibase duplicateApp：预填「源名 副本」让用户改名）
  const [forkModal, setForkModal] = React.useState<{ item: GalleryItem; name: string } | null>(null);
  const [forkBusy, setForkBusy] = React.useState(false);
  const [page, setPage] = React.useState(1);
  // E28：订阅会话库更新事件（侧栏删会话/新话题落盘）→ 重拉画廊
  const [reloadKey, setReloadKey] = React.useState(0);
  // E41 官方示例库（静态演示无后端 → 不拉不显示，如实为空）
  const [examples, setExamples] = React.useState<BuiltinExample[]>([]);
  const [exampleCat, setExampleCat] = React.useState("全部");
  React.useEffect(() => {
    const bump = () => setReloadKey(k => k + 1);
    window.addEventListener(SESSIONS_UPDATED_EVENT, bump);
    return () => window.removeEventListener(SESSIONS_UPDATED_EVENT, bump);
  }, []);
  // 筛选口径变化 → 回第一页（分页器与筛选联动）
  React.useEffect(() => {
    setPage(1);
  }, [tab, filter, query, exampleCat, sortDesc]);

  React.useEffect(() => {
    let alive = true;
    if (IS_GITHUB_PAGES) {
      // 静态演示（无后端）：画廊 = 主演示会话 + 画廊示例种子（E18：新引擎
      // 真实推演的闭环终态，懒加载不进主包）。不打任何 /api/*。App Store 无后端 → 空。
      setApps([]);
      const store = createGithubPagesSlideRuleSessionStore();
      void Promise.all([
        loadOrSeedGithubPagesDemoSession(store),
        import("@/pages/sliderule/demo-gallery").then(m =>
          m.seedGalleryExamples(store)
        ),
      ])
        .then(([demoState, examples]) => {
          if (!alive) return;
          const sessionList: SessionListItem[] = [
            { sessionId: GITHUB_PAGES_DEMO_SESSION_ID, goal: GITHUB_PAGES_DEMO_GOAL },
            ...examples.map(e => ({ sessionId: e.sessionId, goal: e.goal })),
          ];
          setSessions(sessionList);
          // 演示态详情按合并后的条目 key（session:<id>）索引，跟真实态口径一致。
          setDetails({
            [`session:${GITHUB_PAGES_DEMO_SESSION_ID}`]: deriveAppCardDetail(demoState),
            ...Object.fromEntries(
              examples.map(e => [`session:${e.sessionId}`, deriveAppCardDetail(e.state)])
            ),
          });
        })
        .catch(() => alive && (setSessions([]), setApps([])));
      return () => {
        alive = false;
      };
    }
    // 真实态：并行拉两条源（App Store 摘要 + 会话列表），合并后按卡渐进拉详情。
    // App Store 失败 fail-open 空数组（画廊退化成纯会话卡，零回退）。
    const loadDetail = async (gi: GalleryItem) => {
      try {
        if (gi.source === "app" && gi.appId) {
          const rec = await getApp(gi.appId);
          if (!alive) return;
          setDetails(prev => ({
            ...prev,
            [gi.key]: rec
              ? deriveDetailFromAppRecord(rec.model_json) // 完整模型 → 活渲染 + 全指标
              : gi.summary
                ? deriveDetailFromAppSummary(gi.summary) // 拉不到详情退摘要占位
                : null,
          }));
        } else if (gi.sessionId) {
          const res = await fetch(`/api/sliderule/sessions/${encodeURIComponent(gi.sessionId)}`);
          const body = res.ok ? await res.json() : null;
          if (!alive) return;
          setDetails(prev => ({
            ...prev,
            [gi.key]: body?.state ? deriveAppCardDetail(body.state) : null,
          }));
        }
      } catch {
        if (!alive) return;
        setDetails(prev => ({
          ...prev,
          [gi.key]: gi.source === "app" && gi.summary ? deriveDetailFromAppSummary(gi.summary) : null,
        }));
      }
    };
    void Promise.allSettled([
      listApps(),
      fetch("/api/sliderule/sessions").then(r =>
        r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))
      ),
    ]).then(([appsRes, sessRes]) => {
      if (!alive) return;
      const appList = appsRes.status === "fulfilled" ? appsRes.value : [];
      setApps(appList);
      let sessionList: SessionListItem[] = [];
      if (sessRes.status === "fulfilled") {
        sessionList = ((sessRes.value?.sessions ?? []) as SessionListItem[]).filter(
          (s: SessionListItem) => s.sessionId
        );
        setSessions(sessionList);
      } else {
        setSessions([]);
        setListError(String((sessRes.reason as Error)?.message ?? sessRes.reason));
      }
      // 渐进拉详情（并发 4；app→getApp 完整模型 / session→会话态；失败退占位/ null）
      const queue = mergeGalleryItems(appList, sessionList);
      const workers = Array.from({ length: 4 }, async () => {
        for (;;) {
          const gi = queue.shift();
          if (!gi || !alive) return;
          await loadDetail(gi);
        }
      });
      void Promise.all(workers);
    });
    fetch("/api/sliderule/builtin-examples")
      .then(r => (r.ok ? r.json() : null))
      .then(d => alive && setExamples(Array.isArray(d?.examples) ? d.examples : []))
      .catch(() => alive && setExamples([]));
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
    // 应用中心与左侧会话列表保持双向同步（E28）
  }, [reloadKey]);

  const open = (sessionId: string) => {
    activateSession(sessionId);
    // Pages 子路径部署（/<repo>/）下绝对路径 404——带 BASE_URL 前缀
    const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
    window.location.href = `${base}/agent-loop/sliderule`;
  };

  const useTemplate = (example: BuiltinExample) => {
    try {
      localStorage.setItem(PENDING_TEMPLATE_INTENT_KEY, example.intent);
    } catch {
      /* 隐私模式无存储：仍然打开新会话，用户手动输入 */
    }
    open(newSessionId());
  };

  /** 删卡：App Store 卡删记录（DELETE /apps/{id}，不动会话）；会话草稿卡删会话。 */
  const removeCard = async (gi: GalleryItem) => {
    try {
      if (gi.source === "app" && gi.appId) {
        const ok = await deleteApp(gi.appId);
        if (ok) setApps(prev => (prev ?? []).filter(a => a.id !== gi.appId));
      } else if (gi.sessionId) {
        // DELETE 幂等（G1 契约）；成功后本地摘卡，不整页刷新
        await fetch(`/api/sliderule/sessions/${encodeURIComponent(gi.sessionId)}`, {
          method: "DELETE",
        });
        const remaining = (sessions ?? []).filter(s => s.sessionId !== gi.sessionId);
        setSessions(remaining);
        // E28：与左侧会话列表联动——广播更新事件让侧栏立即摘掉该会话；
        // 删的是当前活跃会话时切到最近剩余会话（一个不剩就开新会话），
        // 避免 active-session-id 悬空指向已删会话
        notifySessionsUpdated();
        try {
          if (localStorage.getItem(ACTIVE_SESSION_KEY) === gi.sessionId) {
            activateSession(remaining[0]?.sessionId ?? newSessionId());
          }
        } catch {
          /* 隐私模式无存储：跳过活跃会话纠正 */
        }
      }
    } catch {
      /* 网络失败保持原样，用户可重试 */
    }
    setMenuFor(null);
  };

  /**
   * 复刻（②，对标 Budibase duplicateApp / Appsmith fork / ToolJet clone）：
   * 以某个 App Store 应用为起点分出一条新血缘（新 root·v1·parent 指向源），
   * 成功后重拉画廊——新卡出现在列表里，用户可点开继续改。后端 fork_app 现成。
   */
  /** 点「复刻」→ 开改名弹框，预填「源名 副本」（不再一键复刻出同名孪生卡）。 */
  const openForkModal = (gi: GalleryItem) => {
    setMenuFor(null);
    if (gi.source !== "app" || !gi.appId) return;
    const baseName =
      details[gi.key]?.identity?.productName ||
      gi.summary?.product_name ||
      gi.goal ||
      "应用";
    setForkModal({ item: gi, name: `${baseName} 副本` });
  };

  /** 确认复刻：带新名调 fork_app 分新血缘（不继承源会话），成功后重拉画廊。 */
  const confirmFork = async () => {
    const fm = forkModal;
    if (!fm?.item.appId || forkBusy) return;
    setForkBusy(true);
    const newId = await forkApp(fm.item.appId, fm.name);
    setForkBusy(false);
    setForkModal(null);
    if (newId) setReloadKey(k => k + 1);
  };

  // 合并两条数据源为画廊条目；详情按条目 key 索引，app 卡在模型加载前用摘要占位。
  const items: GalleryItem[] | null =
    apps === null && sessions === null
      ? null
      : mergeGalleryItems(apps ?? [], sessions ?? []);
  const paired = (items ?? []).map(item => ({
    item,
    detail:
      details[item.key] ??
      (item.source === "app" && item.summary
        ? deriveDetailFromAppSummary(item.summary)
        : null),
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
    blocked: paired.filter(p => p.detail && p.detail.blocked && p.detail.status !== "runnable").length,
    draft: paired.filter(p => p.detail && p.detail.status !== "runnable" && !p.detail.blocked).length,
  };
  // 示例库筛选：分类 chips + 共享搜索框（搜产品名/意图/分类）
  const q = query.trim().toLowerCase();
  const visibleExamples = examples.filter(e => {
    if (exampleCat !== "全部" && e.category !== exampleCat) return false;
    if (!q) return true;
    return (
      e.productName.toLowerCase().includes(q) ||
      e.intent.toLowerCase().includes(q) ||
      e.category.toLowerCase().includes(q)
    );
  });
  // 分页（每页 12 = 4 × 3，用户硬性要求）
  const totalItems = tab === "mine" ? visible.length : visibleExamples.length;
  const pagedMine = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pagedExamples = visibleExamples.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

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
      className="min-h-full bg-[var(--sr-shell-bg,#eef2f7)] px-6 py-5 md:px-8 md:py-6"
      onClick={() => {
        if (menuFor) setMenuFor(null);
        if (healthOpen) setHealthOpen(false);
      }}
    >
      {/*
        顶栏扁平化（对标参考稿）：无白底卡片/无阴影底板；
        第一行 标题 | 搜索 | 健康+创建；第二行 筛选 chip 直接铺在页面灰底上。
      */}
      {/*
        顶栏：标题 | 搜索 | 健康+创建。
        DOM 顺序与视觉/焦点顺序一致，不用 order-* 重排可聚焦控件。
      */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="flex min-w-0 shrink-0 items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg text-[#5b6cff]">
            <LayoutGrid size={18} strokeWidth={2.2} />
          </span>
          <h1 className="text-[18px] font-bold tracking-tight text-slate-900 md:text-[20px]">
            应用中心
          </h1>
        </div>

        <div className="relative w-full min-w-[200px] flex-1 sm:mx-4 sm:max-w-xl md:max-w-2xl">
          <Search
            size={15}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            data-testid="apps-search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={
              tab === "mine" ? "搜索应用、功能或解决方案…" : "搜索官方示例…"
            }
            className="w-full rounded-lg border-0 bg-white/70 py-2.5 pl-10 pr-4 text-[13px] text-slate-800 outline-none ring-1 ring-slate-200/60 placeholder:text-slate-400 transition focus:bg-white focus:ring-2 focus:ring-[#5b6cff]/25"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <span className="relative">
            <button
              type="button"
              data-testid="apps-health-chip"
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/70 px-3 py-2 text-[12px] font-medium text-slate-600 ring-1 ring-slate-200/60 transition hover:bg-white"
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
                className="absolute right-0 top-11 z-20 w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-lg"
                onClick={e => e.stopPropagation()}
              >
                <div className="space-y-2 text-[12px]">
                  <div className="flex items-center gap-2">
                    <span className={`h-1.5 w-1.5 rounded-full ${dotCls(nodeOk)}`} />
                    <span className="text-slate-700">Node API</span>
                    <span className="ml-auto text-[11px] text-slate-400">/api/health</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`h-1.5 w-1.5 rounded-full ${dotCls(pyOk)}`} />
                    <span className="text-slate-700">Python 推演引擎</span>
                    <span className="ml-auto text-[11px] text-slate-400">sliderule-python</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`h-1.5 w-1.5 rounded-full ${dotCls(llmOk)}`} />
                    <span className="text-slate-700">LLM 推演通道</span>
                    <span className="ml-auto truncate text-[11px] text-slate-400">
                      {llm === null
                        ? "…"
                        : llm === false
                          ? "不可用"
                          : `${llm.provider} · ${llm.model}`}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </span>
          <button
            type="button"
            data-testid="apps-create-new"
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#5b6cff] px-4 py-2.5 text-[13px] font-semibold text-white shadow-[0_4px_14px_rgba(91,108,255,0.28)] transition hover:bg-[#4a5aef] active:scale-[0.98]"
            onClick={() => open(newSessionId())}
          >
            <span className="text-[15px] leading-none">+</span>
            创建新应用
          </button>
        </div>
      </div>

      {/* 第二行：库切换 + 门语言筛选 / 分类 — 无底板 */}
      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        {(
          [
            { key: "mine" as const, label: "我的应用", count: paired.length },
            { key: "examples" as const, label: "官方示例", count: examples.length },
          ]
        ).map(t => (
          <button
            key={t.key}
            type="button"
            aria-pressed={tab === t.key}
            data-testid={`apps-tab-${t.key}`}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition ${
              tab === t.key
                ? "bg-[#e8eeff] text-[#3b5bdb]"
                : "bg-transparent text-slate-500 hover:bg-white/60 hover:text-slate-700"
            }`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            <span
              className={`tabular-nums text-[11px] ${
                tab === t.key ? "text-[#3b5bdb]/80" : "text-slate-400"
              }`}
            >
              {t.count}
            </span>
          </button>
        ))}

        <span className="mx-1 hidden h-4 w-px bg-slate-200 sm:inline-block" />

        {tab === "mine" ? (
          <>
            <StatChip
              icon={<LayoutGrid size={13} />}
              label="全部"
              count={counts.all}
              active={filter === "all"}
              onClick={() => setFilter("all")}
            />
            <StatChip
              icon={<Hourglass size={13} className="text-amber-500" />}
              label="推演中"
              count={counts.draft}
              active={filter === "draft"}
              onClick={() => setFilter("draft")}
            />
            <StatChip
              icon={<CircleCheck size={13} className="text-emerald-500" />}
              label="closed 6/6"
              count={counts.runnable}
              active={filter === "runnable"}
              onClick={() => setFilter("runnable")}
            />
            <StatChip
              icon={<Hourglass size={13} className="text-orange-400" />}
              label="blocked"
              count={counts.blocked}
              active={filter === "blocked"}
              onClick={() => setFilter("blocked")}
            />
            <div className="ml-auto flex items-center gap-2">
              <button
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium text-slate-500 transition hover:bg-white/60 hover:text-slate-700"
                onClick={() => setSortDesc(v => !v)}
              >
                <ArrowUpDown size={13} className="text-slate-400" />
                {sortDesc ? "最近更新" : "最早更新"}
              </button>
            </div>
          </>
        ) : (
          ["全部", ...Array.from(new Set(examples.map(e => e.category)))].map(cat => (
            <button
              key={cat}
              data-testid={`example-cat-${cat}`}
              className={`rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition ${
                exampleCat === cat
                  ? "bg-[#e8eeff] text-[#3b5bdb]"
                  : "bg-transparent text-slate-500 hover:bg-white/60 hover:text-slate-700"
              }`}
              onClick={() => setExampleCat(cat)}
            >
              {cat}
            </button>
          ))
        )}
      </div>

      {/* ===== 我的应用 tab ===== */}
      {tab === "mine" &&
        (listError ? (
          <div className="mt-8 text-[13px] text-red-500">会话列表拉取失败：{listError}</div>
        ) : items == null ? (
          // 骨架屏（对标 ToolJet AppList skeleton）：铺等尺寸占位卡，不跳版
          <div
            className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4"
            data-testid="apps-skeleton"
          >
            {Array.from({ length: 8 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : visible.length === 0 ? (
          paired.length === 0 ? (
            // 首次空态（对标 ToolJet BlankPage）：插画 + 引导 + 创建 CTA + 官方示例起手卡
            <div className="mt-10 flex flex-col items-center text-center" data-testid="apps-empty-first">
              <EmptyGalleryArt />
              <div className="mt-4 text-[15px] font-semibold text-slate-800">还没有应用</div>
              <div className="mt-1 text-[13px] text-slate-500">
                描述你想要的系统，让 AI 推演出你的第一个应用
              </div>
              <button
                data-testid="apps-empty-create"
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-[#5b6cff] px-5 py-2.5 text-[13px] font-semibold text-white shadow-[0_4px_14px_rgba(91,108,255,0.28)] transition hover:bg-[#4a5aef] active:scale-[0.98]"
                onClick={() => open(newSessionId())}
              >
                <span className="text-[15px] leading-none">+</span> 创建新应用
              </button>
              {examples.length > 0 && (
                <div className="mt-8 w-full max-w-lg">
                  <div className="mb-2.5 text-[12px] text-slate-400">或从官方示例起手</div>
                  <div className="flex flex-wrap justify-center gap-2">
                    {examples.slice(0, 4).map(ex => {
                      const th = resolveIdentityTheme(ex.theme);
                      return (
                        <button
                          key={ex.domain}
                          data-testid={`empty-starter-${ex.domain}`}
                          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12.5px] text-slate-700 shadow-sm transition hover:border-[#5b6cff]/50 hover:shadow"
                          onClick={() => useTemplate(ex)}
                        >
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ background: th.primary }}
                          />
                          {ex.productName}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            // 搜不到（有应用，但当前搜索/筛选无匹配）
            <div className="mt-10 flex flex-col items-center text-center" data-testid="apps-empty-search">
              <EmptyGalleryArt />
              <div className="mt-4 text-[14px] font-medium text-slate-600">没有匹配的应用</div>
              <div className="mt-1 text-[12.5px] text-slate-400">换个关键词，或清空筛选看看</div>
              {(query || filter !== "all") && (
                <button
                  className="mt-3 rounded-lg px-3 py-1.5 text-[12.5px] font-medium text-[#5b6cff] transition hover:bg-[#eef2ff]"
                  onClick={() => {
                    setQuery("");
                    setFilter("all");
                  }}
                >
                  清空筛选
                </button>
              )}
            </div>
          )
        ) : (
          <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">
            {pagedMine.map(({ item, detail }) => {
              const meta = detail ? STATUS_META[detail.status] : null;
              const BrandIcon = detail?.identity
                ? BRAND_LUCIDE[detail.identity.icon] ?? Boxes
                : undefined;
              // 活渲染缩略图的稳定 id：会话卡用 sessionId，App Store 卡无会话时用 appId。
              const thumbId = item.sessionId || item.appId || item.key;
              const canOpen = Boolean(item.sessionId);
              const isApp = item.source === "app";
              const version = item.version ?? 1;
              const rel = formatRelativeTime(item.lastActive ?? item.createdAt);
              return (
                <CenterCard
                  key={item.key}
                  testid={`app-card-${item.sessionId || item.appId}`}
                  title={detail?.identity?.productName || item.goal || "（未命名话题）"}
                  titleAttr={item.goal}
                  Icon={BrandIcon}
                  iconBg={detail?.identity ? themePrimary(detail.identity.theme) : undefined}
                  media={
                    detail?.status === "runnable" && detail.model ? (
                      <LiveAppThumb sessionId={thumbId} model={detail.model} goal={item.goal} />
                    ) : (
                      <PendingAppThumb detail={detail} />
                    )
                  }
                  metrics={
                    detail ? (
                      <>
                        <span className="inline-flex items-center gap-1" title="页面数">
                          <FileText size={11} className="opacity-60" />
                          页面 {detail.pages}
                        </span>
                        <span className="inline-flex items-center gap-1" title="角色数">
                          <Users size={11} className="opacity-60" />
                          角色 {detail.roles}
                        </span>
                        <span className="inline-flex items-center gap-1" title="AI 能力数">
                          <GitBranch size={11} className="opacity-60" />
                          AI {detail.aiCaps}
                        </span>
                        {isApp && version > 1 && (
                          <span
                            className="inline-flex items-center rounded bg-white/20 px-1.5 text-[10px] font-semibold text-white/95"
                            title="改版次数（App Store 血缘）"
                          >
                            v{version}
                          </span>
                        )}
                        {rel && (
                          <span
                            className="inline-flex items-center text-white/65"
                            title={formatUpdatedAt(item.lastActive ?? item.createdAt)}
                          >
                            {rel}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="opacity-70">加载中…</span>
                    )
                  }
                  statusDot={meta?.dot ?? "bg-stone-300"}
                  statusLabel={meta?.label ?? "…"}
                  onClick={() => (canOpen ? open(item.sessionId!) : undefined)}
                  topRight={
                    <>
                      <button
                        data-testid={`app-menu-${item.sessionId || item.appId}`}
                        className="absolute right-2 top-2 rounded bg-white/85 p-1 text-stone-400 opacity-0 shadow-sm transition hover:text-stone-600 group-hover:opacity-100"
                        onClick={e => {
                          e.stopPropagation();
                          setMenuFor(prev => (prev === item.key ? null : item.key));
                        }}
                      >
                        <MoreHorizontal size={14} />
                      </button>
                      {menuFor === item.key && (
                        <div
                          className="absolute right-2 top-8 z-10 rounded-lg border border-stone-200 bg-white py-1 shadow-lg"
                          onClick={e => e.stopPropagation()}
                        >
                          {isApp && (
                            <button
                              data-testid={`app-fork-${item.appId}`}
                              className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] text-slate-600 hover:bg-slate-50"
                              onClick={() => openForkModal(item)}
                            >
                              <GitBranch size={13} /> 复刻应用
                            </button>
                          )}
                          <button
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] text-red-500 hover:bg-red-50"
                            onClick={() => void removeCard(item)}
                          >
                            <Trash2 size={13} /> 删除应用
                          </button>
                        </div>
                      )}
                    </>
                  }
                />
              );
            })}
          </div>
        ))}

      {/* ===== 官方示例库 tab =====
          每张卡背后是一个过了结构门的冻结五系统模型——真产品名/真主题/
          真指标/真截图，数量如实（有几个过门模型摆几张）。
          点卡 = 新会话预填起手意图，走同一条推演管线（不是复制死模板）。 */}
      {tab === "examples" &&
        (examples.length === 0 ? (
          <div className="mt-8 text-[13px] text-stone-400" data-testid="example-gallery-empty">
            示例库暂不可用——需要 Python 推演服务在线（/api/sliderule/builtin-examples）
          </div>
        ) : visibleExamples.length === 0 ? (
          <div className="mt-8 text-[13px] text-stone-400">没有匹配的示例</div>
        ) : (
          <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4" data-testid="example-gallery">
            {pagedExamples.map(example => {
              const theme = resolveIdentityTheme(example.theme);
              const Icon = BRAND_LUCIDE[example.icon] ?? Boxes;
              const shot = `${(import.meta.env.BASE_URL || "/").replace(/\/$/, "")}/assets/examples/${example.domain}.png`;
              return (
                <CenterCard
                  key={example.domain}
                  testid={`example-card-${example.domain}`}
                  title={example.productName}
                  titleAttr={example.intent}
                  Icon={Icon}
                  iconBg={theme.primary}
                  media={
                    <div className="relative h-full w-full bg-[#f4f6f9]">
                      {/* 真应用截图（playwright 实跑闭环后拍摄；缺图诚实显示占位说明） */}
                      <img
                        src={shot}
                        alt={`${example.productName} 真实截图`}
                        className="h-full w-full object-cover object-top"
                        loading="lazy"
                        onError={e => {
                          (e.currentTarget as HTMLImageElement).style.display = "none";
                          (e.currentTarget.nextElementSibling as HTMLElement | null)?.classList.remove("hidden");
                        }}
                      />
                      <div className="hidden absolute inset-0 items-center justify-center text-[11px] text-stone-400">
                        截图生成中
                      </div>
                    </div>
                  }
                  metrics={
                    <>
                      <span>页面 {example.pages}</span>
                      <span>角色 {example.roles}</span>
                      <span>AI {example.aiCapabilities}</span>
                      <span className="text-white/60 opacity-0 transition group-hover:opacity-100">
                        点卡起手 →
                      </span>
                    </>
                  }
                  statusDot="bg-emerald-400"
                  statusLabel="closed 6/6"
                  onClick={() => useTemplate(example)}
                />
              );
            })}
          </div>
        ))}

      {/* 分页器：一页 12 张（4 × 3），两个 tab 共用（用户定稿） */}
      {totalItems > PAGE_SIZE && (
        <div className="mt-6 flex justify-center" data-testid="apps-pagination">
          <Pagination
            current={page}
            pageSize={PAGE_SIZE}
            total={totalItems}
            onChange={p => setPage(p)}
            showSizeChanger={false}
          />
        </div>
      )}

      {/* 复刻改名弹框（对标 Budibase duplicateApp）：预填「源名 副本」，改名后确认。
          fork 分新血缘、不继承源会话——点开副本不会误进源应用的会话。 */}
      {forkModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          data-testid="fork-modal"
          onClick={() => !forkBusy && setForkModal(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 text-[15px] font-semibold text-slate-900">
              <GitBranch size={16} className="text-[#5b6cff]" /> 复刻应用
            </div>
            <div className="mt-1 text-[12px] text-slate-500">
              复制一份为新应用（记着从谁复刻而来），给它起个名：
            </div>
            <input
              autoFocus
              data-testid="fork-name-input"
              value={forkModal.name}
              disabled={forkBusy}
              onChange={e => setForkModal(m => (m ? { ...m, name: e.target.value } : m))}
              onKeyDown={e => {
                if (e.key === "Enter") void confirmFork();
                if (e.key === "Escape") setForkModal(null);
              }}
              className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] text-slate-800 outline-none transition focus:border-[#5b6cff] focus:ring-2 focus:ring-[#5b6cff]/20"
              placeholder="副本名称"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-lg px-3 py-1.5 text-[12.5px] font-medium text-slate-500 transition hover:bg-slate-100"
                disabled={forkBusy}
                onClick={() => setForkModal(null)}
              >
                取消
              </button>
              <button
                data-testid="fork-confirm"
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#5b6cff] px-4 py-1.5 text-[12.5px] font-semibold text-white transition hover:bg-[#4a5aef] disabled:opacity-60"
                disabled={forkBusy || !forkModal.name.trim()}
                onClick={() => void confirmFork()}
              >
                {forkBusy ? "复刻中…" : "复刻"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
