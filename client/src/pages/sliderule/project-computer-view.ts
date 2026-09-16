/**
 * 右侧「它的电脑」此刻该停在哪一档。
 *
 * ## 为什么要这个（2026-09-14，对照 Manus 整页截图）
 *
 * 2026-09-13 第一版把 `ProjectComputerPanel` 叠在预览上面、各吃一截
 * （`max-h-[38%]`）。真机上两边都看不清：终端被裁成三行，预览被挤到
 * 下半屏。Manus 右侧是**一块**电脑——干活时看终端，跑起来看预览，
 * 点了下拉就钉住。叠是第一版的权宜，不是产品形态。
 *
 * 决策抽纯函数：组件判据走静态渲染，点不了下拉；自动切档的条件
 * 必须能被变异咬住（§2），不能只写在 JSX 的三元里。
 *
 * ⚠ 用户点过下拉 → 听用户的。没点过才自动切。把「预览已经能打开」
 *   写成强制切档，会把正在看终端回放的人拽走。
 */

export const COMPUTER_VIEWS = [
  "computer",
  "preview",
  "source",
  "history",
  "data",
  "delivery",
] as const;

export type ComputerView = (typeof COMPUTER_VIEWS)[number];

export function isComputerView(value: string): value is ComputerView {
  return (COMPUTER_VIEWS as readonly string[]).includes(value);
}

/**
 * 右侧该不该是「它的电脑」，而不是 HTML 推演的接线沙盘。
 *
 * ## 为什么要这个（2026-09-15，对照 Manus 整页）
 *
 * 真机 TicketStream：计划已经批准、待办也写了 8 条，右侧却是
 * 「推演完成后这里是五系统接线沙盘」。会话 `runtimeKind` 还停在
 * `html-prototype`，因为「进入工程工作台」那颗钮 2026-09-14 卸了，
 * `onCreateProject` 在 Unified 里被写成 `_onCreateProject` 再没人叫。
 *
 * Manus 右侧从干活开始就是电脑。计划批准（或已经在创建）时，
 * 哪怕 `projectId` 还没回来，也要先铺这块壳，不许把人扔回 C4。
 *
 * ⚠ 判据必须能被变异咬住：把 `canCreateProject` 拿掉，批准后的
 *   会话会再掉回沙盘，下面那条反向必红。
 */
export function shouldShowProjectComputer(input: {
  runtimeKind?: string | null;
  projectId?: string | null;
  canCreateProject?: boolean;
  creating?: boolean;
}): boolean {
  if (input.runtimeKind === "project") return true;
  if (String(input.projectId || "").trim()) return true;
  if (input.creating) return true;
  return Boolean(input.canCreateProject);
}

/**
 * 批准计划之后要不要立刻 POST 创建工程。
 *
 * 钮卸了，这条就必须自动走。运行中不抢；已经在创建或上次失败
 * 都不重打——失败要留在台面上，不许静默空转。
 */
export function shouldAutoCreateProject(input: {
  canCreateProject: boolean;
  isRunning: boolean;
  createStatus: "idle" | "creating" | "error";
}): boolean {
  return (
    input.canCreateProject &&
    !input.isRunning &&
    input.createStatus === "idle"
  );
}

/**
 * 没点过下拉时，右侧停在哪一档。
 *
 * ⚠ 2026-09-15 TicketStream：左栏全是「导入源码」，自动切档却只看
 *   hasActivity → 终端。终端脸只画 PTY 字节，导入不产生字节，右侧白纸。
 *   人点工具行已经走 `computerViewForAction`（写入→源码），自动切档
 *   没用——又是成对物只改一半。
 *
 *   有动作在跑 → 按这一步的档（写入看源码，命令看终端），预览再就绪也不拽走
 *   预览已经有能用的地址 → 预览
 *   有过动作但预览还没开 → 按最后一步的档，不许停在没 PTY 的白纸上
 *   什么都没有 → 预览（空会话的默认面孔，跟没接 turns 的应用中心一致）
 */
export function resolveComputerView(input: {
  userPinned: ComputerView | null;
  live: boolean;
  hasActivity: boolean;
  previewReady: boolean;
  lastTool?: string | null;
  hasConsole?: boolean;
}): ComputerView {
  if (input.userPinned) return input.userPinned;
  const fromTool = input.lastTool ? computerViewForAction(input.lastTool) : null;
  if (input.live) return fromTool ?? "computer";
  if (input.previewReady) return "preview";
  if (input.hasActivity) {
    if (fromTool && fromTool !== "computer") return fromTool;
    if (fromTool === "computer" && input.hasConsole === false) return "source";
    return fromTool ?? "computer";
  }
  return "preview";
}

/**
 * 左栏点了哪一种工具，右侧该打开哪一档。
 *
 * ⚠ 2026-09-14 第二轮对照 Manus：左栏工具行是**开关**，不是说明书。
 *   点「写入源码」右侧打开代码，点「运行命令」打开终端，点结果卡打开预览。
 *   第一版只做了自动切档，行本身点了没反应——看起来像清单，用起来不像电脑。
 *
 * 认工具名，不解析 label。未知的 `project_*` 落到终端：那一档能摊开
 * 脱敏摘要，比把人扔进一块空预览诚实。
 *
 * ⚠ 2026-09-15 TicketStream `sr-20260915141613-WBPAY2T4V3`：左栏是
 *   创建工程 / 读取工程列表，右侧钉在终端白纸。`project_list` /
 *   `project_search` 是店里读清单，不产 PTY，却被当成未知工具落到
 *   「computer」。终端脸只画 `runtime.console`，没有字节就空着——
 *   不是壳坏了，是看错档。
 */
export function computerViewForAction(tool: string): ComputerView {
  const name = String(tool || "").trim();
  if (
    name === "project_patch" ||
    name === "project_write" ||
    name === "project_str_replace" ||
    name === "file_read" ||
    name === "file_write" ||
    name === "file_str_replace" ||
    name === "file_find_in_content" ||
    name === "file_find_by_name" ||
    name === "read_file" ||
    name === "write_file" ||
    name === "search_replace" ||
    name === "grep" ||
    name === "list_dir" ||
    name === "glob" ||
    name === "project_read" ||
    name === "project_create" ||
    name === "project_export" ||
    name === "project_list" ||
    name === "project_search"
  ) {
    return "source";
  }
  if (
    name === "project_start" ||
    name === "project_verify" ||
    name === "project_status" ||
    name === "browser_view" ||
    name === "browser_navigate" ||
    name === "browser_restart" ||
    name === "browser_click" ||
    name === "browser_input" ||
    name === "browser_console_exec" ||
    name === "deploy_expose_port" ||
    name === "deploy_apply_deployment" ||
    name === "make_manus_page"
  ) {
    return "preview";
  }
  if (name === "project_revisions" || name === "project_restore") {
    return "history";
  }
  if (name === "project_delivery" || name === "project_verification") {
    return "delivery";
  }
  return "computer";
}

export const INSPECT_ACTION_EVENT = "sliderule:inspect-action";

export type InspectActionDetail = {
  id: string;
  tool: string;
  /**
   * 只钉这一步、不切档。电脑面板自己的前后翻用——人已经在看终端回放，
   * 翻到一条 patch 不该把整面拽去源码。
   */
  keepView?: boolean;
};

export function inspectActionDetail(value: unknown): InspectActionDetail | null {
  if (!value || typeof value !== "object") return null;
  const id = String((value as { id?: unknown }).id || "").trim();
  const tool = String((value as { tool?: unknown }).tool || "").trim();
  if (!id || !tool) return null;
  return {
    id,
    tool,
    ...((value as { keepView?: unknown }).keepView ? { keepView: true } : {}),
  };
}

export function dispatchInspectAction(detail: InspectActionDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(INSPECT_ACTION_EVENT, { detail }));
}

/** 从回放回到跟着最新那条走。Manus 那颗「跳到实时」。 */
export const FOLLOW_COMPUTER_EVENT = "sliderule:follow-computer";

export function dispatchFollowComputer(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(FOLLOW_COMPUTER_EVENT));
}
