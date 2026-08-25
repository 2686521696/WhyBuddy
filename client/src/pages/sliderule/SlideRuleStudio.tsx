/**
 * SlideRuleStudio — 统一页主布局容器（对话 / 舞台可拖可折，默认对话栏 = 侧栏×2）
 *
 * 左侧：Chat 对话区（ClaudeChatSurface，含唯一空态：问候 + Cursor 卡片输入 + chips + 灵感卡）。
 *
 * 分栏默认：桌面对话栏 = 左侧菜单 ×2；手机把同一宽度锁给预览列且不可拖。
 *
 * 右侧主舞台——四态：
 *   pages   — **成品面**：spec-first 那条链路产出的 HTML 页面，装在
 *             1920×1080 的等比缩放画布里（见 live-runtime/canvas-scale.tsx）。
 *             推演中逐页到达就开始渲染，跑完继续由它接管，中途不换面孔；
 *   theater — 跑完但没有成品页（spec-first 没交出 HTML），右侧是接线沙盘；
 *   live    — 推演已开始但一页都还没交出来，占位报"推演中 + 当前步骤"，
 *             不重复左栏直播流；
 *   board   — 尚无可看产出：C4 L2 沙盘/架构图。六个系统是图上的组，
 *             不是顶栏；点组或游标打开抽屉。AppBundle 只做 Checks。
 * 六系统屏不再是并列切屏，而是抽屉承载的透视层（全部保留）。
 *
 * ⚑ 2026-08-14：原来那个 `app` 态（AppRuntimeScreen 区块渲染）**已从本页下架**
 *   ——用户裁决：跑完之后只认新链路的页面。理由与代价写在下面 stage 那处，
 *   AppRuntimeScreen 本身没删，应用中心仍可能用它；会话页舞台不再走它。
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import type { SkillId } from "@/lib/sliderule-marathon-driver";
import type { PublishClosureSummary } from "./derive-cross-runtime-summary";
import { ArchitectureStage } from "./ArchitectureStage";
import { ActiveSystemScreen } from "./system-screens/ActiveSystemScreen";
import {
  deriveSettledFiveSystemModel,
  normalizeRoles,
  parsePartialFiveSystemModel,
  type SkillRuntimeGraphLike,
} from "./system-screens/five-system-model";
import {
  SpecPageLiveStage,
  type SpecPageLive,
} from "./live-runtime/SpecPageLiveStage";
import { SpecPageCanvasStage } from "./live-runtime/SpecPageCanvasStage";
import { AppStageErrorBoundary } from "./live-runtime/AppStageErrorBoundary";
import { livePagesFromSpec } from "./spec-live-pages";
import {
  applyHtmlWorkflowAction,
  initRuntimeState,
  type RuntimeState,
} from "./live-runtime/live-runtime";
import { deriveHtmlActionGates } from "./live-runtime/rbac-preview";
import { isWorkflowActionKind } from "./live-runtime/html-binding-runtime";
import { seedRuntimeState } from "./live-runtime/demo-seed";
import {
  loadRuntimeState,
  saveRuntimeState,
  notifyRuntimeChanged,
  loadRuntimeRole,
  saveRuntimeRole,
  notifyRoleChanged,
  subscribeRoleChanged,
} from "./live-runtime/runtime-persistence";
import { message } from "antd";
import {
  RecordFormDrawer,
  type RecordActionRequest,
} from "./live-runtime/RecordFormDrawer";
import { RollingText } from "./RollingText";
import { deriveAppRuntimeSchema } from "./live-runtime/app-runtime-schema";
import {
  XrayPanel,
  htmlBindingToXrayTarget,
  type XrayTarget,
} from "./XrayPanel";
import { ChevronDown, Crosshair, MousePointerClick, X } from "lucide-react";
import { ClickEditStage } from "@/pages/agent-loop/dashboard/ClickEditStage";
import { getGeneratedAppForSession } from "@/pages/agent-loop/dashboard/app-store-client";
import { StudioSplit } from "./StudioSplit";
import { useStudioLayout } from "./StudioLayoutContext";
import { isStagePageShown } from "./studio-layout";
import { StudioLandingShot } from "./studio-landing-shot";
import { StudioShareToggle } from "./StudioShareToggle";
import { HomeHoverDots } from "./home-hover-dots";

/**
 * 推演页底色 + 点阵。子栏必须透底，否则实心 --sr-shell-bg 会把点挡住
 * （2026-08-20：点阵先挂欢迎页，用户要把同一套铺到 /agent-loop/sliderule
 * 开聊后的对话栏和舞台留白。挂在 ClaudeChatSurface 空线程上，舞台一出现
 * 就被卸掉；挂 Studio 再铺实心底，等于没挂）。
 */
function StudioChrome({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <div
      className={`relative h-full w-full overflow-hidden bg-[var(--sr-shell-bg,#f4f4f6)] ${className}`}
    >
      <HomeHoverDots />
      <div className="relative z-10 h-full w-full overflow-hidden">{children}</div>
    </div>
  );
}

const XRAY_PREF_KEY = "sliderule:xray-on";
const STAGE_VIEW_PREF_KEY = "sliderule:stage-view";

/** 档位偏好读写。隐私模式下存不了不影响开关本身工作（跟游标同一写法）。 */
function loadStageViewPref(): string {
  try {
    return localStorage.getItem(STAGE_VIEW_PREF_KEY) || "";
  } catch {
    return "";
  }
}
function saveStageViewPref(v: string): void {
  try {
    localStorage.setItem(STAGE_VIEW_PREF_KEY, v);
  } catch {
    /* 隐私模式：不记就不记 */
  }
}

/** 抽屉标题：系统的中文名（游标语境下不再用英文胶囊） */
const SKILL_LABELS: Record<SkillId, string> = {
  dataModel: "数据模型",
  workflow: "工作流",
  rbac: "角色权限",
  page: "页面",
  aigc: "AI 能力",
  appBundle: "发布检查",
};

interface SlideRuleStudioProps {
  /** E29 模型版本史（前进/回退按钮数据源） */
  modelVersions?: Array<{ id: string; instruction?: string; createdAt?: string }>;
  currentModelVersionId?: string | null;
  onRestoreVersion?: (versionId: string) => void;
  /** 版本切换请求在飞：两个按钮都置灰。缺省 false（老调用点行为不变）。 */
  isRestoringVersion?: boolean;
  // --- Chat panel (left) ---
  chatSlot: React.ReactNode;

  // --- Right panel data ---
  activeSkillId: SkillId | null;
  publishClosure?: PublishClosureSummary | null;
  /** Latest mermaid string from an SSE skill_result event */
  latestMermaid?: string | null;
  /** Per-skill raw content accumulated from SSE skill_result events */
  skillContents?: Partial<Record<SkillId, string>>;
  /** Persisted cross-skill runtime graph (python /drive-full projection) */
  skillRuntimeGraph?: SkillRuntimeGraphLike | null;
  /** 试运行（浏览器运行时）状态的持久化命名空间 */
  sessionId?: string;
  /** 运行应用标题（话题名） */
  appTitle?: string;

  /** 右侧主舞台是否显示。空会话（用户还没输入）时隐藏——欢迎页独占全宽，
   *  不摆一排空壳看板；首条消息发出后舞台才登场。默认 true。 */
  stageVisible?: boolean;

  /** 推演进行中（驱动一轮消息期间）。 */
  isRunning?: boolean;
  /** LLM 实时输出（llm_delta 累积）+ 来源标签。推演中右侧舞台实时消费：
   *  五系统起草的部分 JSON 能拼出页面时应用实时长出来；拼不出时只报
   *  "推演中"（实时想法由左栏流出，不重复）。 */
  llmDraft?: string;
  llmDraftLabel?: string | null;
  /** 当前步骤的一句话状态（如"正在分析风险"）——live 态副标题，
   *  给右侧一个"活着"的锚点，但不重复左栏的完整直播流。 */
  liveActionLabel?: string | null;
  /** spec-first 第 3 步逐页产出的 HTML（2026-08-14）。
   *
   *  有页面时 live 态不再是三个点，而是把页面直接渲染出来——那四五分钟的
   *  转圈不是"还没算出来"，是"算出来了没往外发"。
   *
   *  ⚠ 这不推翻 2026-07-14 那条"执行期不看中间过程"：那条说的是系统屏 /
   *  证据看板 / 起草 JSON，**过程的碎片**；这里上屏的是成品页面本身，
   *  跟最后交付的是同一份 HTML。 */
  specPages?: SpecPageLive[];
  /** 落库的 spec-first 产物（刷新之后的唯一来源）：
   *  {version, pages: {pageId: html}, navItems, boundPages}。
   *
   *  ⚠ 跟 specPages 不是二选一，是**同一份东西的两个来源**：推演中走 SSE
   *  逐页到达，跑完/刷新之后走这份。合并逻辑在下面一处做完，别在两处判。 */
  specFirstPages?: {
    pages?: Record<string, string>;
    navItems?: unknown[];
    device?: "desktop" | "phone";
    boundPages?: number;
    failedPages?: Record<string, unknown> | null;
  } | null;

  className?: string;
  /** 舞台头条右侧：隐藏页面 / 最大化 / 交付物。不另占整页顶栏。 */
  chromeSlot?: React.ReactNode;
  /**
   * 舞台头条**标题左侧**：重置会话那颗蓝钮。
   *
   * ⚠ 2026-08-24：单开一个槽而不是塞进 chromeSlot，就是为了让它落在标题**前面**。
   * 合回 chromeSlot 会把它冲回右侧图标簇——那正是用户这次反馈"看不见/分不清"的原因。
   * 舞台没起来的那几支（空会话 / 推演中 / 沙盘面）没有标题行可挂，仍与 chromeSlot
   * 同排渲染，保证任何一屏都够得着重置。
   */
  resetSlot?: React.ReactNode;
}

export function SlideRuleStudio({
  chatSlot,
  activeSkillId,
  publishClosure,
  latestMermaid,
  skillContents,
  skillRuntimeGraph,
  sessionId,
  appTitle,
  stageVisible = true,
  isRunning = false,
  llmDraft = "",
  llmDraftLabel = null,
  liveActionLabel = null,
  specPages = [],
  specFirstPages = null,
  className = "",
  modelVersions = [],
  currentModelVersionId = null,
  onRestoreVersion,
  isRestoringVersion = false,
  chromeSlot,
  resetSlot,
}: SlideRuleStudioProps) {
  const layout = useStudioLayout();
  // 顶栏「隐藏页面」必须卸掉右侧舞台，不是把宽度收成 0。
  // 2026-08-18 真机：左边那个图标不要；右边这个控制页面显隐。
  const showStage = isStagePageShown(stageVisible, !!layout?.stagePageHidden);

  // SSE 当前 skill 不再切屏，只给沙盘描边（没有成员级 flow 证据就不编路径）。

  // 五系统模型在此解析一次：舞台判定（能否运行应用）+ 抽屉/游标共享
  const settledModel = useMemo(
    () =>
      deriveSettledFiveSystemModel(
        skillContents ?? {},
        publishClosure?.perSkillEvidence
      ),
    [skillContents, publishClosure?.perSkillEvidence]
  );

  // 起草中的部分模型：五系统 JSON 还在流式生成时容错解析（每 +300 字符重解一次，
  // 避免逐 delta 重渲染）。仅实时预览——最终真实模型仍以闭环证据为准。
  const isDraftingModel =
    isRunning && llmDraftLabel === "five-system-model" && !!llmDraft;
  const draftParseKey = isDraftingModel
    ? Math.floor(llmDraft.length / 300)
    : -1;
  const draftModel = useMemo(
    () => (isDraftingModel ? parsePartialFiveSystemModel(llmDraft) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 按长度桶节流重解
    [isDraftingModel, draftParseKey]
  );

  const fiveSystemModel = settledModel ?? draftModel;
  const modelIsDraft = !settledModel && !!draftModel;
  // 两个来源合并成一份：推演中走 SSE 逐页到达（specPages），跑完/刷新之后
  // 走落库的那份（specFirstPages）。
  //
  // ⚠ **落库的那份优先**：它是第 6.5 步打完孔、外壳统一之后的成品；
  //   SSE 那份是第 3 步的素颜页。两份同 pageId 时拿素颜页覆盖成品，
  //   等于把做完的活儿退回去——而且不会有任何一处报错。
  const livePages = useMemo<SpecPageLive[]>(
    () => livePagesFromSpec(specFirstPages, specPages),
    [specFirstPages, specPages]
  );
  const stageDevice =
    livePages.find(p => p.device)?.device ?? specFirstPages?.device;
  const isPhoneStage = stageDevice === "phone";

  /**
   * 点选编辑（2026-08-24）——用户原话纠偏："编辑要挂在会话这一个入口，不是
   * 首页"。首页应用中心的只读预览就该是只读的（此前那版接错地方了，已经
   * 撤掉），能手动点选编辑的只有这里：会话自己的舞台，编辑的就是这一轮
   * 正在看的这份页面。
   *
   * appId 不是 props 传的——会话不一定已经落库成应用（推演没跑完/还没存），
   * 这里自己按 sessionId 去问一次 `GET /sessions/:id/generated-app`（跟
   * 应用中心拉"会话背后的应用"同一条接口）。isRunning 进依赖：一轮推演跑完
   * 很可能是第一次落库或又存了新版，那一刻重新问一次，编辑按钮才会从灰
   * 变亮，不用刷新页面。
   */
  const [boundAppId, setBoundAppId] = useState<string | null>(null);
  useEffect(() => {
    if (!sessionId) {
      setBoundAppId(null);
      return;
    }
    let alive = true;
    getGeneratedAppForSession(sessionId).then(summary => {
      if (alive) setBoundAppId(summary?.id ?? null);
    });
    return () => {
      alive = false;
    };
  }, [sessionId, isRunning]);

  const [editMode, setEditMode] = useState(false);
  const [editDirty, setEditDirty] = useState(false);
  // 点选编辑存成功之后的页面覆盖层，叠在 livePages 上面显示——不这样做的话
  // 退出编辑态会看着"改动消失了"（其实是存库了，只是这份内存态没跟上，
  // 要等下一次 SSE/落库刷新才会看见），那是本仓最忌的"闸绿但东西看着没了"。
  //
  // ⚠ 2026-08-24 真机验证时踩到、但确认不是 bug 的一点：这层覆盖对**打过孔
  // 的字段**（`data-field`/`data-record` 这类 BINDING_ATTRS）不生效——退出
  // 编辑态之后 HtmlAppSurface 的 applyBindings 会用真实数据把内容重新填一遍，
  // 盖掉刚编辑的模板文字。这是数据绑定本该有的行为（活渲染舞台看的就是
  // "真数据"，不是"页面原文"），不是覆盖层的缺陷——覆盖层本身对**没打孔的
  // 静态内容**（导航文案、标题这类）是生效的，真机测过。编辑打过孔字段的
  // 落库内容不会丢，只是活渲染那一眼看不出来，这个反差要留着别当成 bug 修。
  const [pageOverrides, setPageOverrides] = useState<Record<string, string>>({});
  useEffect(() => {
    setPageOverrides({});
    setEditMode(false);
  }, [sessionId]);
  const displayPages = useMemo<SpecPageLive[]>(
    () =>
      livePages.map(p =>
        pageOverrides[p.pageId] ? { ...p, html: pageOverrides[p.pageId] } : p
      ),
    [livePages, pageOverrides]
  );

  // HTML 应用面的运行时数据。**跟老区块渲染共用同一份**（同一个 sessionId 的
  // RuntimeState）——各读各的等于同一个应用有两份互不相干的数据，用户在
  // HTML 页里新建一条，切到区块页就没了。
  //
  // ⚠ 种子照走 seedRuntimeState：它管着"每个实体只判一次要不要铺示例"，
  //   以及"用户写了真实数据就整批清掉示例"。绕过它自己造数据会把这套语义丢掉。
  const runtimeSessionId = sessionId ?? "sliderule-v51-product";
  const [htmlRuntime, setHtmlRuntime] = useState<RuntimeState | null>(null);
  useEffect(() => {
    if (!fiveSystemModel) return;
    setHtmlRuntime(
      seedRuntimeState(
        loadRuntimeState(runtimeSessionId) ?? initRuntimeState(fiveSystemModel),
        fiveSystemModel
      )
    );
  }, [fiveSystemModel, runtimeSessionId]);

  // 当前角色（2026-08-14 晚：权限那只手伸进 HTML 页）。
  // 持久化和广播沿用老区块舞台那套（loadRuntimeRole + 事件）——RBAC 屏的
  // 「角色预览」跟这里改的是同一份，谁改都实时生效，不另起一份角色状态。
  const [role, setRole] = useState<string | undefined>(undefined);
  useEffect(() => {
    const stored = loadRuntimeRole(runtimeSessionId);
    setRole(stored ?? normalizeRoles(fiveSystemModel)[0]?.id);
  }, [runtimeSessionId, fiveSystemModel]);
  useEffect(
    () =>
      subscribeRoleChanged(runtimeSessionId, () => {
        const next = loadRuntimeRole(runtimeSessionId);
        if (next) setRole(next);
      }),
    [runtimeSessionId]
  );
  const changeRole = useCallback(
    (next: string) => {
      setRole(next);
      saveRuntimeRole(runtimeSessionId, next);
      notifyRoleChanged(runtimeSessionId);
    },
    [runtimeSessionId]
  );
  const roleOptions = useMemo(
    () => normalizeRoles(fiveSystemModel),
    [fiveSystemModel]
  );

  // 页面里的动作 → 表单面（2026-08-14，还掉上一版"那是下一步"的欠条）。
  // 记录三种走 RecordFormDrawer；转移三种（2026-08-14 晚）走状态机纯函数
  // applyHtmlWorkflowAction——提交/通过/驳回立刻产生后果，结果如实提示。
  const [recordAction, setRecordAction] = useState<RecordActionRequest | null>(
    null
  );
  const applyRuntime = useCallback(
    (next: RuntimeState) => {
      setHtmlRuntime(next);
      saveRuntimeState(runtimeSessionId, next);
      // 广播给共享同一份状态的面（EntityDataPanel 在系统抽屉里订阅着它）
      notifyRuntimeChanged(runtimeSessionId);
    },
    [runtimeSessionId]
  );
  const handleHtmlAction = useCallback(
    (ev: RecordActionRequest) => {
      // 模型/运行态没就绪时不接（推演早期理论上没有动作可点，这条是
      // 防御性一致：接不住就如实什么都不做）
      if (!fiveSystemModel || !htmlRuntime) return;
      if (isWorkflowActionKind(ev.kind)) {
        const res = applyHtmlWorkflowAction(
          htmlRuntime,
          fiveSystemModel,
          ev,
          role,
          new Date().toISOString()
        );
        if (res.ok) {
          applyRuntime(res.state);
          message.success(res.message);
        } else {
          // 拒绝不静默：该谁处理、为什么不行，原话给用户
          message.warning(res.message);
        }
        return;
      }
      setRecordAction(ev);
    },
    [fiveSystemModel, htmlRuntime, role, applyRuntime]
  );

  // 舞台：推演中恒为 live 占位（用户裁决 2026-07-14：执行期不看中间过程
  // ——系统屏/看板/起草预览一律不展示，只留"推演中 + 当前动作"极简态，
  // 过程细节由左栏分阶段叙事承载）；推演完成直接呈现效果页：
  // 应用主舞台 > 接线沙盘（点组透视）> Checks。
  // ⚑ 2026-08-14：跑完之后**新链路的页面优先于老链路的区块页**。
  //
  // 用户原话「最后执行完，我发现变成老链路了」——过程中右侧是新链路的 HTML，
  // 一收口就换成 AppRuntimeScreen 那套区块渲染（示例数据、年龄 148 那种）。
  // 花 18 分钟画出来的五页在交付那一刻被顶掉。
  //
  // ⚑ 2026-08-14（用户裁决）：跑完之后**区块页彻底不再上舞台**。
  //
  // 上一版这里留着一条回落：没有新链路页面就退回 AppRuntimeScreen 那套区块
  // 渲染。留它的理由是"spec-first 挂了的时候区块页是唯一产出"——理由本身
  // 没错，但用户看到的结果是**同一个产品有两种完全不同的成品面孔**，而且
  // 切换发生在自己看不见的地方（livePages 空不空取决于这一轮 spec-first
  // 有没有跑通）。同一个入口两种面孔，比少一种面孔更难解释。
  //
  // ⚠ 这条是明知代价拍的板：**spec-first 挂掉的那些轮次，右侧不再有可交互的
  //   应用**，退到推演剧场/证据看板（都是既有状态，不是白屏）。也就是说
  //   新链路的失败从此**在界面上是看得见的**，不再被区块页悄悄兜住——
  //   而"兜住"正是本仓数过很多次的那个形状：闸全绿但东西已经换了一个。
  //   真要恢复兜底，改这一处即可（把 appSchema && fiveSystemModel 那档加回来）。
  const stage: "theater" | "app" | "live" | "pages" | "board" = isRunning
    ? "live"
    : livePages.length > 0
      ? "pages"
      : activeSkillId
        ? "theater"
        : "board";

  // ⚑ 2026-08-14（当天回炉）：游标与档位切换随区块页下架后，用户点名要回来
  // ——「跟以前链路顶部保持统一，之前挺好用的」。这次不是把 AppRuntimeScreen
  // 的 portal 接回来，而是给 HTML 舞台配齐同一排件：
  //   · 页面/代码档：页面 = 渲染页；代码 = 当前页交付的 HTML 原文
  //   · 游标：XrayPanel 原样复用（它只吃模型 + schema，纯派生），中间缺的
  //     那层「{attr,value,el} → XrayTarget」翻译落在 htmlBindingToXrayTarget
  //
  // ⚑ 2026-08-25 加 "canvas"：一轮交五页，页面档一次只看得见一页，
  //   "这套应用长什么样"是个整体问题。画布把所有页面并排摊开（见
  //   live-runtime/SpecPageCanvasStage.tsx）。
  //   ⚠ 加档位要同时看三处，漏一处就是"闸绿了东西没了"：
  //     1) 下面这个联合类型  2) 顶栏 ToggleGroup 的数组  3) 舞台渲染分支。
  const [stageView, setStageView] = useState<"canvas" | "page" | "code" | "board">(
    () => (loadStageViewPref() === "canvas" ? "canvas" : "page")
  );
  // 档位偏好只记 画布/页面 两档（"代码"是临时查看，记住它等于下次开门先给
  // 用户一屏 HTML 源码）。跟游标开关同一套 localStorage 兜底写法。
  useEffect(() => {
    if (stageView === "canvas" || stageView === "page") saveStageViewPref(stageView);
  }, [stageView]);
  const [activeSpecPageId, setActiveSpecPageId] = useState<string>("home");
  // 游标开关（计算尺游标 hairline 的品牌梗；偏好持久化，键跟老舞台同一个
  // ——用户在老链路开过游标，这里就该记得）
  const [xrayOn, setXrayOn] = useState<boolean>(() => {
    try {
      return localStorage.getItem(XRAY_PREF_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [xrayTarget, setXrayTarget] = useState<XrayTarget | null>(null);
  const toggleXray = useCallback(() => {
    setXrayOn(v => {
      try {
        localStorage.setItem(XRAY_PREF_KEY, v ? "0" : "1");
      } catch {
        /* 隐私模式下存不了偏好，开关本身照常工作 */
      }
      if (v) setXrayTarget(null); // 关游标时清掉残留焦点
      return !v;
    });
  }, []);
  // 悬停监听是 iframe load 时挂的（html-app-surface）：回调必须**恒传**，
  // 否则"先加载后开游标"的那个框永远没有监听。开没开在这里用 ref 把关。
  const xrayOnRef = useRef(xrayOn);
  xrayOnRef.current = xrayOn;
  const appSchema = useMemo(
    () => deriveAppRuntimeSchema(fiveSystemModel, appTitle || "推演应用"),
    [fiveSystemModel, appTitle]
  );
  // 角色上下文（CASL 式 ability）：按当前角色派生一次，解释器填孔时逐点查。
  // ⚠ 必须 memo——它进 HtmlAppSurface 的 effect 依赖，每渲染一个新对象
  //   等于每次渲染都整框重载。
  const actionGates = useMemo(
    () =>
      appSchema
        ? deriveHtmlActionGates(fiveSystemModel, appSchema.pages, role)
        : undefined,
    [appSchema, fiveSystemModel, role]
  );
  const handleHoverBinding = useCallback(
    (info: { attr: string; value: string; el: Element } | null) => {
      if (!xrayOnRef.current) return;
      setXrayTarget(
        info ? htmlBindingToXrayTarget(info, activeSpecPageId, actionGates) : null
      );
    },
    [activeSpecPageId, actionGates]
  );

  // 系统屏抽屉（游标深入 / 抽屉内六系统横向切换）
  const [drawerSkill, setDrawerSkill] = useState<SkillId | null>(null);
  useEffect(() => {
    if (!drawerSkill) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setDrawerSkill(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerSkill]);


  // E29 版本前进/回退工具栏（成品面顶栏与沙盘 Checks 行共用）
  const versionToolbar = modelVersions.length > 1 ? (() => {
    const i = modelVersions.findIndex(v => v.id === currentModelVersionId);
    const idx = i >= 0 ? i : modelVersions.length - 1;
    const prev = modelVersions[idx - 1];
    const next = modelVersions[idx + 1];
    return (
      <div
        className="ml-auto flex shrink-0 items-center gap-1 rounded-full bg-white/80 px-1.5 py-0.5 ring-1 ring-[#e5e7eb]"
        data-testid="sliderule-version-toolbar"
      >
        <button
          type="button"
          data-testid="sliderule-version-back"
          // ⚠ 边界禁用不够（2026-08-16 实测）：原来只有 !prev，于是请求在飞
          //   的时候按钮照样能点，用户连点几下、三个并发 POST 全被后端接受。
          disabled={!prev || isRestoringVersion}
          onClick={() => prev && onRestoreVersion?.(prev.id)}
          className="rounded-full px-1.5 py-0.5 text-[11px] text-stone-500 transition hover:bg-[#e9edf2] hover:text-stone-800 disabled:cursor-not-allowed disabled:opacity-30"
          title={prev ? `回退到 v${idx}${prev.instruction ? `（${prev.instruction.slice(0, 24)}）` : ""}` : "已是最早版本"}
        >
          ◀
        </button>
        <span className="text-[10px] font-medium text-stone-500" title={modelVersions[idx]?.instruction || ""}>
          v{idx + 1}/{modelVersions.length}
        </span>
        <button
          type="button"
          data-testid="sliderule-version-forward"
          disabled={!next || isRestoringVersion}
          onClick={() => next && onRestoreVersion?.(next.id)}
          className="rounded-full px-1.5 py-0.5 text-[11px] text-stone-500 transition hover:bg-[#e9edf2] hover:text-stone-800 disabled:cursor-not-allowed disabled:opacity-30"
          title={next ? `前进到 v${idx + 2}${next.instruction ? `（${next.instruction.slice(0, 24)}）` : ""}` : "已是最新版本"}
        >
          ▶
        </button>
      </div>
    );
  })() : null;

  // 空会话或用户点了「隐藏页面」：对话独占全宽。右侧舞台不渲染。
  if (!showStage) {
    return (
      <StudioChrome className={className}>
        <div className="relative flex h-full w-full flex-col">
          {chromeSlot || resetSlot ? (
            <div className="flex shrink-0 items-center justify-end gap-1 px-3 py-1">
              {resetSlot}
              {chromeSlot}
            </div>
          ) : null}
          {chatSlot}
        </div>
      </StudioChrome>
    );
  }

  const activeEditPage = displayPages.find(p => p.pageId === activeSpecPageId) ?? null;

  const roleControl =
    roleOptions.length > 0 ? (
      /* 角色切换（2026-08-14 晚）：权限那只手的开关。放在说明行右侧，
         不跟顶栏页面/透视抢位（2026-08-20）。 */
      <div className="relative shrink-0">
        <select
          value={role ?? ""}
          onChange={e => changeRole(e.target.value)}
          data-testid="sliderule-stage-role"
          title="以哪个角色试用这个应用（权限门实时生效）"
          className={`h-7 cursor-pointer appearance-none rounded-md border border-[#e5e7eb] bg-white text-[12px] font-medium text-stone-600 outline-none transition hover:border-[#d3d8e0] hover:bg-[#f8f9fb] ${
            isPhoneStage ? "max-w-[5.5rem] truncate pl-2 pr-6" : "pl-3 pr-8"
          }`}
        >
          {roleOptions.map(r => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
        <ChevronDown
          className={`pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400 ${
            isPhoneStage ? "right-1.5" : "right-2.5"
          }`}
        />
      </div>
    ) : null;

  const stagePanel = (
      /* 主舞台。底色在 StudioChrome；这里透底才能看见点阵，画布本身不透。
          2026-08-07：不再写死 #f7f8fa，改读外壳 --sr-shell-bg。 */
      <div className="relative flex h-full min-h-0 min-w-0 flex-col gap-3 overflow-hidden bg-transparent p-4">
        {(stage === "live" && livePages.length > 0) || stage === "pages" ? (
          /* 新链路已经交出页面：直接渲染，不再摆三个点。
             判据是"手上有没有能看的东西"，不是阶段名——没有页面时下面那支
             原样保留（老链路今天还在跑，它整轮都没有可看的中间产物）。 */
          <>
            {/* Primer PageHeader（分栏用 subtitle 档）：标题在左、操作在右，
                同一行。窄视口（手机预览列）把带字的操作收成图标，不要再
                叠第二行工具条——那是 2026-08-20 为了防挤改的，桌面左对齐
                像孤儿工具条。指南：
                https://primer.style/product/components/page-header/guidelines/
                Trailing action：窄视口用 overflow / 图标，不换行。 */}
            <div
              className="flex min-w-0 shrink-0 items-center gap-2 border-b border-[#d1d9e0b3] pb-2"
              data-testid="sliderule-app-stage-bar"
              data-header-pattern="primer-page-header"
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                {/* 重置会话钉在标题**左边**（2026-08-24 用户反馈）：它以前是右侧
                    灰图标簇的最后一个 ⟳，跟「重置布局」的 ◫ 挨着，两个都叫"重置"
                    也都是灰的，真机上分不出来。 */}
                {resetSlot}
                <span className="min-w-0 truncate text-[12px] font-semibold text-stone-600">
                  {appTitle || "推演应用"}
                </span>
                {modelIsDraft ? (
                  /* 默认态不打「运行中」——成品预览本来就是在跑。
                     2026-08-20 手机 504 列：绿徽章跟标题抢宽，名字被截成
                     「构建古籍数…」。Primer Label：只标非默认态。 */
                  <span
                    className="shrink-0 rounded-full bg-[#FDF6F1] px-2 py-0.5 text-[10px] font-medium text-[#C05621]"
                    data-testid="sliderule-stage-model-draft"
                  >
                    起草中
                  </span>
                ) : null}
                {versionToolbar}
              </div>
              <div
                className="ml-auto flex min-w-0 flex-1 items-center overflow-x-auto [scrollbar-width:thin]"
                data-testid="sliderule-stage-gears"
              >
                {/* 2026-08-20 1440：外层 overflow-hidden + 这一排 shrink-0，
                    右侧图标被裁掉；overflow-x-auto 写在不能收缩的盒子上等于
                    没写。内层 shrink-0 保住按钮固有宽，外层才是真正的滑槽。 */}
                <div className="ml-auto flex shrink-0 items-center gap-1">
                {/* Primer / shadcn ToggleGroup：浅底轨 + 白片选中，不要黑底白字。
                    2026-08-20 满电青年：这里曾经 bg-[#1f2328] text-white，
                    浅色舞台头条上像一块开关。 */}
                <div className="flex h-7 items-center rounded-md bg-[#f4f4f5] p-0.5">
                  {/* ⚠ 2026-08-24：这里曾经还有第三片 ["board", "沙盘"]，撤了——
                      「透视」侧栏顶上的「打开沙盘」走的是同一个 setStageView("board")
                      （见下面 XrayPanel 的 onOpenSandbox），顶栏再挂一片纯属重复占位。
                      注意撤的只是**这颗按钮**：stageView === "board" 那支渲染和
                      XrayPanel 的入口都还在，删它们会让沙盘真的没法打开。 */}
                  {/* ⚑ 2026-08-25：「画布」加在**页面左边**（用户在截图上
                      箭头标的就是这个位置）。次序是有讲究的，不是随手排的：
                      画布=看全套 → 页面=看一页 → 代码=看这一页的源码，
                      从粗到细，跟 Figma（画布→图层）/ Stitch 同向。
                      把它塞在代码后面会变成"三个并列的东西"，粒度关系就没了。 */}
                  {(
                    [
                      ["canvas", "画布"],
                      ["page", "页面"],
                      ["code", "代码"],
                    ] as const
                  ).map(([v, label]) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setStageView(v)}
                      aria-pressed={stageView === v}
                      data-testid={`sliderule-stage-view-${v}`}
                      className={`rounded-[5px] px-2 py-0.5 text-[11px] transition ${
                        stageView === v
                          ? "bg-white font-medium text-stone-800 shadow-sm"
                          : "text-stone-500 hover:text-stone-700"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <StudioShareToggle
                  sessionId={sessionId}
                  running={isRunning}
                  compact={isPhoneStage}
                />
                <button
                  type="button"
                  onClick={() => {
                    if (stageView !== "page") setStageView("page");
                    if (stageView === "page" || !xrayOn) toggleXray();
                  }}
                  data-testid="sliderule-xray-toggle"
                  aria-label="透视"
                  aria-pressed={xrayOn && stageView === "page"}
                  className={`flex h-7 items-center rounded-md border text-[12px] font-medium transition ${
                    xrayOn && stageView === "page"
                      ? "border-transparent bg-[#1677ff] text-white shadow-sm"
                      : "border-[#e5e7eb] bg-white text-stone-600 hover:border-[#d3d8e0] hover:bg-[#f8f9fb]"
                  } ${isPhoneStage ? "w-7 justify-center" : "gap-1.5 px-2.5"}`}
                  title="对准页面上的元素，看它背后的数据、流程和权限"
                >
                  <Crosshair className="h-3.5 w-3.5" />
                  {isPhoneStage ? null : "透视"}
                </button>
                {stageView === "page" && (
                  <button
                    type="button"
                    onClick={() => {
                      if (editMode && editDirty && !window.confirm("有未保存的修改，确定要退出编辑吗？")) {
                        return;
                      }
                      setEditMode(m => !m);
                    }}
                    disabled={!editMode && (!boundAppId || !activeEditPage)}
                    data-testid="sliderule-click-edit-toggle"
                    aria-label="点选编辑"
                    aria-pressed={editMode}
                    className={`flex h-7 items-center rounded-md border text-[12px] font-medium transition ${
                      editMode
                        ? "border-transparent bg-[#1677ff] text-white shadow-sm"
                        : "border-[#e5e7eb] bg-white text-stone-600 hover:border-[#d3d8e0] hover:bg-[#f8f9fb]"
                    } ${isPhoneStage ? "w-7 justify-center" : "gap-1.5 px-2.5"} disabled:cursor-not-allowed disabled:opacity-40`}
                    title={
                      boundAppId
                        ? "点页面里的文字/按钮直接改——改字、改色、删元素，改完点保存"
                        : "这一轮还没存库，落库之后才能点选编辑"
                    }
                  >
                    <MousePointerClick className="h-3.5 w-3.5" />
                    {isPhoneStage ? null : editMode ? "退出编辑" : "点选编辑"}
                  </button>
                )}
                {chromeSlot}
                </div>
              </div>
            </div>
            <div className="flex min-h-0 flex-1 gap-3">
              {stageView === "board" ? (
                <div className="flex min-h-0 flex-1 flex-col gap-2">
                  {roleControl ? (
                    <div
                      className="flex shrink-0 justify-end"
                      data-testid="sliderule-stage-meta-trailing"
                    >
                      {roleControl}
                    </div>
                  ) : null}
                  <ArchitectureStage
                    model={fiveSystemModel}
                    publishClosure={publishClosure}
                    onInspect={setDrawerSkill}
                    focusSkill={activeSkillId}
                    className="min-h-0 flex-1"
                  />
                </div>
              ) : editMode && stageView === "page" && boundAppId && activeEditPage ? (
                /* 点选编辑：换掉活渲染舞台，不叠在它上面——填数运行时和点选编辑
                   两套事件各管各的，叠在一起点击语义会打架（点了到底是选中
                   要改，还是触发了应用自己的按钮动作）。退出编辑态才把活渲染
                   接回来。 */
                <ClickEditStage
                  key={`${boundAppId}:${activeEditPage.pageId}`}
                  appId={boundAppId}
                  pageId={activeEditPage.pageId}
                  html={activeEditPage.html}
                  device={stageDevice}
                  onDirtyChange={setEditDirty}
                  onSaved={(pageId, html) =>
                    setPageOverrides(prev => ({ ...prev, [pageId]: html }))
                  }
                  className="min-h-0 min-w-0 flex-1"
                />
              ) : stageView === "canvas" ? (
                /* 画布档：同一份 displayPages，摊开成多画板。
                   ⚠ 喂的**必须**是 displayPages 而不是 livePages——点选编辑
                     存过的页在 pageOverrides 里，喂 livePages 会让画布上显示
                     的是改之前那份，而页面档显示改之后那份。同一个产物两个
                     档位两种内容，正是本仓第四条纪律的形状。
                   fail-open：画布是增强类，炸了收进降级卡，不拖垮主链路，
                   也**不自动切回页面档**（换脸比报错更难解释）。 */
                <AppStageErrorBoundary resetKeys={[sessionId, displayPages.length]}>
                  <SpecPageCanvasStage
                    pages={displayPages}
                    running={isRunning}
                    model={fiveSystemModel}
                    runtime={htmlRuntime}
                    gates={actionGates}
                    onAction={handleHtmlAction}
                    onHoverBinding={handleHoverBinding}
                    activePageId={activeSpecPageId}
                    onActivePageChange={setActiveSpecPageId}
                    /* 手画连线按会话存档。⚠ 不传的话所有会话共用一个 key，
                       换个应用会看到上一个应用的连线。 */
                    sessionId={sessionId}
                    onOpenInPageView={pageId => {
                      setActiveSpecPageId(pageId);
                      setStageView("page");
                    }}
                    metaTrailing={roleControl}
                    className="min-h-0 min-w-0 flex-1"
                  />
                </AppStageErrorBoundary>
              ) : (
                <>
              <SpecPageLiveStage
                pages={displayPages}
                statusLabel={isRunning ? liveActionLabel : null}
                running={isRunning}
                model={fiveSystemModel}
                runtime={htmlRuntime}
                gates={actionGates}
                onAction={handleHtmlAction}
                onHoverBinding={handleHoverBinding}
                onActivePageChange={setActiveSpecPageId}
                view={stageView}
                metaTrailing={roleControl}
                className="min-h-0 min-w-0 flex-1"
              />
              {xrayOn && fiveSystemModel && appSchema && (
                <XrayPanel
                  model={fiveSystemModel}
                  schema={appSchema}
                  activePageId={activeSpecPageId}
                  target={xrayTarget}
                  onOpenSystem={setDrawerSkill}
                  onOpenSandbox={() => setStageView("board")}
                />
              )}
                </>
              )}
            </div>
          </>
        ) : stage === "live" ? (
          /* 模型还没成形（轮内步骤 / 起草早期）：右侧只报"推演中"——实时想法
             已在左栏流出（用户反馈：右侧别重复直播内容），应用成形后接管舞台。 */
          <div
            className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-3"
            data-testid="sliderule-live-stage"
          >
            {chromeSlot || resetSlot ? (
              <div className="absolute right-0 top-0 flex items-center gap-1">
                {resetSlot}
                {chromeSlot}
              </div>
            ) : null}
            <span className="inline-flex items-end gap-1.5" aria-hidden>
              <span className="sr-dot h-2 w-2 rounded-full bg-[#1677ff]" />
              <span className="sr-dot h-2 w-2 rounded-full bg-[#1677ff]" />
              <span className="sr-dot h-2 w-2 rounded-full bg-[#1677ff]" />
            </span>
            <div className="text-[13px] font-medium text-stone-500">推演中</div>
            {/* 一行步骤锚点即可（用户反馈：字太多）——文案翻滚过渡 */}
            {liveActionLabel && (
              <RollingText
                text={liveActionLabel}
                className="max-w-[320px] text-[12px] text-stone-400"
              />
            )}
          </div>
        ) : (
          <ArchitectureStage
            model={fiveSystemModel}
            publishClosure={publishClosure}
            onInspect={setDrawerSkill}
            focusSkill={activeSkillId}
            versionToolbar={versionToolbar}
            trailing={
              chromeSlot || resetSlot ? (
                <div className="flex items-center gap-1">
                  {resetSlot}
                  {chromeSlot}
                </div>
              ) : null
            }
            className="min-h-0 flex-1"
          />
        )}

        {/* 系统屏抽屉：单类别全幅呈现——点哪类看哪类（用户反馈：去六系统切换条、去白卡嵌套、占满区域） */}
        {drawerSkill && (
          <div
            className="absolute inset-0 z-40 flex flex-col bg-[var(--sr-shell-bg,#f4f4f6)]"
            data-testid="sliderule-system-drawer"
          >
            <div className="flex shrink-0 items-center gap-2 px-4 pb-1 pt-3">
              <span className="text-[13px] font-semibold text-stone-800">
                {SKILL_LABELS[drawerSkill]}
              </span>
              <span className="text-[11px] text-stone-400">
                透视 · 应用背后的声明
              </span>
              <button
                type="button"
                onClick={() => setDrawerSkill(null)}
                data-testid="sliderule-system-drawer-close"
                className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-stone-400 transition hover:bg-[#e9edf2] hover:text-stone-700"
                title="关闭（Esc）"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <ActiveSystemScreen
              activeSkillId={drawerSkill}
              running={isRunning}
              publishClosure={publishClosure}
              latestMermaid={latestMermaid}
              skillContents={skillContents}
              skillRuntimeGraph={skillRuntimeGraph}
              sessionId={sessionId}
              appTitle={appTitle}
              model={fiveSystemModel}
              fill
              className="min-h-0 flex-1"
            />
          </div>
        )}

        {/* HTML 页面动作的表单面：详情/编辑/新建三态，写回运行态后 data-* 孔
            随 htmlRuntime 变化立刻重填——写数据闭环的可见反馈就是页面本身。 */}
        <StudioLandingShot
          sessionId={sessionId}
          running={isRunning}
          specFirstPages={specFirstPages}
          specPages={specPages}
          model={fiveSystemModel}
          runtime={htmlRuntime}
        />
        <RecordFormDrawer
          model={fiveSystemModel}
          state={htmlRuntime}
          request={recordAction}
          onClose={() => setRecordAction(null)}
          onApply={applyRuntime}
        />
      </div>
  );

  return (
    <StudioChrome className={className}>
      <StudioSplit
        device={stageDevice}
        chat={
          <div className="flex h-full min-h-0 flex-col bg-transparent">
            {chatSlot}
          </div>
        }
        stage={stagePanel}
      />
    </StudioChrome>
  );
}
