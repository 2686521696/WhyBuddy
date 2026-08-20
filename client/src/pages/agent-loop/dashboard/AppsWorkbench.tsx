/**
 * AppsWorkbench — 「应用中心」（E42，按用户定稿要求重构）。
 *
 * 布局定稿（用户三条硬性要求，2026-07-17）：
 *   1. 卡片一律 16:9，字段内容以底部浮层压在图上（不再图上字下两段式）；
 *   2. 「应用市场 / 我的应用 / 官方应用」三个货架——筛选口径不同，卡片样式相同；
 *      ⚠ 2026-08-19：原先「我的应用」其实是后端可见的全部应用，超管会把
 *      全站货架混进来。新建和 Fork 进「我的应用」；公开的进「应用市场」；
 *      标了官方的进「官方应用」。
 *      ⚑ 2026-08-14 示例**数据**清空（用户裁决：清数据不删功能）：老链路
 *      的四张示例卡下架，功能骨架（tab/分类/分页/点卡起手）原样保留，
 *      货架空着如实显示空态；后端 _EXAMPLE_META 上架新条目即恢复展示。
 *   3. 一行 4 张、每页 12 张。「我的应用」滚到底再要下一页（服务端
 *      limit/offset，不在前端一次切 200 张）；完整模型按卡挂载再拉。
 *      官方示例仍是网格 + 分页器。
 *
 * 北极星纪律不变：全部真数据、fail-closed——
 *   列表     — GET /api/sliderule/sessions（话题/时间/阶段）
 *   卡片详情 — GET /api/sliderule/sessions/:id 渐进拉取，
 *              五系统模型解析自持久化 perSkillEvidence（同应用舞台同源）
 *   我的应用缩略 — 按真实模型示意渲染（导航=真实页面名），不闭环不摆假截图
 *   示例库   — GET /api/sliderule/builtin-examples（冻结过门模型投影）；
 *              拉不到/没上架就如实空态
 *   状态     — 门语言（closed 6/6 / blocked / 推演中），不发明"质量分"
 */

import React from "react";
import { canWriteApp, useAuth } from "@/lib/use-auth";
import { Pagination } from "antd";

import { useContainerPosition } from "masonic";

import { useScrollerIn } from "./useScrollerIn";
import { SpanMasonry } from "./SpanMasonry";
import { appendStableItems, appendUniqueById } from "./masonry-append";
import { appendStableSpanKeys, spanForColumnCount } from "./app-wall-span";
import { DEVICE_ASPECT, aspectForDevice } from "@/lib/justified-rows";
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
  Lock,
  Wrench,
  Heart,
  BookOpen,
} from "lucide-react";
import { requestMountPermit } from "@/lib/mount-scheduler";
import { captureAndUpload } from "@/lib/thumb-capture";
import { resolveIdentityTheme } from "@/pages/sliderule/live-runtime/identity-themes";
// spec-first HTML 应用面的配料（2026-08-14 应用中心接线）。这几个都是轻量纯
// TS（无重依赖）；重的 DOMPurify/渲染面走下面的 React.lazy 分包。
import { specPageViewport, useScaleToFit } from "@/pages/sliderule/live-runtime/canvas-scale";
import { deriveBindingSource } from "@/pages/sliderule/live-runtime/derive-binding-source";
import { initRuntimeState } from "@/pages/sliderule/live-runtime/live-runtime";
import { seedRuntimeState } from "@/pages/sliderule/live-runtime/demo-seed";
import { pageIsBoundFromSpec } from "@/pages/sliderule/spec-page-bound";
import {
  mergeFiveSystemModels,
  parseFiveSystemModelFromPerSkillEvidence,
  type FiveSystemModel,
} from "@/pages/sliderule/system-screens/five-system-model";
import {
  ACTIVE_SESSION_KEY,
  SESSIONS_UPDATED_EVENT,
  activateSession,
  createSessionId,
  notifySessionsUpdated,
} from "./SidebarSessions";
import {
  listApps,
  getApp,
  forkApp,
  deleteApp,
  patchApp,
  appPreviewUrl,
  type AppStoreSummary,
  type AppShelf,
} from "./app-store-client";

export { appPreviewUrl };
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

/**
 * spec-first 整页 HTML（校验过形状的那份）。来源两处、同一形状：
 *   - 会话卡：state.specFirstPages（GET /sessions/:id 的完整会话态）
 *   - App Store 卡：完整记录的 pages_json（GET /apps/:id）
 */
export interface SpecPagesDetail {
  /** pageId → 完整 HTML 文档（带 data-* 绑定孔），至少一页 */
  pages: Record<string, string>;
  /** 外壳统一时定下的导航顺序；第一项就是落地页 */
  navItems: Array<{ pageId?: string; label?: string }>;
  /** 打过孔（6.5 步绑定成功）的页数；0 = 没跑打孔或一页都没打上 */
  boundPages: number;
  /** 每页打孔相位（bound / failed / skipped）。有它就认它，不靠成功数反推。 */
  pageBindStatus?: Record<string, string>;
  /** 画页或打孔失败的页 → 原因。打孔部分失败时成功页仍计入 boundPages。 */
  failedPages?: Record<string, unknown>;
  /** desktop 横屏 1920×1080 / phone 竖屏 390×844 CSS 像素。
   *  老存档没有这个字段——按桌面兜底，行为与从前一致。 */
  device?: "desktop" | "phone";
}

/**
 * 把后端载荷收成 SpecPagesDetail；形状不对/没有一页就 null。
 * **判空必须严**：空壳 {} 判成"有页面"的话，卡片会挂一个空白 iframe——
 * 比老的区块渲染更糟（那至少是真数据）。
 */
export function extractSpecPages(raw: unknown): SpecPagesDetail | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const pagesRaw = r.pages;
  if (!pagesRaw || typeof pagesRaw !== "object") return null;
  const pages: Record<string, string> = {};
  for (const [id, html] of Object.entries(pagesRaw as Record<string, unknown>)) {
    if (typeof html === "string" && html.trim()) pages[id] = html;
  }
  if (Object.keys(pages).length === 0) return null;
  const navItems = Array.isArray(r.navItems)
    ? (r.navItems.filter(n => n && typeof n === "object") as Array<{
        pageId?: string;
        label?: string;
      }>)
    : [];
  return {
    pages,
    navItems,
    boundPages: typeof r.boundPages === "number" ? r.boundPages : 0,
    pageBindStatus:
      r.pageBindStatus && typeof r.pageBindStatus === "object" && !Array.isArray(r.pageBindStatus)
        ? (r.pageBindStatus as Record<string, string>)
        : undefined,
    failedPages:
      r.failedPages && typeof r.failedPages === "object" && !Array.isArray(r.failedPages)
        ? (r.failedPages as Record<string, unknown>)
        : undefined,
    device: r.device === "phone" ? "phone" : "desktop",
  };
}

/**
 * 按导航顺序排页面（导航第一项 = 落地页），导航没提到的页排在后面兜底。
 * 缩略图取第一张；预览模态的页签也按这个序。
 */
export function orderedSpecPages(sp: SpecPagesDetail): Array<{ pageId: string; html: string }> {
  const out: Array<{ pageId: string; html: string }> = [];
  const seen = new Set<string>();
  for (const nav of sp.navItems) {
    const id = nav.pageId ?? "";
    if (id && sp.pages[id] && !seen.has(id)) {
      out.push({ pageId: id, html: sp.pages[id] });
      seen.add(id);
    }
  }
  for (const [pageId, html] of Object.entries(sp.pages)) {
    if (!seen.has(pageId)) out.push({ pageId, html });
  }
  return out;
}

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
  /** 2026-08-14：spec-first 整页 HTML。非 null 时缩略图与只读预览一律走
   *  HTML 应用面（同推演舞台一路），不再拿区块渲染器凑合出光板表格。 */
  specPages: SpecPagesDetail | null;
}

/**
 * 五系统模型 → 卡片详情的核心（会话态与 App Store 记录共用同一套读法：
 * 都是从同一份 five-system 模型抽指标，保证两条数据源的卡片指标口径一致）。
 */
export function buildDetailFromModel(
  model: FiveSystemModel | null,
  opts: {
    evidenceCount: number;
    blocked: boolean;
    awaitReason?: unknown;
    stableDigest?: string;
    specPages?: SpecPagesDetail | null;
  }
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
    specPages: opts.specPages ?? null,
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
    // 会话态里的 spec-first 整页 HTML（与推演舞台/交付物同一份）
    specPages: extractSpecPages(s.specFirstPages),
  });
}

/**
 * App Store 完整记录（含 model_json）→ 卡片详情。App Store 只存闭环应用，
 * model_json 就是那份 five-system 模型，直接喂 buildDetailFromModel（证据满 6、
 * 不 blocked），得到的指标/身份/活渲染模型跟会话卡完全同源。
 */
export function deriveDetailFromAppRecord(modelJson: unknown, pagesJson?: unknown): AppCardDetail {
  // 空对象 {} 不算可运行模型——truthy 判定会让 LiveAppThumb 挂载空模型
  // 渲染（2026-07-27 审查修复 #14）。
  const model =
    modelJson && typeof modelJson === "object" && Object.keys(modelJson).length > 0
      ? (modelJson as FiveSystemModel)
      : null;
  return buildDetailFromModel(model, {
    evidenceCount: 6,
    blocked: false,
    // 记录里的 spec-first 整页 HTML（pages_json）；老记录没有 → null → 区块渲染
    specPages: extractSpecPages(pagesJson),
  });
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
    specPages: null, // 摘要不含页面本体（has_pages 只是一位布尔），拉到完整记录再升级
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
  T extends {
    item: { goal: string; summary?: { product_name?: string } | null };
    detail: AppCardDetail | null;
  },
>(items: T[], filter: GalleryFilter, query: string): T[] {
  const q = query.trim().toLowerCase();
  return items.filter(({ item, detail }) => {
    // 搜索同时匹配目标文本与产品名——复刻改名后卡片标题是新产品名,
    // 只搜 goal 会"按新名搜不到"（2026-07-27 审查修复）。
    const haystack = `${item.goal} ${detail?.identity?.productName ?? ""} ${
      item.summary?.product_name ?? ""
    }`.toLowerCase();
    if (q && !haystack.includes(q)) return false;
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

// E41：徽标 = 全线统一的门语言，不再另造"运行中/待补充"一套。
// dot 色在深色浮层上仍可辨。
//
// 2026-07-31 汉化（用户要求）：原文是 "closed 6/6" / "blocked"，跟旁边的
// 「推演中」混着排，一排筛选条两种语言。译法两条：
//   · blocked → 待补充 —— 见下。
//
// 2026-08-07 去掉 "6/6"（用户裁决："用户根本不关注这些，只会增加用户负担"）。
// 那个数字是六个 Skill（DataModel / Workflow / RBAC / Page / AIGC /
// AppBundle）的证据条数（判定见 buildDetailFromModel 里 `evidenceCount >= 6`）。
// 取舍讲清楚：**它只在"已闭环"这一支出现，而这一支恒等于 6/6** —— 所以它
// 从来没有承担过"还差几项"的信息量，那是「待补充」那一支的事。去掉不丢信息。
//   · blocked → 待补充 —— 跟未闭环占位图上那句「待补充信息」同一套说法，
//     不再一个叫 blocked、一个叫待补充。
const STATUS_META: Record<AppCardStatus, { label: string; cls: string; dot: string }> = {
  runnable: { label: "已闭环", cls: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-400" },
  awaiting: { label: "待补充", cls: "bg-amber-50 text-amber-700", dot: "bg-amber-400" },
  draft: { label: "推演中", cls: "bg-blue-50 text-[#1677ff]", dot: "bg-[#4d9aff]" },
};

/** 每页 12 张 = 一行 4 × 最多三行。我的应用滚到底再要；示例库走分页器。 */
export const GALLERY_PAGE_SIZE = 12;
const PAGE_SIZE = GALLERY_PAGE_SIZE;

/**
 * 这一页是不是满的——满了才继续向后要，短页就是到底了。
 * ⚠ 别写成 `>`：刚好 12 张是「还有可能有下一页」，写成 `>` 会在满页停住。
 */
export function pageLooksFull(received: number, pageSize: number = GALLERY_PAGE_SIZE): boolean {
  return received >= pageSize;
}

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
 * 首屏还没数据时的占位。
 *
 * GitHub Primer《Loading》大区标准答案（不是口味）：
 *   https://primer.style/product/ui-patterns/loading
 *   · 大块内容区只在区域中央放一个不确定进度指示器（Spinner）
 *   · 相邻的一簇内容共用一次加载宣告，禁止每张卡一个指示器
 *   · 不到约 300ms 先不画（SkeletonBox delay=short），闪一下反而显得慢
 *
 * ⚠ 2026-08-18 以前铺 8 张 16:9 空卡（对标 ToolJet AppList）。真墙是
 * 错落瀑布流，等大灰块对不上任何一张真卡，数据到了照样跳版；用户看见
 * 的就是一面假货架。那条「不跳版」在这条链路上不成立。
 */
const GALLERY_LOADING_DELAY_MS = 300;

function GalleryLoading({
  testid,
  label,
}: {
  testid: string;
  label: string;
}) {
  const [show, setShow] = React.useState(false);
  React.useEffect(() => {
    const timer = window.setTimeout(() => setShow(true), GALLERY_LOADING_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div
      data-testid={testid}
      className="mt-16 flex min-h-[240px] flex-col items-center justify-center"
      aria-busy="true"
    >
      {show ? (
        <>
          <span
            className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-[#5b6cff]"
            aria-hidden
          />
          <span role="status" className="mt-3 text-[13px] text-slate-400">
            {label}
          </span>
        </>
      ) : null}
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

// spec-first HTML 应用面（同源 iframe + DOMPurify + 填孔运行时）。DOMPurify
// 不该进应用中心首屏包——只有带 pages_json 的卡才需要它，同一套 lazy 纪律。
const LazyHtmlAppSurface = React.lazy(() =>
  import("@/pages/sliderule/live-runtime/html-app-surface").then(m => ({
    default: m.HtmlAppSurface,
  }))
);

// 只读预览模态用的整页舞台（缩放画布 + 填数徽标，切页走页面自己的菜单），
// 与推演右侧同一个组件。
const LazySpecPageStage = React.lazy(() =>
  import("@/pages/sliderule/live-runtime/SpecPageLiveStage").then(m => ({
    default: m.SpecPageLiveStage,
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
 *
 * 2026-07-30 追加**分批挂载**（requestMountPermit）。进视口只是拿到"该挂了"，
 * 真正挂哪一批由全局排队器决定。理由是实测：生产构建下同屏 14 张卡，最长
 * 单任务 4106ms——主线程连续堵四秒，这四秒里页面点不动滚不动。滚动本身全档
 * 稳在 60fps、20 张堆内存才 93MB，所以问题只在首屏挂载这一处，分批就能治，
 * 不需要虚拟化。详见 lib/mount-scheduler.ts 与 scripts/app-wall-perf.mjs。
 *
 * 两道闸串联的顺序要对：**先进视口、再排队**。反过来（先排队再看视口）会把
 * 滚动到很远处的卡也排进队里，白占许可名额。
 */
/**
 * 活渲染挂上之后，等多久再采集。
 *
 * 挂载完成 ≠ 画面就绪：echarts 要拿到容器尺寸后才画，表格与图标还有懒加载的
 * chunk。1500ms 是照 freeform 预览截图那条已经在生产验证过的路径取的同一个数
 * （Python 侧 _FREEFORM_PREVIEW_SCREENSHOT_JS_TEMPLATE 里的 waitForTimeout）。
 * 采早了拿到的是半渲染的画面，而它会被当成"这个应用长这样"存起来——比没有更糟。
 */
const CAPTURE_SETTLE_MS = 1500;

/**
 * 活渲染缩略图的双闸（LiveAppThumb / HtmlLiveThumb 共用）：
 *   闸一：进视口了吗（IntersectionObserver，rootMargin 200px 预热）；
 *   闸二：排到我了吗（requestMountPermit，全局批 3、批间 yield）。
 * 两个都过才挂真渲染。原先整套长在 LiveAppThumb 里，HTML 缩略图要同一套
 * 节流——抽出来共用而不是复制一份（复制必然分叉，本仓数过太多次）。
 */
function useThumbMountGate(): {
  wrapRef: React.RefObject<HTMLDivElement | null>;
  visible: boolean;
} {
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = React.useState(false);
  const [granted, setGranted] = React.useState(false);

  React.useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // 进了视口才排队（顺序见文件头）。清理函数必须取消排队——卡片在拿到许可前
  // 被卸载是常态（改搜索、翻页、切库），不取消就会对已卸载组件 setState。
  React.useEffect(() => {
    if (!inView) return;
    return requestMountPermit(() => setGranted(true));
  }, [inView]);

  return { wrapRef, visible: inView && granted };
}

function LiveAppThumb({
  sessionId,
  model,
  goal,
  captureFor,
  device,
}: {
  sessionId: string;
  model: FiveSystemModel;
  goal: string;
  /**
   * 采集回传的目标 app_id。传了就表示"这张卡是在活渲染，而这个应用还没有真
   * 截图"——渲染稳定之后就地采一张存住，于是这次活渲染是最后一次
   * （见 lib/thumb-capture.ts）。不传（会话卡、已经有图）就只渲染，不采集。
   */
  captureFor?: string | null;
  /** 应用档位，决定采集画幅。 */
  device?: string | null;
}) {
  const { wrapRef, visible } = useThumbMountGate();
  const [hiddenControls, setHiddenControls] = React.useState<HTMLDivElement | null>(null);

  // 渲染稳定之后采一张存住（缩略图三级来源的第一级，见 lib/thumb-capture.ts）。
  //
  // 时机：挂上之后再等 CAPTURE_SETTLE_MS。挂载完成 ≠ 画面就绪——echarts 要一帧
  // 去量容器再画，表格还有懒加载的 chunk。采早了会得到一张半渲染的图，而它会被
  // 当成"这个应用长这样"存起来，比没有更糟。
  //
  // 卸载即取消：滚出去、改搜索、翻页都会卸载这张卡，那时候再采就是对着已经拆掉
  // 的 DOM 采。节流与预算在 thumb-capture 里全局管，这里只管"什么时候可以采"。
  React.useEffect(() => {
    if (!visible || !captureFor) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled || !wrapRef.current) return;
      void captureAndUpload({ appId: captureFor, container: wrapRef.current, device });
    }, CAPTURE_SETTLE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [visible, captureFor, device]);

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
            // 宽度定缩放（2026-08-01 补）。**此前这里什么都没传，吃的是默认
            // 的 contain**——min(w/W, h/H)，卡片比例跟画布比例对不上时按更紧
            // 的那一边缩，另一边留边。
            //
            // 一直没暴露是因为两边比例恰好相等：卡片比例本来就是照
            // DEVICE_SPECS 抄的，contain 的两项算出来一样大，等于白留了个坑。
            // 卡片比例改成跟出图画布对齐（手机档 0.462 → 0.5625）之后坑就踩响
            // 了：手机档画布 390×844 装进 9:16 的卡，contain 按高度缩，实测
            // 宽度只铺到 **81.8%**，两侧各留一条灰边。
            //
            // 2026-08-03 画布也改成 9:16（405×720），两边又相等了，这个参数
            // 当下与 contain 等价。**仍然显式传**：等价是当前尺寸表的巧合，
            // 不是约定；哪张表再动一次，没传的那一边就会重新留边。
            //
            // "width" 模式就是为缩略图墙加的（见 ScaleFitMode 的说明与
            // dev-harness/AppWallPerfHarness——那边一直传着，所以压测台从来
            // 没复现过这个现象）。宽度铺满、高度按内容溢出后裁掉：缩略图看的
            // 是"这个应用长什么样"，顶部那一屏就够，留灰边反而更糟。
            scaleFit="width"
            // 缩略图不画缩放标识：9px 的字再缩到 21% 读不出来，而且会跟卡片
            // 底部那条信息浮层抢同一个右下角，叠成一块糊斑。
            showScaleBadge={false}
          />
        </React.Suspense>
      )}
    </div>
  );
}

/**
 * spec-first HTML 应用的活渲染缩略图（2026-08-14 应用中心接线）。
 *
 * 有 shot 时卡片走 SheetThumb，**不会挂到这里**。这里只是没图时的回落，
 * 以及回落发生时顺手采一张（captureFor）——SnapDOM 拍同源 iframe
 * （documentElement，不是父容器、也不是 body），不再采出一张空白。
 *
 * 08-14 曾把这一支排在 shot 前面：当时截图拍不到 iframe，存量 shot 还是
 * 接线前老区块渲染器的光板表格。拍框内文档之后那条理由不成立了，有图就贴图。
 *
 * 渲染仍过同一套双闸（视口 + 挂载调度），滚动时不齐射。
 *
 * 落地页取导航第一项（orderedSpecPages）——跟推演舞台/交付物的页序同源。
 * 填数走 deriveBindingSource(model, 种子运行时)。
 */
function HtmlLiveThumb({
  specPages,
  model,
  captureFor,
  device,
}: {
  specPages: SpecPagesDetail;
  model: FiveSystemModel | null;
  captureFor?: string | null;
  device?: string | null;
}) {
  const { wrapRef, visible } = useThumbMountGate();
  // 视口按设备选：桌面 1920×1080 / 手机 390×844（Playwright iPhone 14）。
  const viewport = specPageViewport(specPages.device);
  // 宽度定缩放（跟 LiveAppThumb 的 scaleFit="width" 同一条理由）：页面是照
  // 固定视口画的，卡片看顶部那一屏就够；contain 在 9:16 的手机档卡里会留大灰边。
  const { ref: fitRef, scale } = useScaleToFit(viewport.w, viewport.h, "width");
  const landing = React.useMemo(() => orderedSpecPages(specPages)[0] ?? null, [specPages]);
  const source = React.useMemo(
    () => deriveBindingSource(model, model ? seedRuntimeState(initRuntimeState(model), model) : null),
    [model]
  );

  React.useEffect(() => {
    if (!visible || !captureFor) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled || !wrapRef.current) return;
      void captureAndUpload({ appId: captureFor, container: wrapRef.current, device });
    }, CAPTURE_SETTLE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [visible, captureFor, device]);

  return (
    <div
      ref={wrapRef}
      className="pointer-events-none h-full w-full overflow-hidden bg-[#f0f2f5]"
      data-testid="app-thumb-html"
    >
      <div ref={fitRef} className="h-full w-full overflow-hidden">
        {visible && landing && (
          <React.Suspense fallback={<div className="h-full w-full bg-[#f0f2f5]" />}>
            <div
              style={{
                width: viewport.w,
                height: viewport.h,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
                overflow: "hidden",
                background: "#fff",
              }}
            >
              <LazyHtmlAppSurface html={landing.html} source={source} />
            </div>
          </React.Suspense>
        )}
      </div>
    </div>
  );
}

/**
 * 只读预览模态里的 HTML 应用面：与推演右侧同一个舞台组件
 * （SpecPageLiveStage：1920×1080 缩放画布 + 填数徽标，切页走页面自己的
 * 菜单），running=false、开屏落在导航第一页。运行时是**内存种子**、
 * 不传 onAction——只读预览既不该
 * 改数据，也不该在本机留痕（比 preview:{id} 命名空间做得更干净：连槽位都不占）。
 */
function SpecPagesPreview({
  specPages,
  model,
}: {
  specPages: SpecPagesDetail;
  model: FiveSystemModel | null;
}) {
  const runtime = React.useMemo(
    () => (model ? seedRuntimeState(initRuntimeState(model), model) : null),
    [model]
  );
  const pages = React.useMemo(() => {
    const ordered = orderedSpecPages(specPages);
    return ordered.map((p, i) => ({
      pageId: p.pageId,
      html: p.html,
      current: i + 1,
      total: ordered.length,
      bound: pageIsBoundFromSpec(p.pageId, specPages),
      // 竖屏应用在预览模态里也得进竖屏画布（SpecPageLiveStage 按它选视口）
      device: specPages.device,
    }));
  }, [specPages]);
  return (
    <React.Suspense
      fallback={<div className="p-6 text-[13px] text-slate-400">预览加载中…</div>}
    >
      <LazySpecPageStage
        pages={pages}
        running={false}
        model={model}
        runtime={runtime}
        defaultPageId={pages[0]?.pageId ?? null}
        className="h-full p-3"
      />
    </React.Suspense>
  );
}

/**
 * 这张卡该贴图还是走活渲染。
 *
 * 只有两个条件：是 App Store 卡（有 appId 才有图可取），且后端说它有图。
 * **不区分是哪一路的图**——真截图和参照板走的是同一个接口、同一套画幅，
 * 挑哪张是服务端的事（见 app_store 的 PREVIEW_SOURCE_PRIORITY）。前端多一个
 * 分支只会多一处要跟后端对齐的地方。
 *
 * has_preview 缺失（老后端不返回这个字段）按 false 处理 = 活渲染，也就是
 * 改动前的行为——**新能力缺席时退回旧行为，不是退化成空白**。
 *
 * 会话卡（source==="session"）不在此列：它们还没落进 App Store，没有 app_id
 * 也就没有那张图，只能活渲染。
 */
export function shouldUseSheetThumb(item: {
  appId?: string | null;
  summary?: { has_preview?: boolean } | null;
}): boolean {
  return Boolean(item.appId && item.summary?.has_preview);
}

/**
 * 贴图缩略图（2026-08-01 起用，取代绝大多数卡片上的活渲染）。
 *
 * ## 三级来源，这是第一、二级
 *
 * 服务端按可信度挑图，这个组件只管"有图就贴、拉不到就回落"：
 *
 *   ① shot  —— 应用真实渲染出来之后截的图，**就是应用本身**。由前端在活渲染
 *              那张卡上就地采集后回传（lib/thumb-capture.ts）——那次昂贵的渲染
 *              本来就要发生，采下来存住，它就成了最后一次。
 *   ② sheet —— 生成时为了让设计 LLM 有版式可参照，让生图模型画的那张首页
 *              参照板（freeform_block._generate_overview_sheet_b64）。画的就是
 *              这个应用首页长什么样，而且钱已经付过了。落库即有。
 *   ③ 活渲染 —— 两张都没有时的 fallback，也就是这个组件的 fallback 属性。
 *
 * ①② 都落在 generated_app_preview 表（一行两列，见 app_store）。两者画幅一致
 * （PC 1280×720 / 移动 720×1280），所以卡片不用关心贴的是哪一张。
 *
 * ## 为什么第三级要往后排
 *
 * LiveAppThumb 每张卡挂一个真的 AppRuntimeScreen（antd 表格 + echarts 全套）。
 * 它自己的注释记着实测——「生产构建下同屏 14 张卡，最长单任务 4106ms，主线程
 * 连续堵四秒」。分批挂载只是把这四秒摊开，总工作量一点没少。一张 <img> 的解码
 * 在合成线程，主线程零成本。
 *
 * 当初选活渲染的两条理由，贴图方案都躲开了：
 *   「永远最新、零缓存失效」——一条 generated_app 记录本身不可变（精修产生的
 *     是新 app_id，见 save_version），图跟着记录走；图本身会被回填换掉，靠
 *     URL 上的 ?v= 版本位跟上（见 appPreviewUrl）；
 *   「不用额外的存储/沙盒基建」——②用的是生成时已经产出的那张图，只多一张表；
 *     ①用的是本来就要跑的那次活渲染，不起沙盒、不加服务，只多一个回传接口。
 *
 * fail-open 两道：摘要没有 has_preview（老记录/老后端）压根不走这条路；走了
 * 但图拉不到（记录刚被删、网络抖）→ onError 回落 fallback，也就是活渲染。
 * **任何情况下都不会出现空白卡**。
 */
export function SheetThumb({
  appId,
  alt,
  fallback,
  previewTag,
}: {
  appId: string;
  alt: string;
  /** 图拉不到时回落到这个——传的就是原来那套活渲染/占位卡。 */
  fallback: React.ReactNode;
  /** 摘要里的 preview_tag，拼进 URL 当缓存版本位（见 appPreviewUrl）。 */
  previewTag?: string | null;
}) {
  const [failed, setFailed] = React.useState(false);
  // 换了一张卡（翻页/搜索复用同一个组件实例）要把失败态清掉，否则上一张的
  // 失败会让新的这张也直接走 fallback。回填让 tag 变了也要重试：上一次的失败
  // 是针对上一张图的，新图凭什么继承那个结论。
  React.useEffect(() => setFailed(false), [appId, previewTag]);
  if (failed) return <>{fallback}</>;
  return (
    <div
      className="pointer-events-none h-full w-full overflow-hidden bg-[#f0f2f5]"
      data-testid="app-thumb-sheet"
    >
      <img
        src={appPreviewUrl(appId, previewTag)}
        alt={alt}
        // 卡片比例跟出图画布是对齐的（见 lib/justified-rows 的 DEVICE_ASPECT），
        // 所以 cover 不会真的裁掉内容，只是吃掉取整产生的那一两个像素缝。
        className="h-full w-full object-cover"
        loading="lazy"
        decoding="async"
        // 首屏之外的卡不参与解码排队，跟 loading=lazy 是一组
        // eslint-disable-next-line react/no-unknown-property
        fetchPriority="low"
        onError={() => setFailed(true)}
        draggable={false}
      />
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
  mediaHeight,
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
  /** 卡片总高（px）。信息条浮在画面上，不再另占高度——见下方那段说明。 */
  mediaHeight?: number | string;
}) {
  return (
    <div
      data-testid={testid}
      title={titleAttr}
      // 2026-07-31：宽高比不再由卡片自己定死 16:9，改由**父容器**给。
      //
      // 2026-07-31 之二：信息层压在图上 → 排到图下 → **又改回压在图上**（用户裁决）。
      // 来回一趟不是反复，两次的约束不一样，记下来免得下次又绕：
      //
      //   挪到图下的理由是"压在图上时卡片有文字宽度下限"——手机档在 justified
      //   排法下只有 122px 宽，那排「页面 5 / 角色 4 / AI 3 / 状态」挤成两行。
      //   **但 justified 排法已经不在了**：现在是瀑布流，最窄列宽 260px、实测
      //   落到 308px，跨列卡 632px，122px 那个场景不会再出现，理由随之失效。
      //
      //   改回来的收益是实的：信息条不再另占一段高度，同样的卡片高度里画面能
      //   多显示一截应用——卡片墙的意义就是"一眼看出这个系统长什么样"。
      //
      // 压字必须保证在**任意应用截图**上都读得清：生成的应用有浅色仪表盘也有
      // 深色监控盘，所以用从下往上的黑色渐变（底部 85% 到顶部全透明）而不是
      // 一整块半透明——整块会在浅色截图上糊掉一条，渐变只压住文字那一带，
      // 上面的画面照常看得见。再叠一层 backdrop-blur 兜住高频花纹的底。
      className="group relative h-full w-full cursor-pointer overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm transition hover:border-[#1677ff]/60 hover:shadow-lg"
      style={{ height: mediaHeight }}
      onClick={onClick}
    >
      {/* 画面区：铺满整张卡 */}
      <div className="absolute inset-0 overflow-hidden">{media}</div>
      {topRight}
      {/* 信息条：浮在画面底部，不占卡片高度 */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/60 to-transparent px-3 pb-2 pt-7 backdrop-blur-[1px]">
        <div className="flex items-center gap-1.5">
          {Icon && (
            <span
              className="flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-[6px] text-white"
              style={{ background: iconBg }}
            >
              <Icon size={12} />
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-white drop-shadow-sm">
            {title}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-white/75">
          {metrics}
          <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 font-medium text-white/90">
            <span className={`h-1.5 w-1.5 rounded-full ${statusDot}`} />
            {statusLabel}
          </span>
        </div>
      </div>
    </div>
  );
}

/** 卡片墙一格的数据：应用条目 + 已解析的卡面细节（可能还没到）。 */
interface WallEntry {
  item: GalleryItem;
  detail: AppCardDetail | null;
}

/**
 * 卡片墙的列宽下限与间距。列数由 masonic 按容器宽度自己算，算完还会把列宽
 * **撑满**剩余空间（use-positioner.ts: columnWidth = (width - gutter*(n-1)) / n），
 * 所以这个值是「最窄能到多少」，不是最终列宽。
 *
 * 260 是量出来的下限，卡在信息区那排指标的换行点上：1600px 视口下可用宽
 * ~1300 → 4 列 × 309px，「页面 n · 角色 n · AI n · 时间 · 状态」正好一行。
 * 试过 240（5 列 × 244px），**每张卡**的状态都被挤到第二行，卡片凭空高一截，
 * 带 v4 徽标的那张更是折成三行——比 4 列难看。列数不是越多越好，宽度下限由
 * 信息区内容定。
 *
 * 屏幕再宽会自动加列（1920px → 5 列 × 308px），不用改这里。
 */
const WALL_COLUMN_WIDTH = 260;
const WALL_GUTTER = 16;

/**
 * 「我的应用」瀑布流。
 *
 * 滚动源：`<Masonry>` 内部是 `MasonryScroller` → `useScroller()` →
 * `@react-hook/window-scroll`，**写死 window**，视口高度取 `window.innerHeight`。
 * 本应用滚的是 `.native-content`，window 一格都不滚，scrollTop 会恒为 0
 * （详见 useScrollerIn.ts），所以这一层换成本地滚动容器。
 *
 * 渲染层：`useMasonry` 也不能用——它把每格宽度写死成全局列宽，跨列卡表达不出来。
 * 换成 SpanMasonry（自建渲染循环 + 跨列定位器），落位规则照搬 Pinterest gestalt
 * 的 multiColumnLayout。为什么非要跨列，见 app-wall-span.ts 顶部那段：卡片高度
 * 由设备宽高比算出，三档里桌面占 89%，不引入跨列的话整面墙的高度是**同一个数**。
 *
 * 仍然复用 masonic 的 `useContainerPosition` 与 `createIntervalTree`。
 *
 * 单独抽成组件而不是写在 AppsWorkbench 里，是因为这几个都是 hook——卡片墙
 * 在「空态/搜索无结果/有结果」三岔里只有一岔渲染，写在外层就成了条件调用。
 */
/**
 * 卡片一挂上（虚拟化进视口 / 隐藏量高）才去拉完整模型。
 * 开局用 4 个工人扫全表 getApp——2026-08-18 首页就是这样把全部应用一次加载完的。
 */
function GalleryCardGate({
  item,
  ensure,
  children,
}: {
  item: GalleryItem;
  ensure: (gi: GalleryItem) => void;
  children: React.ReactNode;
}) {
  const itemRef = React.useRef(item);
  itemRef.current = item;
  React.useEffect(() => {
    ensure(itemRef.current);
    // item 每轮渲染都是新对象，按 key 钉住，避免每帧重入 ensure。
  }, [item.key, ensure]);
  return <>{children}</>;
}

function AppWall({
  items,
  renderCard,
  onReachEnd,
  ensureDetail,
}: {
  items: WallEntry[];
  renderCard: (
    item: GalleryItem,
    detail: AppCardDetail | null,
    cellW: number,
    span: number,
  ) => React.ReactNode;
  onReachEnd?: () => void;
  ensureDetail: (gi: GalleryItem) => void;
}) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const { scrollTop, isScrolling, height } = useScrollerIn(containerRef);
  // width 要跟着容器走（侧栏收起、窗口缩放都会变），deps 给 height 让它重量。
  const { offset: _offset, width } = useContainerPosition(containerRef, [height]);

  // 跨列集合：追加下一页时冻结已落位卡的 span（masonry-append.ts），
  // 详情回来只换对象、key 不变，也不该重算。
  const spanMemo = React.useRef<{ keys: string[]; spans: Set<string> }>({
    keys: [],
    spans: new Set(),
  });
  const itemKeySig = items.map(e => e.item.key).join("\0");
  const spanKeys = React.useMemo(() => {
    const nextItems = items.map(e => e.item);
    const nextKeys = nextItems.map(it => it.key);
    const spans = appendStableSpanKeys(spanMemo.current.spans, spanMemo.current.keys, nextItems);
    spanMemo.current = { keys: nextKeys, spans };
    return spans;
    // itemKeySig 变了才重算；items 每轮都是新数组，不能当依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemKeySig]);

  return (
    <div data-testid="apps-wall" style={{ display: "contents" }}>
      <SpanMasonry<WallEntry>
        containerRef={containerRef}
        items={items}
        width={width}
        height={height}
        scrollTop={scrollTop}
        isScrolling={isScrolling}
        minColumnWidth={WALL_COLUMN_WIDTH}
        gutter={WALL_GUTTER}
        overscanBy={2}
        // 已落位的活缩略图不许随滚动卸挂。overscan 只管还要量谁。
        // 2026-08-18：overscanBy=2 按窗口裁切，滚出的 iframe 整卡重渲。
        retainPlaced
        // 首屏还没量到真实高度时用它估行数。桌面卡 260/1.78≈146 + 信息区 ≈52，
        // 手机卡 260/0.46≈563 + 52；取中间偏桌面一侧，因为桌面档占多数。
        itemHeightEstimate={240}
        itemKey={entry => entry.item.key}
        getSpan={(entry, _i, columnCount) =>
          spanForColumnCount(spanKeys.has(entry.item.key), columnCount)
        }
        className="mt-5"
        onReachEnd={onReachEnd}
        render={(entry, _i, cellW, columnCount) => (
          <GalleryCardGate item={entry.item} ensure={ensureDetail}>
            {renderCard(
              entry.item,
              entry.detail,
              cellW,
              spanForColumnCount(spanKeys.has(entry.item.key), columnCount),
            )}
          </GalleryCardGate>
        )}
      />
    </div>
  );
}

/** 官方示例（E41）：冻结过门模型的摘要投影（API 返回，全真数据）。 */
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
  const [tab, setTab] = React.useState<AppShelf>("market");
  // 登录态：决定复刻/删除按钮显不显示（真判定在后端）
  const { user: authUser, capabilities } = useAuth();
  const [filter, setFilter] = React.useState<GalleryFilter>("all");
  const [query, setQuery] = React.useState("");
  const [sortDesc, setSortDesc] = React.useState(true);
  const [menuFor, setMenuFor] = React.useState<string | null>(null);
  // 复刻改名弹框（对标 Budibase duplicateApp：预填「源名 副本」让用户改名）
  const [forkModal, setForkModal] = React.useState<{ item: GalleryItem; name: string } | null>(null);
  /**
   * 只读预览（2026-08-06）：点开**别人的**应用时用它，而不是往对方的会话里跳。
   *
   * 此前卡片点击一律 `open(item.sessionId)`——`canOpen` 只判了"有没有
   * sessionId"，没判"这条会话是不是你的"。于是点别人的应用会跳进对方的
   * 会话 URL，而会话按归属隔离（services/app_access.session_access），
   * GET /sessions/{id} 返回 404 → 页面一片空白，卡在"正在准备工作台"。
   * 用户实测原话："点击这个应用，跳转过去发现啥也没有空的"。
   *
   * 取的是 Gitea / Budibase 同一套动线：**看别人的东西是只读的，要改先
   * Fork 成自己的**。模型本来就在 details[key].model 里（活渲染缩略图用的
   * 就是它），所以预览不需要任何新接口，也不碰对方的会话。
   */
  const [previewModal, setPreviewModal] = React.useState<GalleryItem | null>(null);
  const [forkBusy, setForkBusy] = React.useState(false);
  const [forkError, setForkError] = React.useState<string | null>(null);
  const [page, setPage] = React.useState(1);
  const [appsHasMore, setAppsHasMore] = React.useState(false);
  const appsOffsetRef = React.useRef(0);
  const appsIdsRef = React.useRef(new Set<string>());
  const loadingMoreRef = React.useRef(false);
  const visibleOrderRef = React.useRef<string[]>([]);
  const aliveRef = React.useRef(true);
  const detailsRef = React.useRef<Record<string, AppCardDetail | null>>({});
  const inflightRef = React.useRef(new Set<string>());
  // E28：订阅会话库更新事件（侧栏删会话/新话题落盘）→ 重拉画廊
  const [reloadKey, setReloadKey] = React.useState(0);
  // E41 官方示例库（2026-08-14 起货架清空但功能保留；后端上架即恢复展示）
  const [examples, setExamples] = React.useState<BuiltinExample[]>([]);
  const [exampleCat, setExampleCat] = React.useState("全部");
  React.useEffect(() => {
    const bump = () => setReloadKey(k => k + 1);
    window.addEventListener(SESSIONS_UPDATED_EVENT, bump);
    return () => window.removeEventListener(SESSIONS_UPDATED_EVENT, bump);
  }, []);
  detailsRef.current = details;
  // 筛选口径变化 → 回第一页（分页器与滚动分页都回到开头）
  React.useEffect(() => {
    setPage(1);
    visibleOrderRef.current = [];
  }, [tab, filter, query, exampleCat, sortDesc]);

  React.useEffect(() => {
    let alive = true;
    aliveRef.current = true;
    appsOffsetRef.current = 0;
    appsIdsRef.current = new Set();
    inflightRef.current.clear();
    visibleOrderRef.current = [];
    setApps(null);
    setAppsHasMore(false);
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
    // 真实态：摘要按页拉（limit=12），会话列表仍是瘦列表。
    // 完整模型禁止在这里扫全表——按卡挂载走 ensureDetail（2026-08-18）。
    // App Store 失败 fail-open 空数组（画廊退化成纯会话卡，零回退）。
    void Promise.allSettled([
      listApps({ limit: PAGE_SIZE, offset: 0, scope: tab }),
      fetch("/api/sliderule/sessions").then(r =>
        r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))
      ),
    ]).then(([appsRes, sessRes]) => {
      if (!alive) return;
      const appList = appsRes.status === "fulfilled" ? appsRes.value : [];
      setApps(appList);
      appsOffsetRef.current = appList.length;
      appsIdsRef.current = new Set(appList.map(a => String(a.id || "")).filter(Boolean));
      setAppsHasMore(pageLooksFull(appList.length, PAGE_SIZE));
      if (sessRes.status === "fulfilled") {
        const sessionList = ((sessRes.value?.sessions ?? []) as SessionListItem[]).filter(
          (s: SessionListItem) => s.sessionId
        );
        setSessions(sessionList);
      } else {
        setSessions([]);
        setListError(String((sessRes.reason as Error)?.message ?? sessRes.reason));
      }
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
      aliveRef.current = false;
    };
    // reloadKey：会话库变更事件（侧栏删除/话题落盘）触发整体重拉，
    // 应用中心与左侧会话列表保持双向同步（E28）
  }, [reloadKey, tab]);

  const ensureDetail = React.useCallback((gi: GalleryItem) => {
    if (detailsRef.current[gi.key] !== undefined) return;
    if (inflightRef.current.has(gi.key)) return;
    inflightRef.current.add(gi.key);
    void (async () => {
      try {
        if (gi.source === "app" && gi.appId) {
          const rec = await getApp(gi.appId);
          if (!aliveRef.current) return;
          setDetails(prev => ({
            ...prev,
            [gi.key]: rec
              ? deriveDetailFromAppRecord(rec.model_json, rec.pages_json)
              : gi.summary
                ? deriveDetailFromAppSummary(gi.summary)
                : null,
          }));
        } else if (gi.sessionId) {
          const res = await fetch(`/api/sliderule/sessions/${encodeURIComponent(gi.sessionId)}`);
          const body = res.ok ? await res.json() : null;
          if (!aliveRef.current) return;
          setDetails(prev => ({
            ...prev,
            [gi.key]: body?.state ? deriveAppCardDetail(body.state) : null,
          }));
        }
      } catch {
        if (!aliveRef.current) return;
        setDetails(prev => ({
          ...prev,
          [gi.key]: gi.source === "app" && gi.summary ? deriveDetailFromAppSummary(gi.summary) : null,
        }));
      } finally {
        inflightRef.current.delete(gi.key);
      }
    })();
  }, []);

  const loadMoreApps = React.useCallback(async () => {
    if (loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    try {
      const offset = appsOffsetRef.current;
      const list = await listApps({ limit: PAGE_SIZE, offset, scope: tab });
      if (!aliveRef.current) return;
      const added = list.filter(a => {
        const id = String(a.id || "");
        return Boolean(id) && !appsIdsRef.current.has(id);
      }).length;
      setApps(prev => {
        const out = appendUniqueById(prev, list, a => String(a.id || ""));
        appsIdsRef.current = new Set(out.map(a => String(a.id || "")).filter(Boolean));
        return out;
      });
      appsOffsetRef.current = offset + list.length;
      // 满页但一条新身份都没有 = OFFSET 窗口在打转，再要只会 35→48。
      setAppsHasMore(pageLooksFull(list.length, PAGE_SIZE) && added > 0);
    } catch {
      if (aliveRef.current) setAppsHasMore(false);
    } finally {
      loadingMoreRef.current = false;
    }
  }, [tab]);

  const onWallReachEnd = React.useCallback(() => {
    // 推演中 / 待补充主要是会话卡，不必为筛选项把后面的应用页要齐。
    if (filter === "draft" || filter === "blocked") return;
    if (!appsHasMore) return;
    void loadMoreApps();
  }, [filter, loadMoreApps, appsHasMore]);

  const open = (sessionId: string) => {
    activateSession(sessionId);
    // Pages 子路径部署（/<repo>/）下绝对路径 404——带 BASE_URL 前缀
    const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
    window.location.href = `${base}/agent-loop/sliderule`;
  };

  /**
   * 开一个新会话：**先向服务端要 id**，拿到再跳（2026-08-06）。
   *
   * 以前是本地铸 id 直接跳，服务端只能被动接受客户端说的 id——熵只有 25 位，
   * 而且实测出过劫持漏洞（拿别人的 id 发一次 POST 就能夺走整条会话）。
   *
   * 失败**不静默回落到本地 id**：那等于把刚拆掉的弱路径又留个后门。真实原因
   * 通常是没登录（建会话已要求登录），如实提示比给个用不了的 id 强。
   */
  const openNewSession = () => {
    void (async () => {
      try {
        open(await createSessionId());
      } catch (e) {
        setListError(String(e instanceof Error ? e.message : e));
      }
    })();
  };

  const useTemplate = (example: BuiltinExample) => {
    try {
      localStorage.setItem(PENDING_TEMPLATE_INTENT_KEY, example.intent);
    } catch {
      /* 隐私模式无存储：仍然打开新会话，用户手动输入 */
    }
    openNewSession();
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
            // 还有剩的就切过去；一条不剩才向服务端要新的
            if (remaining[0]?.sessionId) activateSession(remaining[0].sessionId);
            else openNewSession();
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
    setForkError(null);
    setForkModal({ item: gi, name: `${baseName} 副本` });
  };

  /** 确认复刻：带新名调 fork_app 分新血缘（后端同步创建绑定会话，副本
   * 点开即可运行）。失败不再静默——弹框保持打开并显示原因（2026-07-27）。 */
  const confirmFork = async () => {
    const fm = forkModal;
    if (!fm?.item.appId || forkBusy) return;
    setForkBusy(true);
    const result = await forkApp(fm.item.appId, fm.name);
    setForkBusy(false);
    if (!result) {
      setForkError("复刻失败：源应用不存在或服务暂不可用，请稍后重试");
      return;
    }
    setForkError(null);
    setForkModal(null);
    setTab("mine");
    setReloadKey(k => k + 1);
  };

  // 合并两条数据源为画廊条目；详情按条目 key 索引，app 卡在模型加载前用摘要占位。
  // 切货架会把 apps 置 null 重拉。sessions 往往还在——若用「两边都空才算
  // 加载中」，市场/官方会闪一帧空态，我的应用还会把会话草稿卡先铺上去。
  const items: GalleryItem[] | null =
    apps === null
      ? null
      : mergeGalleryItems(apps, tab === "mine" ? sessions ?? [] : []);
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
  const visibleRaw = filterCards(paired, filter, query);
  // 下一页并进来时全表重排会把新卡插进第一页——顶部已落位的卡换 key。
  // 只多不少就冻结已露出的序（masonry-append.appendStableItems）。
  const visible = appendStableItems(visibleOrderRef.current, visibleRaw, p => p.item.key);
  visibleOrderRef.current = visible.map(p => p.item.key);
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
  // 「我的应用」滚动分页：墙吃已经拉到的全部卡（虚拟化自己裁视口），
  // 滚到底只向服务端要下一页。⚠ 别再加一层 shown+=12：shown 与 loaded
  // 对齐时 effect 会立刻再打一页，哨兵再喊一次，真机就是 12→24→35→48。
  // Pinterest gestalt Masonry 的 loadItems({ from }) 也是「缺哪页要哪页」，
  // 没有第二套窗口计数。示例库仍是网格 + 分页器。
  const totalItems = visibleExamples.length;
  const pagedExamples = visibleExamples.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const wallItems = visible;

  // ── 「我的应用」卡片墙（2026-07-31）──────────────────────────────────
  //
  // 走 **masonic**（jaredLunde，1406★）。为什么从 react-photo-album 换过来：
  //
  // 卡片改成「画面 + 图下信息区」之后，高度不再只由图片比例决定——信息区多高
  // 取决于标题会不会换行、几个计数标签。而 react-photo-album 的模型是
  // `height = columnWidth / ratio`（源码 masonry.ts），**结构上装不下图外文案**，
  // 只能把文案高度反算进假的宽高比里，脆且难维护。
  //
  // masonic 的定位器把高度当**输入**：
  //     set: (index, height) => { ...找最矮列...; items[index] = { left, top, height } }
  // 配 useResizeObserver 量真实 DOM 再回填（src/use-positioner.ts / use-resize-observer.ts）。
  // 图下文案多高都不用预先知道。
  //
  // 另外三个顺带的好处：
  //   · 列宽恒等 —— left = column * (columnWidth + gutter)，不像 photo-album 的
  //     columns 靠改列宽凑等高（实测三列差 27%，"排前面的看起来更大"是假暗示）
  //   · 直接渲染任意 React 子节点，不用再合成 src:"" 的假 Photo 绕开 <img>
  //   · 自带虚拟化（区间树 O(log n) 视口查询），应用数长起来不用重做
  //
  // 画面区高度仍按设备宽高比算——那部分是图，比例是真信息；信息区高度交给
  // 浏览器。两段相加就是卡片总高，masonic 自己量。
  //
  // 用低层 hook 拼装而不是开箱的 `<Masonry>`：后者的滚动源写死是 window，
  // 本应用滚的是 .native-content，详见 useScrollerIn.ts 顶部那段。

  // 卡片渲染抽成函数：定位器的 render 按 index 回调，拿不到 map 的闭包。
  // 只给 width——高度是**输出**不是输入，量完真实 DOM 再定位。
  const renderAppCard = (
    item: GalleryItem,
    detail: AppCardDetail | null,
    cellW: number,
    span = 1,
  ) => {
    // 卡片高度 = 本格宽度 / 设备宽高比。cellW 跨列时已经是两列的合并宽度，
    // 所以这里**不用**为跨列另算——同一个设备比例下，卡宽了画面就等比高，
    // 应用截图显示得更完整，正是给它两列的意义。
    //
    // 信息条改成浮在画面上之后，这个数就是**整张卡的高度**（此前还要再加一段
    // 信息区高度）。所以同一个宽度下卡片比之前矮一截，画面反而显示得更多。
    const mediaH = Math.round(cellW / aspectForDevice(item.summary?.device));
    const meta = detail ? STATUS_META[detail.status] : null;
    const BrandIcon = detail?.identity
      ? BRAND_LUCIDE[detail.identity.icon] ?? Boxes
      : undefined;
    // 活渲染缩略图的稳定 id：会话卡用 sessionId，App Store 卡无会话时用 appId。
    const thumbId = item.sessionId || item.appId || item.key;
    // 能不能进会话：**有 id 不等于进得去**。会话按归属隔离，别人的会话
    // GET 回来是 404，跳过去就是白屏。进不去的走只读预览（见 previewModal）。
    //
    // 两类卡的判据不一样，别合并：
    //   session 卡 —— 来自 GET /sessions，服务端**已经按归属过滤过**
    //                （filter_sessions），列出来的就是你的，直接可进。
    //   app 卡     —— 来自 GET /apps，公开应用人人可见，绑定的会话却是
    //                作者的。必须按 owner 判。
    const canOpen =
      Boolean(item.sessionId) &&
      (item.source === "session" || canWriteApp(item.summary?.owner_id ?? null, authUser));
    // 能不能复刻/删除。无主的存量应用除超管外谁都不能删——判成"谁都能删"
    // 等于权限一上线就把历史数据敞开（与后端 app_access 同一套规则）。
    const canFork = capabilities.can.fork;
    const canWrite = canWriteApp(item.summary?.owner_id ?? null, authUser);
    const isApp = item.source === "app";
    const version = item.version ?? 1;
    const rel = formatRelativeTime(item.lastActive ?? item.createdAt);
    return (
      <div
        data-testid={`app-cell-${item.sessionId || item.appId}`}
        data-tier={(item.summary?.device || "desktop").trim() || "desktop"}
        data-span={span}
        // 不写死高度：masonic 的 ResizeObserver 量的就是这个节点，写死等于
        // 把「高度由内容决定」这条又退回去了。宽度也不用给——masonic 的定位
        // 容器已经是 columnWidth，卡片 w-full 铺满即可。
      >
      <CenterCard
        mediaHeight={mediaH}
        testid={`app-card-${item.sessionId || item.appId}`}
        title={detail?.identity?.productName || item.goal || "（未命名话题）"}
        titleAttr={item.goal}
        Icon={BrandIcon}
        iconBg={detail?.identity ? themePrimary(detail.identity.theme) : undefined}
        media={(() => {
          // 回落链：贴图 → 活渲染 → 占位卡。有图就贴 <img>，不要给每张卡
          // 挂一个 Tailwind iframe（2026-08-20：应用市场同屏几十张活渲染
          // 把主线程打满；推演收口会 SnapDOM 存一张 shot）。
          //
          // 贴图这一级内部还有两路（真截图优先于参照板），但那是服务端的事：
          // 同一个 URL、同一套画幅，这里看到的只有"有图/没图"。
          //
          // 活渲染那一支带上 captureFor：**没有真截图的应用，在这次昂贵的渲染
          // 上就地采一张存住**，于是这次活渲染是最后一次
          // （见 lib/thumb-capture.ts）。已经有真截图的（preview_source==="shot"）
          // 不再采——那正是这套东西要消灭的重复劳动。
          const needsShot =
            Boolean(item.appId) && item.summary?.preview_source !== "shot";
          const htmlLive = detail?.specPages ? (
            <HtmlLiveThumb
              specPages={detail.specPages}
              model={detail.model}
              captureFor={needsShot ? item.appId : null}
              device={item.summary?.device}
            />
          ) : null;
          const blockLive =
            detail?.status === "runnable" && detail.model ? (
              <LiveAppThumb
                sessionId={thumbId}
                model={detail.model}
                goal={item.goal}
                captureFor={needsShot ? item.appId : null}
                device={item.summary?.device}
              />
            ) : (
              <PendingAppThumb detail={detail} />
            );
          const live = htmlLive ?? blockLive;
          if (shouldUseSheetThumb(item)) {
            return (
              <SheetThumb
                appId={item.appId!}
                alt={detail?.identity?.productName || item.goal || "应用首页示意"}
                fallback={live}
                previewTag={item.summary?.preview_tag}
              />
            );
          }
          if (htmlLive) return htmlLive;
          // 摘要说有页面、完整记录还没拉到：空一拍等详情，避免先挂错渲染器。
          if (!detail && item.summary?.has_pages) {
            return <div className="h-full w-full bg-[#f0f2f5]" data-testid="app-thumb-html-pending" />;
          }
          return blockLive;
        })()}
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
                  // 信息条改成压在深色渐变上之后，浅底深字的徽标在这里反了；
                  // 改成半透明白底白字，跟旁边那排指标同一套明度关系。
                  className="inline-flex items-center rounded bg-white/20 px-1.5 text-[10px] font-semibold text-white"
                  title="改版次数（App Store 血缘）"
                >
                  v{version}
                </span>
              )}
              {rel && (
                <span
                  className="inline-flex items-center text-white/60"
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
        // 进不去会话不再是"点了没反应"——那和白屏一样让人以为坏了。
        // 有模型或有整页 HTML 就开只读预览，两样都没有才真的不响应。
        onClick={() =>
          canOpen
            ? open(item.sessionId!)
            : detail?.model || detail?.specPages
              ? setPreviewModal(item)
              : undefined
        }
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
                {/* 2026-08-02：按登录态与归属显隐。
                    ⚠️ 这只是**不显示注定失败的按钮**，不是权限判定——真正的判定
                    在后端每个写接口里（Python 侧 app_access.require）。审查那套
                    RBAC 后台时它的字段权限就是只藏了前端、后端照样全返回。*/}
                {isApp && (
                  <button
                    data-testid={`app-fork-${item.appId}`}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                    disabled={!canFork}
                    title={canFork ? undefined : "登录后可复刻"}
                    onClick={() => openForkModal(item)}
                  >
                    <GitBranch size={13} /> 复刻到我的应用
                  </button>
                )}
                {isApp && canWrite && (
                  <button
                    data-testid={`app-visibility-${item.appId}`}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] text-slate-600 hover:bg-slate-50"
                    onClick={() => {
                      const next =
                        item.summary?.visibility === "private" ? "public" : "private";
                      void (async () => {
                        const ok = await patchApp(item.appId!, { visibility: next });
                        if (ok) setReloadKey(k => k + 1);
                        setMenuFor(null);
                      })();
                    }}
                  >
                    {item.summary?.visibility === "private" ? (
                      <><Globe size={13} /> 设为公开</>
                    ) : (
                      <><Lock size={13} /> 设为私有</>
                    )}
                  </button>
                )}
                {isApp && authUser?.isSuperuser && (
                  <button
                    data-testid={`app-official-${item.appId}`}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] text-slate-600 hover:bg-slate-50"
                    onClick={() => {
                      const next = !item.summary?.is_official;
                      void (async () => {
                        const ok = await patchApp(item.appId!, { is_official: next });
                        if (ok) setReloadKey(k => k + 1);
                        setMenuFor(null);
                      })();
                    }}
                  >
                    <Sparkles size={13} />
                    {item.summary?.is_official ? "从官方交还" : "移交到官方应用"}
                  </button>
                )}
                {canWrite && (
                  <button
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] text-red-500 hover:bg-red-50"
                    onClick={() => void removeCard(item)}
                  >
                    <Trash2 size={13} /> 删除应用
                  </button>
                )}
              </div>
            )}
          </>
        }
      />
      </div>
    );
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
      className="min-h-full bg-[var(--sr-shell-bg,#fff)] px-6 py-5 md:px-8 md:py-6"
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
      {/*
        吸顶（2026-07-31）：标题/搜索/tab/筛选整块钉在滚动容器顶部，只让卡片墙滚。
        19 个应用往下翻几行，筛选 chip 就滚没了——想换个筛选口径得先滚回顶部。

        实现要点：
        · 滚动容器是 .native-content（dashboard.css 里 overflow:auto），sticky
          就是相对它定位，不需要额外包一层。
        · 负 margin + 同值 padding 把根节点的 px/py 抵掉再补回来，让吸顶块的
          背景**铺满整宽**；否则卡片会从左右内边距那两条缝里透出来。
        · 背景必须显式给（跟根节点同一个 shell 变量），sticky 元素默认透明，
          卡片会直接从字底下穿过去。
        · z-30 高于卡片菜单(z-10)与健康浮层(z-20)：健康浮层本身在这块里面，
          跟着一起吸顶，不会被卡片盖住。
      */}
      <div className="sticky top-0 z-30 -mx-6 -mt-5 bg-[var(--sr-shell-bg,#fff)] px-6 pt-5 pb-3 md:-mx-8 md:-mt-6 md:px-8 md:pt-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="flex min-w-0 shrink-0 items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg text-[#5b6cff]">
            <LayoutGrid size={18} strokeWidth={2.2} />
          </span>
          <h1 className="text-[18px] font-bold tracking-tight text-slate-900 md:text-[20px]">
            {tab === "market" ? "应用市场" : tab === "official" ? "官方应用" : "我的应用"}
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
              tab === "market"
                ? "搜索公开应用…"
                : tab === "official"
                  ? "搜索官方应用…"
                  : "搜索我的应用…"
            }
            className="w-full rounded-lg border-0 bg-white/70 py-2.5 pl-10 pr-4 text-[13px] text-slate-800 outline-none ring-1 ring-slate-200/60 placeholder:text-slate-400 transition focus:bg-white focus:ring-2 focus:ring-[#5b6cff]/25"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          {/* 服务状态：**正常时不显示**（2026-08-07，用户裁决"用户根本不关注
              这些，只会增加用户负担"）。
              没有整条删掉，是因为"负担"这个理由只成立于正常态——后端真挂了
              的时候，这一格是用户唯一能看到的解释，否则只能看到一连串莫名其妙
              的失败。所以：健康 → 隐藏，异常/检查中/静态演示 → 照常出现。 */}
          {(IS_GITHUB_PAGES || overall !== true) && (
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
          )}
          <button
            type="button"
            data-testid="apps-create-new"
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#5b6cff] px-4 py-2.5 text-[13px] font-semibold text-white shadow-[0_4px_14px_rgba(91,108,255,0.28)] transition hover:bg-[#4a5aef] active:scale-[0.98]"
            onClick={openNewSession}
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
            { key: "market" as const, label: "应用市场", count: tab === "market" ? paired.length : undefined },
            { key: "mine" as const, label: "我的应用", count: tab === "mine" ? paired.length : undefined },
            { key: "official" as const, label: "官方应用", count: tab === "official" ? paired.length : undefined },
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
            {typeof t.count === "number" && (
            <span
              className={`tabular-nums text-[11px] ${
                tab === t.key ? "text-[#3b5bdb]/80" : "text-slate-400"
              }`}
            >
              {t.count}
            </span>
            )}
          </button>
        ))}

        <span className="mx-1 hidden h-4 w-px bg-slate-200 sm:inline-block" />

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
          label={STATUS_META.runnable.label}
          count={counts.runnable}
          active={filter === "runnable"}
          onClick={() => setFilter("runnable")}
        />
        <StatChip
          icon={<Hourglass size={13} className="text-orange-400" />}
          // 筛选条与卡片徽标读同一份 STATUS_META：此前两处各写一份字面量，
          // 改文案漏掉一处就会出现"筛选叫 blocked、卡片叫待补充"。
          label={STATUS_META.awaiting.label}
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
      </div>
      </div>

      {/* ===== 三个货架共用卡片墙 ===== */}
      {listError ? (
          <div className="mt-8 text-[13px] text-red-500">会话列表拉取失败：{listError}</div>
        ) : items == null ? (
          <GalleryLoading testid="apps-skeleton" label="正在加载应用" />
        ) : visible.length === 0 && appsHasMore ? (
          <GalleryLoading testid="apps-skeleton-more" label="正在加载应用" />
        ) : visible.length === 0 ? (
          paired.length === 0 ? (
            // 首次空态（对标 ToolJet BlankPage）：插画 + 引导 + 创建 CTA
            <div className="mt-10 flex flex-col items-center text-center" data-testid="apps-empty-first">
              <EmptyGalleryArt />
              <div className="mt-4 text-[15px] font-semibold text-slate-800">
                {tab === "market" ? "还没有公开应用" : tab === "official" ? "还没有官方应用" : "还没有应用"}
              </div>
              <div className="mt-1 text-[13px] text-slate-500">
                {tab === "mine"
                  ? "描述你想要的系统，让 AI 推演出你的第一个应用"
                  : tab === "official"
                    ? "超管可以把应用移交给面团官方，出现在这里"
                    : "公开的应用会出现在这里，也可以从官方应用复刻一份到我的应用"}
              </div>
              <button
                data-testid="apps-empty-create"
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-[#5b6cff] px-5 py-2.5 text-[13px] font-semibold text-white shadow-[0_4px_14px_rgba(91,108,255,0.28)] transition hover:bg-[#4a5aef] active:scale-[0.98]"
                onClick={openNewSession}
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
          <AppWall
            // key 跟着筛选走：定位器的高度缓存按 index 存，换了数据集不重建的话
            // 会拿旧高度去摆新卡片。数量变化不进 key——那是滚动分页追加的正常情形，
            // 重建会把已量到的高度全丢掉，追加一批就整墙闪一次。
            key={`wall-${tab}-${filter}-${query}`}
            items={wallItems}
            renderCard={renderAppCard}
            onReachEnd={onWallReachEnd}
            ensureDetail={ensureDetail}
          />
        )}

      {/* 只读预览：点开别人的应用走这里，不进对方的会话（见 previewModal 的说明）。
          渲染器就是活渲染缩略图用的那一个，模型也是同一份，只是不再缩到卡片里。 */}
      {previewModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 sm:p-8"
          data-testid="app-preview-modal"
          onClick={() => setPreviewModal(null)}
        >
          <div
            className="flex h-full w-full max-w-[1500px] flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 px-4 py-2.5">
              <span className="truncate text-[14px] font-semibold text-slate-900">
                {details[previewModal.key]?.identity?.productName ||
                  previewModal.summary?.product_name ||
                  previewModal.goal ||
                  "应用预览"}
              </span>
              <span className="shrink-0 rounded bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
                只读预览
              </span>
              <div className="ml-auto flex shrink-0 items-center gap-2">
                {/* 想改就 Fork 一份成自己的——这是这条动线的出口，
                    别让用户在只读页里找不到下一步。 */}
                <button
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#5b6cff] px-3 py-1.5 text-[12.5px] font-semibold text-white transition hover:bg-[#4a5aef] disabled:opacity-40"
                  disabled={!capabilities.can.fork || previewModal.source !== "app"}
                  title={capabilities.can.fork ? undefined : "登录后可复刻"}
                  onClick={() => {
                    const gi = previewModal;
                    setPreviewModal(null);
                    openForkModal(gi);
                  }}
                >
                  <GitBranch size={13} /> 复刻到我的
                </button>
                <button
                  className="rounded-lg px-2.5 py-1.5 text-[12.5px] text-slate-500 transition hover:bg-slate-100"
                  onClick={() => setPreviewModal(null)}
                >
                  关闭
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden bg-[#f0f2f5]">
              {details[previewModal.key]?.specPages ? (
                // spec-first 应用：预览的就是交付的那几页 HTML（与推演舞台
                // 同一个组件、同一份页面），不再拿区块渲染器另画一份。
                <SpecPagesPreview
                  specPages={details[previewModal.key]!.specPages!}
                  model={details[previewModal.key]!.model}
                />
              ) : (
                <React.Suspense
                  fallback={<div className="p-6 text-[13px] text-slate-400">预览加载中…</div>}
                >
                  <LazyAppRuntimeScreen
                    model={details[previewModal.key]!.model!}
                    // 运行期状态（种子数据的增删改、当前角色）按这个 key 存本地。
                    // **不能用对方真实的 sessionId**：在预览里点两下"新建"，
                    // 就会把痕迹写进人家会话的本地状态槽位里。给预览一个独立
                    // 命名空间，关掉即弃。
                    sessionId={`preview:${previewModal.appId || previewModal.key}`}
                    appTitle={previewModal.goal}
                    scaleFit="width"
                  />
                </React.Suspense>
              )}
            </div>
          </div>
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
            {forkError && (
              <div
                data-testid="fork-error"
                className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-600"
              >
                {forkError}
              </div>
            )}
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
