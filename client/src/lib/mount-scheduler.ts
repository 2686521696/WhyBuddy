/**
 * 分批挂载排队器（2026-07-30）。
 *
 * 起因是实测数据。应用中心的卡片各挂一个 AppRuntimeScreen（真渲染，不是截图），
 * 压测台 scripts/app-wall-perf.mjs 在 dev 下量到：
 *
 *     n=4   最长单任务 1814ms      n=8   2789ms
 *     n=14  3987ms                n=20  5582ms
 *
 * 滚动全档稳在 59-60fps，堆内存 20 张才 172MB——**问题 100% 在首屏挂载**，
 * 而且最长单任务几乎与张数成正比：十几张卡一起挂，主线程被连续堵将近四秒，
 * 这四秒里页面点不动滚不动。用户的感受不是"掉帧"，是"卡死了一下"。
 *
 * 所以对症的解法不是虚拟化（堆内存很宽裕，杀鸡用牛刀），而是**把一次长阻塞
 * 切成几段短的**：每批放行几张，批与批之间**让出主线程**，浏览器得以绘制上
 * 一批、并响应用户输入。总墙钟会略长一点，换来的是页面始终可交互，视觉上
 * 卡片依次点亮——比整屏冻四秒好得多，也不用改版式。
 *
 * 为什么单独成模块而不是写在组件里：排队必须是**全局共享**的。每张卡自己
 * 计时或自己 setTimeout 等于没排队——十几个定时器在同一帧到期，还是一起挂。
 *
 * 让出主线程优先用 scheduler.postTask（可中断、可被用户输入抢占），退化到
 * requestIdleCallback，最后才是 setTimeout(0)。**不用 requestAnimationFrame**：
 * rAF 回调跑在绘制前，在里面挂载等于把长任务塞进关键帧，正好帮倒忙。
 */

/** 每批放行几张。3 是在"批数不要太多"和"单批不要太长"之间取的折中——
 *  实测单张挂载边际成本约 200ms，3 张一批约 600ms，低于 1s 的可感阈值。 */
const DEFAULT_BATCH_SIZE = 3;

/** 批间隙。32ms ≈ 两帧，够浏览器插一次绘制 + 一次输入处理；再大就白等。 */
const YIELD_GAP_MS = 32;

type Permit = () => void;

let queue: Permit[] = [];
let draining = false;
let batchSize = DEFAULT_BATCH_SIZE;

/** 测试用：改批大小并清空队列。生产代码不要调。 */
export function __setBatchSizeForTests(size: number): void {
  batchSize = Math.max(1, size);
  queue = [];
  draining = false;
}

export function __resetSchedulerForTests(): void {
  batchSize = DEFAULT_BATCH_SIZE;
  queue = [];
  draining = false;
}

/**
 * 让出主线程一次。
 *
 * **默认走真实定时器，这是实测选的，不是随手写的。** 一开始用的是
 * scheduler.postTask({priority:'background'})，看着更"现代"，实测**几乎没用**：
 *
 *   生产构建 n=14   一起挂 → 最长单任务 4106ms，长任务 4 个
 *                   postTask 分批 → 4169ms（+2%），长任务**还是 4 个**
 *                   setTimeout 32ms 分批 → 3453ms（−16%），长任务 5 个
 *
 * 长任务个数不变是关键线索：postTask 排进去的几批，在主线程空闲时会**背靠背
 * 跑完、合并进同一个长任务**——让出了任务队列，但没让出一次绘制，等于没让。
 * 真实定时器强制出现时间间隙，浏览器才有机会插入绘制与输入处理。
 *
 * 代价是引入约 batchCount × 32ms 的刻意延迟，但实测挂载墙钟 4380→4386ms，
 * 在噪声里——因为这段延迟本来就被挂载工作填满了。
 *
 * 仍然**不用 requestAnimationFrame**：rAF 回调跑在绘制前，在里面挂载等于把
 * 长任务塞进关键帧，帮倒忙。
 */
function yieldToMain(run: () => void): void {
  // 压测台可以切回旧实现做对照（?yield=posttask），生产不走这一支
  const forced = (globalThis as { __mountYieldMode?: string }).__mountYieldMode;
  if (forced === "posttask") {
    const s = (globalThis as {
      scheduler?: { postTask?: (cb: () => void, o?: unknown) => unknown };
    }).scheduler;
    if (s?.postTask) {
      void s.postTask(run, { priority: "background" });
      return;
    }
  }
  setTimeout(run, YIELD_GAP_MS);
}

function drain(): void {
  const batch = queue.splice(0, batchSize);
  for (const permit of batch) {
    // 一张卡挂载失败不能拖住整队——它自己的错误边界会兜住渲染异常，
    // 这里只保证队列继续走。
    try {
      permit();
    } catch {
      /* 队列继续 */
    }
  }
  if (queue.length > 0) {
    yieldToMain(drain);
  } else {
    draining = false;
  }
}

/**
 * 排队申请一个挂载许可。轮到时调用 `onGranted`。
 * 返回取消函数——卡片在拿到许可前被卸载（滚出去、切页、搜索改了）时必须调用，
 * 否则会对着已卸载的组件 setState。
 */
export function requestMountPermit(onGranted: Permit): () => void {
  queue.push(onGranted);
  if (!draining) {
    draining = true;
    // 第一批也让出一次：调用方通常在 effect 里注册，此刻还在 React 的提交
    // 阶段，立刻挂载会把这一批并进同一个长任务里，等于没分批。
    yieldToMain(drain);
  }
  return () => {
    queue = queue.filter(p => p !== onGranted);
  };
}

/** 当前排队长度（诊断/测试用）。 */
export function pendingMountCount(): number {
  return queue.length;
}
