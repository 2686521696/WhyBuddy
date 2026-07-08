/**
 * Product surface palette — warm "paper" skin (换肤 C):
 * cream/ivory page (#FAF9F5 base, #F5F1EA wells), warm ink text (#1F1E1B),
 * single coral accent (#D97757, hover #C4633F, tint #F8E8E0),
 * soft warm-gray borders (#E7E2D9). Success/danger stay green/red.
 */
export const autopilotTheme = {
  /** Full-screen canvas host — graph under floating HUD layers. */
  /* 纯平 #FAF9F5：与左右面板同底，底部指令条区域不再出现渐变异色带（用户反馈） */
  immersionPage:
    "relative h-screen w-screen overflow-hidden bg-[#FAF9F5] text-[#1F1E1B]",
  immersionCanvas: "absolute inset-0 z-0",
  immersionOverlayTop:
    "pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-col gap-2 px-2 pt-2 sm:gap-2.5 sm:px-3 sm:pt-2",
  immersionOverlayHeader:
    "pointer-events-auto w-full",
  /** 架构树节拍 — 顶栏下方、右对齐，预留顶栏右侧放 Dev / 导出等操作 */
  immersionOverlayArchRow: "pointer-events-none flex w-full justify-end",
  immersionHudLeft:
    "pointer-events-auto flex min-w-0 flex-1 flex-col gap-1.5",
  immersionHudRight:
    "pointer-events-auto w-[min(100%,600px)] shrink-0 sm:w-[min(52vw,560px)] lg:w-[min(48vw,600px)]",
  overlayTransparent: "bg-transparent",
  overlayBar:
    "flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-0 py-1 text-[11px] text-stone-700",
  immersionOverlayBottom:
    "pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center px-5 pb-[max(28px,env(safe-area-inset-bottom))] pt-1 sm:px-6 sm:pb-[max(34px,env(safe-area-inset-bottom))]",
  glassPanel:
    "pointer-events-auto max-h-[min(70vh,520px)] w-[min(100%,340px)] overflow-hidden rounded-2xl border border-[#F0EBE2]/80 bg-[#FDFCF9]/80 px-3 py-3 shadow-[0_8px_32px_rgb(68_60_44/0.10)] backdrop-blur-xl sm:px-4 sm:py-3.5",
  glassPanelWide:
    "pointer-events-auto max-w-[min(100%,560px)] rounded-2xl border border-[#F0EBE2]/80 bg-[#FDFCF9]/80 px-3 py-3 shadow-[0_8px_32px_rgb(68_60_44/0.10)] backdrop-blur-xl sm:px-4 sm:py-3.5",
  composerDock:
    "rounded-2xl border border-[#EFEAE0]/90 bg-[#FFFEFB]/90 px-3 py-3 shadow-[0_12px_40px_rgb(68_60_44/0.12)] backdrop-blur-2xl sm:px-4",
  composerDockWidth: "w-full max-w-[min(100%,760px)]",

  page: "relative flex h-screen flex-col bg-[#F5F1EA] text-[#1F1E1B]",
  header: "flex items-center justify-between border-b border-[#E7E2D9] bg-[#FAF9F5] px-4 py-3",
  label: "font-mono text-[10px] uppercase tracking-[0.06em] text-[#78716C]",
  goal: "truncate text-sm font-medium tracking-tight text-[#1F1E1B]",
  split: "flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row",
  /** Left reasoning map takes majority width (screenshot parity with wall-fixture). */
  flowPanelWide:
    "flex min-h-[320px] min-w-0 flex-[1.35] flex-col border-b border-[#E7E2D9] bg-[#FFFEFB] lg:min-h-0 lg:border-b-0 lg:border-r",
  flowPanel:
    "flex min-h-[280px] min-w-0 flex-1 flex-col border-b border-[#E7E2D9] bg-[#FFFEFB] lg:min-h-0 lg:border-b-0 lg:border-r",
  flowPanelHeader:
    "flex shrink-0 items-center justify-between border-b border-[#E7E2D9] px-4 py-2",
  flowPanelBody: "relative min-h-0 flex-1",
  flowEmpty:
    "flex h-full items-center justify-center px-6 text-center text-sm text-stone-500",
  imPanel: "flex w-full min-h-0 flex-col bg-[#F5F1EA] lg:w-[min(420px,34%)] xl:w-[min(440px,32%)] lg:shrink-0",
  main: "flex-1 overflow-auto px-4 py-4",
  footer: "shrink-0 border-t border-[#E7E2D9] bg-[#FAF9F5] px-4 py-3",

  emptyState:
    "rounded-lg border border-dashed border-[#D8D1C4] bg-[#F5F1EA] px-6 py-12 text-center text-sm font-medium text-stone-500",
  emptyHint: "mt-4 text-xs font-normal text-stone-400",

  userBubble:
    "max-w-[85%] rounded-lg border border-[#E7E2D9] bg-[#FFFEFB] px-4 py-2.5 text-sm font-semibold leading-6 text-stone-700 shadow-[0_1px_2px_rgb(68_60_44,0.05)]",

  artifactCard:
    "group rounded-lg border border-[#E7E2D9] bg-[#FFFEFB] p-3 text-sm shadow-[0_1px_2px_rgb(68_60_44,0.05)]",
  artifactTitle: "font-semibold text-stone-800",
  artifactBody: "mt-3 whitespace-pre-wrap text-xs leading-relaxed text-stone-600",
  artifactMeta:
    "rounded-md bg-[#F0EDE5] px-2 py-0.5 text-stone-600 ring-1 ring-inset ring-[#E7E2D9]",
  artifactExpand: "text-[11px] text-stone-400",

  actionVerify: "text-stone-600 hover:text-[#1F1E1B] hover:underline",
  actionChallenge: "text-amber-700 hover:text-amber-900 hover:underline",

  input:
    "flex-1 rounded-lg border border-[#E7E2D9] bg-[#F5F1EA] px-3 py-2.5 text-sm font-semibold leading-6 text-stone-700 outline-none transition placeholder:text-stone-400 focus:border-[#D97757]/50 focus:ring-2 focus:ring-[#D97757]/15",
  sendBtn:
    "rounded-lg bg-[#D97757] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#C4633F] active:scale-[0.98]",
  hintChip:
    "rounded-full border border-[#E7E2D9] bg-[#FFFEFB] px-2 py-0.5 text-[10px] font-medium text-stone-600 transition hover:border-[#D8D1C4] hover:bg-[#F5F1EA] hover:text-stone-800",

  auditBtn:
    "rounded-full border border-[#E7E2D9]/90 bg-[#FFFEFB]/90 px-3 py-1.5 text-[11px] font-semibold text-stone-700 shadow-sm transition hover:bg-white",
  devLink: "text-[10px] !text-stone-500 transition hover:!text-stone-800 hover:underline",

  liveActionThink: "text-sm text-stone-500",
  liveActionExternal: "text-sm text-[#C4633F]",
  actionTrace:
    "mb-1 block text-[11px] text-[#D97757] transition hover:text-[#C4633F] hover:underline",

  drawerOverlay: "flex-1 bg-[#2A2620]/30 backdrop-blur-[1px]",
  drawer: "flex h-full w-full max-w-xl flex-col border-l border-[#E7E2D9] bg-[#FAF9F5] shadow-2xl",
  drawerHeader: "flex items-center justify-between border-b border-[#E7E2D9] px-4 py-3",
  drawerTitle: "text-sm font-semibold text-[#1F1E1B]",
  drawerSubtitle: "text-[10px] text-stone-500",
  drawerClose: "text-stone-500 transition hover:text-stone-800",
  drawerBody: "flex-1 space-y-4 overflow-auto p-4 text-[11px] text-stone-700",
  drawerChip: "rounded bg-[#F0EDE5] px-2 py-0.5 font-mono text-stone-500",
  drawerBtn:
    "rounded border border-[#E7E2D9] px-2 py-1 text-stone-600 transition hover:bg-[#F5F1EA] hover:text-[#1F1E1B]",
  drawerBtnDanger:
    "rounded border border-rose-200 px-2 py-1 text-rose-700 transition hover:bg-rose-50",
  drawerBtnAccent:
    "rounded border border-[#D8D1C4] px-2 py-1 font-medium text-stone-800 transition hover:bg-[#F5F1EA]",
  drawerPanel: "rounded-lg border border-[#E7E2D9] bg-[#F5F1EA] p-2",

  latestUserBubble:
    "pointer-events-auto max-w-full truncate rounded-full border border-[#E7E2D9] bg-[#FFFEFB]/90 px-3 py-1 text-[11px] text-stone-600 shadow-sm backdrop-blur",
  latestUserBubbleMarathon:
    "pointer-events-auto max-w-full truncate rounded-full border border-[#EBCEC0] bg-[#F8E8E0]/90 px-3 py-1 text-[11px] text-[#B0552F] shadow-sm backdrop-blur",
  grokInputBar:
    "pointer-events-auto flex min-h-[64px] w-full items-center gap-0 rounded-[32px] border border-[#F0EBE2]/90 bg-[#FFFEFB]/95 px-4 py-2.5 shadow-[0_18px_52px_rgb(68_60_44/0.10)] ring-1 ring-[#E7E2D9]/50 backdrop-blur-xl",
  grokInputBarMarathon:
    "pointer-events-auto flex min-h-[64px] w-full items-center gap-0 rounded-[32px] border border-[#F3DCD0]/85 bg-[#FFFEFB]/95 px-4 py-2.5 shadow-[0_18px_52px_rgb(217_119_87/0.13)] ring-1 ring-[#F3DCD0]/70 backdrop-blur-xl",
  grokInput:
    "h-11 max-h-[116px] w-full min-w-0 resize-none overflow-y-auto bg-transparent px-4 py-[9px] text-[14px] leading-[22px] text-stone-800 outline-none placeholder:text-stone-400",
  grokSendBtn:
    "inline-flex h-11 shrink-0 items-center justify-center rounded-full bg-[#D97757] px-5 text-sm font-bold text-white shadow-sm transition hover:bg-[#C4633F] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40",
  grokSendBtnMarathon:
    "inline-flex h-11 shrink-0 items-center justify-center rounded-full bg-[#C4633F] px-5 text-sm font-bold text-white shadow-sm transition hover:bg-[#B0552F] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40",
} as const;
