/**
 * 卡片缩略图采集（2026-08-02）。
 *
 * ## 这一层在干嘛
 *
 * 应用中心的卡片缩略图有三级来源，靠前的更可信：
 *
 *   ① shot  —— 应用真实渲染出来之后截的图，**就是应用本身**（这个模块产出的）
 *   ② sheet —— 生成时给设计 LLM 排版式用的那张首页参照板，是示意图
 *   ③ 活渲染 —— 前两级都没有时，卡片现挂一个真的 AppRuntimeScreen
 *
 * 采集就发生在 ③ 上：**既然那次昂贵的渲染已经发生了，就地把它采下来存住**，
 * 于是「这次活渲染是最后一次」。下次进应用中心，这张卡贴的是图。
 *
 * 为什么不放在服务端起个无头浏览器去截：那等于把同一个应用再渲染一遍，还要背
 * 上沙盒/容器/浏览器安装那一整套运维面。副作用还是白赚的——**存量应用会被自动
 * 补上**：它们没有会话可供服务端打开（会话不跨重启存活），但只要有人看见过那
 * 张卡，它就有图了。
 *
 * ## 为什么截的是缩放之前那一层
 *
 * 活渲染是把 1440×810（或手机档 390×844）的画布用 CSS transform 缩到 309px
 * 宽的卡片里。直接截卡片只能得到 309px 宽的糊图；截 transform 之前那一层拿到
 * 的是画布原尺寸，再乘 pixelRatio，才是一张能用的缩略图。
 *
 * ## 节流的纪律
 *
 * 单张实测约 3.6s，且最后合成那一下是同步的。所以：**全局串行**（一次只采一
 * 张）、**只采进了视口的**、**每次访问最多采几张**。缩略图是锦上添花，绝不能
 * 为了它把正在浏览的人卡住——这跟当初把活渲染分批挂载是同一个取向
 * （见 lib/mount-scheduler.ts）。
 */

import { aspectForDevice } from "./justified-rows";

/** 目标画幅：跟参照板出图、跟卡片比例三者对齐（见 justified-rows 的 DEVICE_ASPECT）。 */
const SHOT_CANVAS: Record<string, { w: number; h: number }> = {
  desktop: { w: 1280, h: 720 },
  tablet: { w: 1280, h: 720 },
  phone: { w: 720, h: 1280 },
};

/**
 * 一次访问最多采几张。
 *
 * 不设上限的话，第一次打开一个有 200 张卡的墙 = 200 次各 3.6s 的采集，
 * 页面全程发烫。设成 3：一次访问补 3 张，多来几次就补完了，而用户在任何一次
 * 访问里最多只付 3 次的代价。
 */
const MAX_PER_VISIT = 3;

/** 采完之后等一拍再采下一张，把主线程还给滚动和输入。 */
const GAP_MS = 400;

let capturedThisVisit = 0;
/** 全局串行锁：一次只采一张。 */
let chain: Promise<unknown> = Promise.resolve();
/** 本次访问已经处理过的 app_id——失败的也记，避免对着同一张卡反复重试。 */
const attempted = new Set<string>();

/** 测试用：把模块状态清回初始。生产代码不要调。 */
export function __resetCaptureStateForTests(): void {
  capturedThisVisit = 0;
  chain = Promise.resolve();
  attempted.clear();
}

export function captureBudgetLeft(): number {
  return Math.max(0, MAX_PER_VISIT - capturedThisVisit);
}

/**
 * 把采到的画布按目标画幅裁一刀。
 *
 * 从**左上角**切，不是居中裁：桌面档画布本来就是 16:9，切不切都一样；手机档
 * 画布是 390×844（0.462）比卡片(9:16)更窄长，居中裁会把顶部那条应用标题栏切
 * 掉，而缩略图恰恰要那一截。留头去尾跟活渲染那条路
 * （AppRuntimeScreen 的 scaleFit="width"）看到的是同一块画面。
 */
function cropToAspect(
  src: HTMLCanvasElement,
  device: string | null | undefined
): HTMLCanvasElement {
  const target = SHOT_CANVAS[(device || "").trim().toLowerCase()] ?? SHOT_CANVAS.desktop;
  const targetAspect = target.w / target.h;

  let cw = src.width;
  let ch = Math.round(cw / targetAspect);
  if (ch > src.height) {
    ch = src.height;
    cw = Math.round(ch * targetAspect);
  }
  const out = document.createElement("canvas");
  out.width = target.w * 2;
  out.height = target.h * 2;
  const ctx = out.getContext("2d");
  if (!ctx) return src;
  ctx.drawImage(src, 0, 0, cw, ch, 0, 0, out.width, out.height);
  return out;
}

/**
 * WebP 编码质量。与服务端 thumb_image.WEBP_QUALITY 保持一致（0~1 vs 0~100）。
 *
 * 参照：Next.js Image 默认 75、thumbor 默认 80、imgproxy 默认 80。取 0.82 是
 * 因为这些是**界面截图**——大片纯色加细字，比照片更吃量化噪声，稍高一档更稳。
 */
const WEBP_QUALITY = 0.82;

/**
 * 采出来的画面编码成 blob。
 *
 * **直接出 WebP，不出 PNG**（2026-08-02）。实测同样分辨率下 805KB PNG →
 * 43KB WebP，小 19 倍，而分辨率一个像素不减。这条省的是两段流量：回传时的
 * 上行，以及之后每个访客看这张卡的下行（后者才是大头——应用中心一次首屏
 * 23 张卡，10.7MB → 约 0.9MB）。
 *
 * 服务端也会再压一次（thumb_image.to_webp），那是给参照板那一路和历史存量用的；
 * 已经是 WebP 的它会原样放行，不会重复编码掉画质。
 *
 * canvas.toBlob 对不认识的 type 会**静默回落成 PNG**（规范如此），所以这里
 * 显式检查一次实际拿到的类型——回落了就如实按 PNG 走，不假装省了带宽。
 */
function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, "image/webp", WEBP_QUALITY));
}

/** 浏览器空闲时再动手——采集是给缩略图用的，永远排在用户交互后面。 */
function whenIdle(): Promise<void> {
  return new Promise(resolve => {
    const ric = (window as { requestIdleCallback?: (cb: () => void, o?: unknown) => number })
      .requestIdleCallback;
    if (ric) ric(() => resolve(), { timeout: 3000 });
    else setTimeout(resolve, GAP_MS);
  });
}

export interface CaptureRequest {
  /** 落库记录 id——回传按它写。 */
  appId: string;
  /** 活渲染的外层容器（data-testid="app-thumb-live"）。 */
  container: HTMLElement;
  /** 这个应用设计的档位，决定目标画幅。 */
  device?: string | null;
}

/**
 * 采一张并回传。**从不抛**——调用方在渲染路径上，采集失败只该意味着"这张卡
 * 这次没补上图"，下次再说。
 *
 * 返回是否真的存进去了（预算用完 / 已采过 / 找不到节点 / 回传被服务端跳过
 * 都会返回 false）。
 */
export function captureAndUpload(req: CaptureRequest): Promise<boolean> {
  const { appId, container, device } = req;
  if (!appId || !container) return Promise.resolve(false);
  if (attempted.has(appId)) return Promise.resolve(false);
  if (capturedThisVisit >= MAX_PER_VISIT) return Promise.resolve(false);
  attempted.add(appId);
  capturedThisVisit += 1;

  const run = chain.then(async () => {
    try {
      await whenIdle();
      // 缩放之前那一层：外层 transform 把画布压成了卡片大小，这里要原尺寸。
      const scaled = container.querySelector<HTMLElement>("[style*='transform']");
      const node = (scaled?.firstElementChild as HTMLElement | null) ?? scaled;
      if (!node || !node.offsetWidth || !node.offsetHeight) return false;

      const { toCanvas } = await import("html-to-image");
      const canvas = await toCanvas(node, {
        // 绕开外层那个把它缩进卡片的 transform，按画布原尺寸采
        width: node.offsetWidth,
        height: node.offsetHeight,
        pixelRatio: 2,
        backgroundColor: "#f0f2f5",
        style: { transform: "none", transformOrigin: "top left" },
        // 不去内联远程字体：应用用的是系统中文字体栈，内联一份中文 webfont 是
        // 几 MB 的下载，而且离线/被 CSP 挡住时会整张失败。实测跳过之后中文照常
        // 渲染（走系统字体），这是划算的取舍。
        skipFonts: true,
      });

      const blob = await canvasToBlob(cropToAspect(canvas, device));
      if (!blob) return false;

      const res = await fetch(`/api/sliderule/apps/${encodeURIComponent(appId)}/preview`, {
        method: "POST",
        // 按 blob 实际类型报，不写死——toBlob 不认 webp 时会静默回落成 PNG。
        headers: { "Content-Type": blob.type || "image/webp" },
        body: blob,
      });
      if (!res.ok) return false;
      const json = (await res.json().catch(() => null)) as { stored?: boolean } | null;
      return Boolean(json?.stored);
    } catch {
      // 采集是增强项：任何异常都只意味着这张卡这次没补上图。
      return false;
    }
  });

  // 串行：下一张要等这一张彻底结束（成功与否都算），中间再空一拍。
  chain = run.then(() => new Promise(r => setTimeout(r, GAP_MS)));
  return run;
}

/** 这个档位的目标画幅宽高比——给测试用，确保跟卡片比例是同一份定义。 */
export function shotAspectForDevice(device: string | null | undefined): number {
  const target = SHOT_CANVAS[(device || "").trim().toLowerCase()] ?? SHOT_CANVAS.desktop;
  return target.w / target.h;
}

/** 断言用：采集画幅必须跟卡片比例一致，否则贴上去会被 object-fit: cover 裁。 */
export function shotMatchesCardAspect(device: string | null | undefined): boolean {
  return Math.abs(shotAspectForDevice(device) - aspectForDevice(device)) < 1e-6;
}
