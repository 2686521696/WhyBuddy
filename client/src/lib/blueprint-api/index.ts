/**
 * `client/src/lib/blueprint-api/` 统一 barrel。
 *
 * 当前状态（方案 B）：
 * - 8 个子域 re-export 模块（intake / clarification / jobs / agent-crew / routeset /
 *   spec-documents / downstream / artifact-replay）都指向 `../blueprint-api.ts` 单体；
 * - `index.ts` 再把这 8 个子域的出口汇聚成一个 barrel；
 * - 下游消费者可以用两种 import 都拿到同样的符号：
 *   - `import { createBlueprintIntake } from "@/lib/blueprint-api/intake"`（按子域精确）
 *   - `import { createBlueprintIntake } from "@/lib/blueprint-api"`（全量 barrel，继续兼容）
 *
 * 物理迁移时，只需把 `../blueprint-api.ts` 中对应子域的实物搬进对应子模块文件，
 * 本 barrel 与下游 import 都不需要改动（需求 6.4 / 6.5）。
 */

export * from "./intake.js";
export * from "./clarification.js";
export * from "./jobs.js";
export * from "./replan.js";
export * from "./family.js";
export * from "./agent-crew.js";
export * from "./routeset.js";
export * from "./spec-documents.js";
export * from "./downstream.js";
export * from "./artifact-replay.js";
