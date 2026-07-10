/**
 * user-prefs — 「偏好」设置的单一来源（2026-07-10 用户裁决四件套）。
 *
 * 全部 localStorage 持久化、纯函数读写；生效路径各自注明：
 * - 减少动态效果：根元素 class `sr-reduce-motion`（CSS 覆盖）+
 *   RollingText 运行时判断；同时自动尊重系统 prefers-reduced-motion；
 * - 推演完成通知：浏览器 Notification（切走标签页才弹，盯着看不打扰）；
 * - Enter 键行为：ComposerDock keydown 每次按键实时读取（设置即改即生效）。
 */

const REDUCE_MOTION_KEY = "sliderule:reduce-motion";
const NOTIFY_COMPLETE_KEY = "sliderule:notify-complete";
const ENTER_TO_SEND_KEY = "sliderule:enter-to-send";

const REDUCE_MOTION_CLASS = "sr-reduce-motion";

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === "1";
  } catch {
    return fallback;
  }
}

function writeFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    /* 存储不可用 → 本次会话内仍按调用方内存态生效 */
  }
}

// --- 减少动态效果 --------------------------------------------------------------

export function loadReduceMotionPref(): boolean {
  return readFlag(REDUCE_MOTION_KEY, false);
}

/** 用户显式偏好 或 系统 prefers-reduced-motion，任一命中即减少动效。 */
export function isMotionReduced(): boolean {
  if (loadReduceMotionPref()) return true;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** 把偏好落到根元素 class（CSS 覆盖 sr-dot / sr-caret 等动画）。 */
export function applyReduceMotionClass(): void {
  try {
    document.documentElement.classList.toggle(
      REDUCE_MOTION_CLASS,
      loadReduceMotionPref()
    );
  } catch {
    /* 非浏览器环境（测试静态渲染）忽略 */
  }
}

export function setReduceMotionPref(value: boolean): void {
  writeFlag(REDUCE_MOTION_KEY, value);
  applyReduceMotionClass();
}

// --- 推演完成通知 --------------------------------------------------------------

export function loadNotifyCompletePref(): boolean {
  return readFlag(NOTIFY_COMPLETE_KEY, false);
}

export function setNotifyCompletePref(value: boolean): void {
  writeFlag(NOTIFY_COMPLETE_KEY, value);
}

/**
 * 开启通知偏好：需要浏览器授权。返回最终是否可用——被拒绝时如实返回
 * false（调用方保持开关关闭并提示，不装作开了）。
 */
export async function enableCompletionNotify(): Promise<boolean> {
  try {
    if (typeof Notification === "undefined") return false;
    let permission = Notification.permission;
    if (permission === "default") {
      permission = await Notification.requestPermission();
    }
    const ok = permission === "granted";
    setNotifyCompletePref(ok);
    return ok;
  } catch {
    return false;
  }
}

/** 推演完成时机调用：偏好开 + 已授权 + 用户不在本标签页 才弹（盯着看不打扰）。 */
export function notifyDriveComplete(topic: string): void {
  try {
    if (!loadNotifyCompletePref()) return;
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;
    if (!document.hidden) return;
    new Notification("SlideRule 推演完成", {
      body: topic
        ? `「${topic.slice(0, 40)}」已闭环，回来看看结果`
        : "本轮推演已完成",
    });
  } catch {
    /* 通知失败不影响主流程 */
  }
}

// --- Enter 键行为 --------------------------------------------------------------

export type EnterBehavior = "enter" | "ctrl-enter";

export function loadEnterBehavior(): EnterBehavior {
  return readFlag(ENTER_TO_SEND_KEY, true) ? "enter" : "ctrl-enter";
}

export function setEnterBehavior(behavior: EnterBehavior): void {
  writeFlag(ENTER_TO_SEND_KEY, behavior === "enter");
}

/** keydown 判定：本次按键是否应触发发送（Shift+Enter 恒为换行）。 */
export function shouldSendOnKey(ev: {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}): boolean {
  if (ev.key !== "Enter" || ev.shiftKey) return false;
  return loadEnterBehavior() === "enter"
    ? !ev.ctrlKey && !ev.metaKey
    : ev.ctrlKey || ev.metaKey;
}

// --- Work 巡演 LLM 台词（五期入魂档，默认关）-----------------------------------

const TOUR_LLM_KEY = "sliderule:tour-llm";

export function loadTourLlmPref(): boolean {
  return readFlag(TOUR_LLM_KEY, false);
}

export function setTourLlmPref(value: boolean): void {
  writeFlag(TOUR_LLM_KEY, value);
}

/** 应用启动时调用一次：把持久化偏好落到 DOM。 */
export function initUserPrefs(): void {
  applyReduceMotionClass();
}
