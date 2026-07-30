/**
 * 分批挂载排队器。
 *
 * 这些测试钉的都是"不这么写就等于没分批"的点，不是形式上的 API 契约。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  __resetSchedulerForTests,
  __setBatchSizeForTests,
  pendingMountCount,
  requestMountPermit,
} from "../mount-scheduler";

afterEach(() => {
  __resetSchedulerForTests();
  vi.unstubAllGlobals();
});

/** 把让出主线程变成可手动推进的队列（默认实现是 setTimeout）。 */
function stubYieldSync() {
  const tasks: Array<() => void> = [];
  vi.stubGlobal("setTimeout", ((cb: () => void) => {
    tasks.push(cb);
    return 0;
  }) as unknown as typeof setTimeout);
  return {
    /** 推进一批 */
    step() {
      const next = tasks.shift();
      next?.();
    },
    get queued() {
      return tasks.length;
    },
  };
}

describe("requestMountPermit", () => {
  it("第一批也要让出主线程——立刻挂就并进同一个长任务，等于没分批", () => {
    const y = stubYieldSync();
    const granted: number[] = [];
    requestMountPermit(() => granted.push(1));
    // 注册完还没让出：一张都不该放行
    expect(granted).toEqual([]);
    y.step();
    expect(granted).toEqual([1]);
  });

  it("按批放行，批与批之间让出主线程一次", () => {
    __setBatchSizeForTests(3);
    const y = stubYieldSync();
    const granted: number[] = [];
    for (let i = 0; i < 7; i++) requestMountPermit(() => granted.push(i));

    y.step();
    expect(granted).toEqual([0, 1, 2]);
    y.step();
    expect(granted).toEqual([0, 1, 2, 3, 4, 5]);
    y.step();
    expect(granted).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("取消后不再放行——卡片在拿到许可前被卸载是常态（滚出去/切页/改搜索）", () => {
    __setBatchSizeForTests(2);
    const y = stubYieldSync();
    const granted: string[] = [];
    requestMountPermit(() => granted.push("a"));
    const cancelB = requestMountPermit(() => granted.push("b"));
    requestMountPermit(() => granted.push("c"));
    cancelB();
    y.step();
    expect(granted).toEqual(["a", "c"]);
    expect(pendingMountCount()).toBe(0);
  });

  it("单张挂载抛错不拖住整队", () => {
    __setBatchSizeForTests(1);
    const y = stubYieldSync();
    const granted: string[] = [];
    requestMountPermit(() => {
      throw new Error("这张卡的模型坏了");
    });
    requestMountPermit(() => granted.push("后面这张还得挂上"));
    y.step();
    y.step();
    expect(granted).toEqual(["后面这张还得挂上"]);
  });

  it("默认走真实定时器而不是 scheduler.postTask——实测 postTask 长任务数不变，等于没让", () => {
    // 实测（生产构建 n=14）：一起挂 4106ms / postTask 分批 4169ms（长任务还是
    // 4 个）/ 定时器分批 3453ms（−16%，5 个）。postTask 排进去的几批在主线程
    // 空闲时背靠背跑完、合并进同一个长任务——让出了任务队列，没让出一次绘制。
    const postTask = vi.fn();
    vi.stubGlobal("scheduler", { postTask });
    const timers: Array<() => void> = [];
    vi.stubGlobal("setTimeout", ((cb: () => void) => {
      timers.push(cb);
      return 0;
    }) as unknown as typeof setTimeout);
    const granted: number[] = [];
    requestMountPermit(() => granted.push(1));
    expect(postTask).not.toHaveBeenCalled();
    timers.shift()?.();
    expect(granted).toEqual([1]);
  });

  it("不用 requestAnimationFrame——rAF 回调跑在绘制前，在里面挂载正好帮倒忙", () => {
    const raf = vi.fn();
    vi.stubGlobal("requestAnimationFrame", raf);
    vi.stubGlobal("setTimeout", ((cb: () => void) => {
      void cb;
      return 0;
    }) as unknown as typeof setTimeout);
    requestMountPermit(() => {});
    expect(raf).not.toHaveBeenCalled();
  });
});
