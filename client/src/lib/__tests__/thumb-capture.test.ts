/**
 * 缩略图采集的边界。
 *
 * 采集跑在应用中心的渲染路径上，一张实测约 3.6s。所以这份测试盯的不是"截得
 * 像不像"（那要真浏览器），而是**它绝不能把正在浏览的人卡住**：预算、去重、
 * 串行，以及画幅必须跟卡片对齐。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

import { aspectForDevice, DEVICE_ASPECT } from "@/lib/justified-rows";
import {
  captureAndUpload,
  captureBudgetLeft,
  shotAspectForDevice,
  shotMatchesCardAspect,
  __resetCaptureStateForTests,
} from "@/lib/thumb-capture";

beforeEach(() => {
  __resetCaptureStateForTests();
});

describe("采集画幅必须跟卡片比例一致", () => {
  it("三个档位逐一对齐 DEVICE_ASPECT", () => {
    // 不一致的后果很具体：卡片贴图用的是 object-fit: cover，比例对不上就会被裁
    // ——2026-08-01 手机档那次灰边 bug 的同款根因。
    for (const device of ["desktop", "tablet", "phone"]) {
      expect(shotMatchesCardAspect(device)).toBe(true);
      expect(shotAspectForDevice(device)).toBeCloseTo(DEVICE_ASPECT[device], 6);
    }
  });

  it("认不出的档位跟卡片一样按桌面处理", () => {
    // 保守的那一边：错判成桌面只是图偏宽，错判成手机会把宽版应用压进竖条里。
    for (const device of ["", null, undefined, "watch"]) {
      expect(shotAspectForDevice(device)).toBeCloseTo(aspectForDevice(device), 6);
    }
  });

  it("手机档就是 9:16——四张表必须同比", () => {
    // 这条原先断言的是"截图画幅 ≠ 渲染画布"（08-01 的状态：卡片对齐了出图，
    // 画布还是 390×844）。08-03 把画布也改成 9:16 之后，分叉不该再存在，
    // 断言从"钉住区别"改成"钉住一致"。
    //
    // 为什么值得钉：那次分叉的症状**被中间那一环藏起来了**——卡片是对的，
    // 光看应用中心看不出问题，只有把生成出来的应用真的打开、跟参照图并排
    // 比才发现版式被拉长了 22%。
    expect(shotAspectForDevice("phone")).toBeCloseTo(0.5625, 6);
    expect(aspectForDevice("phone")).toBeCloseTo(0.5625, 6);
  });
});

describe("绝不能拖住浏览的人", () => {
  // 仓库里没有 jsdom（React 测试统一走 renderToStaticMarkup），所以用桩对象。
  // captureAndUpload 只会碰 container.querySelector——查不到缩放层就是采集失败，
  // 正好是这些用例要断言的那条路径。
  const fakeContainer = () =>
    ({ querySelector: () => null }) as unknown as HTMLElement;

  it("缺 appId 或容器直接不采", async () => {
    expect(await captureAndUpload({ appId: "", container: fakeContainer() })).toBe(false);
    expect(
      await captureAndUpload({ appId: "a", container: null as unknown as HTMLElement })
    ).toBe(false);
    expect(captureBudgetLeft()).toBe(3);
  });

  it("同一个 app 只尝试一次——失败的也算", async () => {
    // 找不到缩放层 → 采集失败。但**不能重试**：这张卡会随滚动反复进出视口，
    // 每次都重来一遍就是把失败变成一个循环开销。
    const c = fakeContainer();
    expect(await captureAndUpload({ appId: "same", container: c })).toBe(false);
    const budgetAfterFirst = captureBudgetLeft();
    expect(await captureAndUpload({ appId: "same", container: c })).toBe(false);
    expect(captureBudgetLeft()).toBe(budgetAfterFirst); // 第二次连预算都没扣
  });

  it("一次访问最多采几张，超了就不采", async () => {
    // 不设上限的话，第一次打开一个 200 张卡的墙 = 200 次各 3.6s 的采集。
    const budget = captureBudgetLeft();
    expect(budget).toBeGreaterThan(0);
    for (let i = 0; i < budget; i++) {
      await captureAndUpload({ appId: `app-${i}`, container: fakeContainer() });
    }
    expect(captureBudgetLeft()).toBe(0);

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await captureAndUpload({ appId: "over-budget", container: fakeContainer() })).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("采集异常不外抛——调用方在渲染路径上", async () => {
    // 容器里没有缩放层、html-to-image 抛错、fetch 挂掉……任何一种都只该意味着
    // "这张卡这次没补上图"，绝不能把一个渲染中的组件炸掉。
    const broken = {
      querySelector: () => {
        throw new Error("boom");
      },
    } as unknown as HTMLElement;
    await expect(captureAndUpload({ appId: "x", container: broken })).resolves.toBe(false);
  });
});
