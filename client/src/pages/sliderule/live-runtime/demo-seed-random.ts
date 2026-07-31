/**
 * demo-seed 的确定性随机源（2026-07-28）。
 *
 * ## 为什么要单独做这一层
 *
 * 第一版用的是 `(hash + 行号 * 步长) % N` 这类算术。它确实"确定性"，但产出的
 * 不是随机数而是**等差数列带回绕**——真跑出来的值长这样：
 *
 *     percent: 18,35,52,69,86,3,20,37,54,71,88,5        （每行 +17）
 *     money  : 7500,6450,5400,...,1200,14150,13100      （每行 −1050）
 *
 * 折线图画出来是一条笔直的斜线加一个断崖。更糟的是不同字段只是同一条序列的
 * **相位平移**（18,35,52… / 1,18,35… / 84,1,18…），于是同一个应用里两张
 * KPI 卡、两条曲线长得一模一样，一眼假。
 *
 * ## 做法：抄成熟方案，不自己发明
 *
 * 用 pure-rand 的 xoroshiro128+：
 *   - drizzle-seed（drizzle-team/drizzle-orm，`drizzle-seed/src/services/Generators.ts`）
 *     整套生成器就建立在 `prand.xoroshiro128plus(seed)` 上；
 *   - fast-check 的随机源也是它（本仓库 devDeps 里已经因此带着 pure-rand）。
 *
 * 关键点是自己写容易踩的那个：**取模偏置**。`rand() % n` 在 n 不整除值域时
 * 低位取值概率偏高，`uniformInt` 内部做拒绝采样，分布是真均匀的。
 *
 * 版本差异（踩过）：drizzle-seed 钉的是 pure-rand ^6，那一代
 *   - 有默认导出，`import prand from 'pure-rand'`；
 *   - generator 不可变，取数返回 `[值, 新状态]`；
 *   - 函数叫 `uniformIntDistribution(min, max, rng)`。
 * 本仓库装的是 8.x，三条全变了：只有 subpath 导出（根导出直接 404，写成
 * `from "pure-rand"` 连构建都过不去）、generator 改成可变、函数改名
 * `uniformInt(rng, from, to)` 且参数顺序反过来。照 v6 的写法抄会全线报错。
 *
 * ## 种子怎么派生
 *
 * 照搬 drizzle-seed 的 `customSeed + hash(表名.列名)`（见其 SeedService.ts）：
 * 每个字段一条独立随机流，于是"改了 A 字段的取值范围不会把 B 字段的值也搅乱"，
 * 截图可比、回归可比。
 */

import { xoroshiro128plus } from "pure-rand/generator/xoroshiro128plus";
import { uniformInt } from "pure-rand/distribution/uniformInt";
import type { RandomGenerator } from "pure-rand/types/RandomGenerator";

/**
 * 字符串 → 数字种子。
 *
 * 用 FNV-1a：第一版那个 `h*31 + c` 在短字符串上雪崩性太差——`plot:health`
 * 与 `plot:healthy` 会落到相邻种子，两个字段的序列因此高度相关。FNV-1a 改一个
 * 字符就会整体变样，正是这里需要的性质。
 */
export function seedFromString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    // FNV 质数 16777619，用移位相加避免 32 位溢出丢精度
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/**
 * 一条确定性随机流。
 *
 * 刻意不暴露 `next()` 之类的裸接口——所有取值都走带语义的方法，免得调用方
 * 各自写一遍 `% n` 又把取模偏置带回来。
 */
export class SeededRandom {
  private rng: RandomGenerator;

  constructor(seed: number) {
    // 种子必须落在 32 位有符号范围内；`>>> 0` 出来的是无符号，直接传进去
    // 高位会被截掉、不同种子可能撞成同一条流。用 `| 0` 转成有符号。
    this.rng = xoroshiro128plus(seed | 0);
  }

  /** [min, max] 闭区间上的均匀整数（拒绝采样，无取模偏置）。 */
  int(min: number, max: number): number {
    if (max <= min) return min;
    return uniformInt(this.rng, min, max);
  }

  /** [0, 1) 上的浮点数。用整数值域再归一，不额外引入偏置。 */
  float(): number {
    return this.int(0, 0xff_ff_ff) / 0x1_00_00_00;
  }

  /** 从数组里等概率取一个。空数组返回 undefined，由调用方决定怎么降级。 */
  pick<T>(items: readonly T[]): T | undefined {
    if (items.length === 0) return undefined;
    return items[this.int(0, items.length - 1)];
  }

  /**
   * 围绕基准值上下浮动的整数，用于"看起来像真实业务量"的数值。
   *
   * 纯均匀分布铺出来的柱状图每根一样高、噪声感很强；真实业务数据多半聚在
   * 中间、两头稀。这里取三次均匀采样的中位数近似钟形，代价是常数级、
   * 不用引数学库。
   */
  around(center: number, spreadRatio = 0.45): number {
    const spread = Math.max(1, Math.round(center * spreadRatio));
    const a = this.int(-spread, spread);
    const b = this.int(-spread, spread);
    const c = this.int(-spread, spread);
    const mid = a + b + c - Math.max(a, b, c) - Math.min(a, b, c);
    return center + mid;
  }
}

/**
 * 给某个字段开一条流。
 *
 * 种子只由 (实体 id, 字段 id) 决定——**不掺行号**：一条流按顺序吐 12 个值，
 * 天然互不相同；若每行各开一条流，相邻行的种子相近、又会退化成第一版那种
 * 逐行相关的序列。
 */
export function fieldRandom(entityId: string, fieldId: string): SeededRandom {
  return new SeededRandom(seedFromString(`${entityId}.${fieldId}`));
}
