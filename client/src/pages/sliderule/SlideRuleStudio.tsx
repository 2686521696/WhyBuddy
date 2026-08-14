/**
 * SlideRuleStudio — 统一页主布局容器（左 38% + 右 62%）
 *
 * 左侧：Chat 对话区（ClaudeChatSurface，含唯一空态：logo 水印 + hero 文案 + 示例 chips）。
 *
 * 右侧主舞台——四态：
 *   pages   — **成品面**：spec-first 那条链路产出的 HTML 页面，装在
 *             1920×1080 的等比缩放画布里（见 live-runtime/canvas-scale.tsx）。
 *             推演中逐页到达就开始渲染，跑完继续由它接管，中途不换面孔；
 *   theater — 五系统生成中（SSE activeSkillId 驱动），系统屏生成剧场逐屏亮相；
 *   live    — 推演已开始但一页都还没交出来，占位报"推演中 + 当前步骤"，
 *             不重复左栏直播流；
 *   board   — 尚无可看产出（空会话/未闭环），保留六系统缩略 + 证据看板。
 * 六系统屏不再是并列切屏，而是抽屉承载的透视层（全部保留）。
 *
 * ⚑ 2026-08-14：原来那个 `app` 态（AppRuntimeScreen 区块渲染）**已从本页下架**
 *   ——用户裁决：跑完之后只认新链路的页面。理由与代价写在下面 stage 那处，
 *   AppRuntimeScreen 本身没删，应用中心（AppBundleScreen）照旧用它。
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import type { SkillId } from "@/lib/sliderule-marathon-driver";
import type { PublishClosureSummary } from "./derive-cross-runtime-summary";
import { SkillThumbnailBar } from "./SkillThumbnailBar";
import { ActiveSystemScreen } from "./system-screens/ActiveSystemScreen";
import {
  deriveSettledFiveSystemModel,
  parsePartialFiveSystemModel,
  type SkillRuntimeGraphLike,
} from "./system-screens/five-system-model";
import {
  SpecPageLiveStage,
  type SpecPageLive,
} from "./live-runtime/SpecPageLiveStage";
import {
  initRuntimeState,
  type RuntimeState,
} from "./live-runtime/live-runtime";
import { seedRuntimeState } from "./live-runtime/demo-seed";
import {
  loadRuntimeState,
  saveRuntimeState,
  notifyRuntimeChanged,
} from "./live-runtime/runtime-persistence";
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
import { Crosshair, X } from "lucide-react";

const XRAY_PREF_KEY = "sliderule:xray-on";

/** 抽屉标题：系统的中文名（游标语境下不再用英文胶囊） */
const SKILL_LABELS: Record<SkillId, string> = {
  dataModel: "数据模型",
  workflow: "工作流",
  rbac: "角色权限",
  page: "页面",
  aigc: "AI 能力",
  appBundle: "应用装配 · 联动总图",
};

interface SlideRuleStudioProps {
  /** E29 模型版本史（前进/回退按钮数据源） */
  modelVersions?: Array<{ id: string; instruction?: string; createdAt?: string }>;
  currentModelVersionId?: string | null;
  onRestoreVersion?: (versionId: string) => void;
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
  specFirstPages?: { pages?: Record<string, string>; navItems?: unknown[] } | null;

  className?: string;
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
}: SlideRuleStudioProps) {
  // Allow manual override of the displayed screen (click thumbnail, board/theater 态)
  const [manualSkill, setManualSkill] = useState<SkillId | null>(null);

  // SSE events take priority during a run; manual selection persists between runs.
  const displaySkillId = activeSkillId ?? manualSkill;

  const handleThumbnailSelect = useCallback((id: SkillId) => {
    setManualSkill(id);
  }, []);

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
  const livePages = useMemo<SpecPageLive[]>(() => {
    const settled = specFirstPages?.pages || null;
    if (settled && Object.keys(settled).length > 0) {
      const ids = Object.keys(settled);
      return ids.map((id, i) => ({
        pageId: id, html: settled[id], current: i + 1, total: ids.length,
        // 落库那份是走完 6.5 步的。boundPages 为 0 时说明打孔没成，如实说
        bound: Number((specFirstPages as { boundPages?: number })?.boundPages ?? 0) > 0,
      }));
    }
    return specPages;
  }, [specFirstPages, specPages]);

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

  // 页面里的动作 → 表单面（2026-08-14，还掉上一版"那是下一步"的欠条）。
  // 三种 kind 全部接住：createRecord 不再静默塞空行——先填值再入库，跟
  // openRecord（详情）/ editRecord（编辑）共用同一张 RecordFormDrawer。
  // 词表不动：还是那三个词，这里只是让它们产生后果。
  const [recordAction, setRecordAction] = useState<RecordActionRequest | null>(
    null
  );
  const handleHtmlAction = useCallback(
    (ev: RecordActionRequest) => {
      // 模型/运行态没就绪时不开一张填不了的表单（推演早期理论上没有动作
      // 可点，这条是防御性一致：接不住就如实什么都不做）
      if (!fiveSystemModel || !htmlRuntime) return;
      setRecordAction(ev);
    },
    [fiveSystemModel, htmlRuntime]
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

  // 舞台：推演中恒为 live 占位（用户裁决 2026-07-14：执行期不看中间过程
  // ——系统屏/看板/起草预览一律不展示，只留"推演中 + 当前动作"极简态，
  // 过程细节由左栏分阶段叙事承载）；推演完成直接呈现效果页：
  // 应用主舞台 > 推演剧场（缩略图手动透视）> 证据看板。
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
  //   · 桌面/代码档：桌面 = 渲染页；代码 = 当前页交付的 HTML 原文
  //   · 游标：XrayPanel 原样复用（它只吃模型 + schema，纯派生），中间缺的
  //     那层「{attr,value,el} → XrayTarget」翻译落在 htmlBindingToXrayTarget
  const [stageView, setStageView] = useState<"page" | "code">("page");
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
  const handleHoverBinding = useCallback(
    (info: { attr: string; value: string; el: Element } | null) => {
      if (!xrayOnRef.current) return;
      setXrayTarget(info ? htmlBindingToXrayTarget(info, activeSpecPageId) : null);
    },
    [activeSpecPageId]
  );
  const appSchema = useMemo(
    () => deriveAppRuntimeSchema(fiveSystemModel, appTitle || "推演应用"),
    [fiveSystemModel, appTitle]
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


  // E29 版本前进/回退工具栏（app 主舞台头条与 board 缩略条行共用）
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
          disabled={!prev}
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
          disabled={!next}
          onClick={() => next && onRestoreVersion?.(next.id)}
          className="rounded-full px-1.5 py-0.5 text-[11px] text-stone-500 transition hover:bg-[#e9edf2] hover:text-stone-800 disabled:cursor-not-allowed disabled:opacity-30"
          title={next ? `前进到 v${idx + 2}${next.instruction ? `（${next.instruction.slice(0, 24)}）` : ""}` : "已是最新版本"}
        >
          ▶
        </button>
      </div>
    );
  })() : null;

  // 空会话：欢迎页独占全宽，右侧舞台整体不渲染（用户还没输入，没内容可看）
  if (!stageVisible) {
    return (
      <div className={`flex h-full w-full overflow-hidden ${className}`}>
        <div className="flex h-full w-full flex-col bg-[var(--sr-shell-bg,#ffffff)]">
          {chatSlot}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex h-full w-full overflow-hidden ${className}`}>
      {/* Left panel — 38% — Chat（对话 + 实时推演过程） */}
      <div
        className="flex h-full shrink-0 flex-col border-r border-[#e5e7eb] bg-[var(--sr-shell-bg,#ffffff)]"
        style={{ width: "38%" }}
      >
        {chatSlot}
      </div>

      {/* Right panel — 62% — 主舞台 */}
      {/* 与左侧 IM 同一底色（用户反馈：右侧多种颜色不统一）。
          2026-08-07 再统一一层：底色不再写死 #f7f8fa，改读外壳的
          --sr-shell-bg（定义在 dashboard.css 的 .native-agent-shell /
          .native-dashboard 上，会话页就渲染在它里面）。
          此前会话页是 #f7f8fa、应用中心是 #ffffff，两页切换看得出色差
          ——用户反馈"背景颜色不一致，会话页面背景不是白色的"。
          现在两边共用一个 token，"改这一个值 = 整壳换底色"这条重新成立。 */}
      <div className="relative flex min-w-0 flex-1 flex-col gap-3 overflow-hidden bg-[var(--sr-shell-bg,#ffffff)] p-4">
        {(stage === "live" && livePages.length > 0) || stage === "pages" ? (
          /* 新链路已经交出页面：直接渲染，不再摆三个点。
             判据是"手上有没有能看的东西"，不是阶段名——没有页面时下面那支
             原样保留（老链路今天还在跑，它整轮都没有可看的中间产物）。 */
          <>
            {/* 头条（2026-08-14 从原区块页舞台挪过来）：话题名 + 起草/运行中 +
                版本前进回退。区块页下架之后这三样没了着落，而它们跟渲染的是
                哪一套页面无关——都是**这一轮推演本身**的信息。 */}
            <div
              className="flex shrink-0 items-center gap-2"
              data-testid="sliderule-app-stage-bar"
            >
              <span className="min-w-0 truncate text-[12px] font-semibold text-stone-600">
                {appTitle || "推演应用"}
              </span>
              {modelIsDraft ? (
                <span className="rounded-full bg-[#FDF6F1] px-2 py-0.5 text-[10px] font-medium text-[#C05621]">
                  起草中
                </span>
              ) : (
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                  运行中
                </span>
              )}
              {versionToolbar}
              {/* 顶栏右侧三件（2026-08-14 回炉）：桌面/代码档 + 游标——跟老区块
                  舞台同一排、同一语义（用户点名「跟以前链路顶部保持统一」）。 */}
              <div
                className={`${versionToolbar ? "" : "ml-auto "}flex shrink-0 items-center gap-1.5`}
                data-testid="sliderule-stage-gears"
              >
                <div className="flex items-center rounded-full border border-[#e5e7eb] bg-white p-0.5">
                  {(
                    [
                      ["page", "桌面"],
                      ["code", "代码"],
                    ] as const
                  ).map(([v, label]) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setStageView(v)}
                      aria-pressed={stageView === v}
                      data-testid={`sliderule-stage-view-${v}`}
                      className={`rounded-full px-2.5 py-0.5 text-[11px] transition ${
                        stageView === v
                          ? "bg-[#1f2328] font-medium text-white"
                          : "text-stone-500 hover:bg-[#f1f3f5]"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={toggleXray}
                  data-testid="sliderule-xray-toggle"
                  aria-pressed={xrayOn}
                  className={`flex h-8 items-center gap-1.5 rounded-full border px-3.5 text-[12px] font-semibold transition ${
                    xrayOn
                      ? "border-transparent bg-[#1677ff] text-white shadow-sm"
                      : "border-[#e5e7eb] bg-white text-stone-600 hover:border-[#d3d8e0] hover:bg-[#f8f9fb]"
                  }`}
                  title="计算尺的游标：对齐到元素，读出它在五系统刻度上的对应声明"
                >
                  <Crosshair className="h-3.5 w-3.5" />
                  游标
                </button>
              </div>
            </div>
            <div className="flex min-h-0 flex-1 gap-3">
              <SpecPageLiveStage
                pages={livePages}
                statusLabel={isRunning ? liveActionLabel : null}
                running={isRunning}
                model={fiveSystemModel}
                runtime={htmlRuntime}
                onAction={handleHtmlAction}
                onHoverBinding={handleHoverBinding}
                onActivePageChange={setActiveSpecPageId}
                view={stageView}
                className="min-h-0 min-w-0 flex-1"
              />
              {xrayOn && fiveSystemModel && appSchema && (
                <XrayPanel
                  model={fiveSystemModel}
                  schema={appSchema}
                  activePageId={activeSpecPageId}
                  target={xrayTarget}
                  onOpenSystem={setDrawerSkill}
                />
              )}
            </div>
          </>
        ) : stage === "live" ? (
          /* 模型还没成形（轮内步骤 / 起草早期）：右侧只报"推演中"——实时想法
             已在左栏流出（用户反馈：右侧别重复直播内容），应用成形后接管舞台。 */
          <div
            className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3"
            data-testid="sliderule-live-stage"
          >
            <span className="inline-flex items-end gap-1.5">
              {[0, 1, 2].map(i => (
                <span
                  key={i}
                  className="sr-dot h-2 w-2 rounded-full bg-[#1677ff]"
                  style={{ animationDelay: `${i * 160}ms` }}
                />
              ))}
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
          <>
            {/* 推演剧场 / 证据看板：六系统缩略 + 16:9 系统屏。
                执行期隐藏 tab 切换栏（用户反馈：与"生成中"覆盖层重复、
                且此时点击切换无意义），闭环后出现供浏览。
                E27：被闸拦截且 0 证据时也隐藏——六个屏全是空态，切换无意义，
                右侧只留极简错误页（用户定稿风格）。 */}
            {!isRunning &&
              !(
                publishClosure?.blocked &&
                (publishClosure?.evidencePresentCount ?? 0) === 0
              ) && (
              <div className="flex shrink-0 items-center">
                <SkillThumbnailBar
                  activeSkillId={displaySkillId}
                  publishClosure={publishClosure}
                  onSelect={handleThumbnailSelect}
                />
                {versionToolbar}
              </div>
            )}
            {/* D3 修复（2026-07-27）：0 证据 blocked 态缩略条整行隐藏是对的
                （六屏全空），但版本工具栏必须逆势可见——这正是用户唯一的
                恢复入口（回退到还能跑的版本），藏起来等于"失败即失去作品"。 */}
            {!isRunning &&
              publishClosure?.blocked &&
              (publishClosure?.evidencePresentCount ?? 0) === 0 &&
              versionToolbar && (
                <div className="flex shrink-0 items-center justify-end">
                  {versionToolbar}
                </div>
              )}

            <ActiveSystemScreen
              activeSkillId={displaySkillId}
              running={isRunning}
              publishClosure={publishClosure}
              latestMermaid={latestMermaid}
              skillContents={skillContents}
              skillRuntimeGraph={skillRuntimeGraph}
              sessionId={sessionId}
              appTitle={appTitle}
              className="min-h-0 flex-1"
            />
          </>
        )}

        {/* 系统屏抽屉：单类别全幅呈现——点哪类看哪类（用户反馈：去六系统切换条、去白卡嵌套、占满区域） */}
        {drawerSkill && (
          <div
            className="absolute inset-0 z-40 flex flex-col bg-[var(--sr-shell-bg,#ffffff)]"
            data-testid="sliderule-system-drawer"
          >
            <div className="flex shrink-0 items-center gap-2 px-4 pb-1 pt-3">
              <span className="text-[13px] font-semibold text-stone-800">
                {SKILL_LABELS[drawerSkill]}
              </span>
              <span className="text-[11px] text-stone-400">
                游标透视 · 应用背后的声明
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
        <RecordFormDrawer
          model={fiveSystemModel}
          state={htmlRuntime}
          request={recordAction}
          onClose={() => setRecordAction(null)}
          onApply={applyRuntime}
        />
      </div>
    </div>
  );
}
