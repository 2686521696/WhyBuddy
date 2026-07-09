/**
 * Autopilot 右栏底部叙事 Swiper — narrative card 类型定义
 *
 * 本文件只导出类型 / 类型级常量，不引入任何运行时副作用。设计契约对应：
 * - `.kiro/specs/autopilot-right-rail-narrative-swiper/requirements.md`
 *   - Requirement 3.3：每条 entry 映射成包含统一字段的 Narrative_Card
 *   - Requirement 3.7：数据消费层通过 React hook 抽象隔离 store
 *   - Requirement 10.6：不扩大当前 117 个 TypeScript 基线错误数
 *   - Requirement 11.1：6 个 Stage_Visual_Lane 共用同一套字体与色板基底
 * - `.kiro/specs/autopilot-right-rail-narrative-swiper/design.md`
 *   §"类型与契约 / NarrativeCard"
 *
 * 关键约束：
 * 1. `Stage` 严格派生自 `autopilot-workbench-stage-rhythm` spec 冻结的
 *    `STAGE_ORDER` 常量，避免在右栏底部叙事 Swiper 中再造一份平行的阶段顺序。
 * 2. `STAGE_VALIDATION` 提供编译期穷举校验：当 `STAGE_ORDER` 新增 / 移除 /
 *    重命名值时，这里会立刻产生 TS 编译错误，强制迁移方同步本文件。
 * 3. 中文 JSDoc 与项目其它模块保持一致；prompt 字面量与 promptId 不进入 i18n
 *    资源，因此本文件不承担文案翻译工作（Req 12.5）。
 */

import type { WorkbenchStage } from '../stage-viewport/stage-config';

// ─── Card_Source ───────────────────────────────────────────────────────────

/**
 * Narrative_Card 的来源类型枚举（Req 3.1 / 3.5）。
 *
 * 6 类来源对应右栏底部叙事 Swiper 收编的 6 路 store slice：
 * - `reasoning`：来自 `useBlueprintRealtimeStore.agentReasoning.entries`
 * - `role-status`：来自 RoleStatusStrip 派生的 `rolePhases` 单条目
 * - `capability`：来自 CapabilityRail 派生的 `capabilityStatuses`
 * - `fleet-activation`：来自 FleetActivationLog 派生的 `agentProgress`
 * - `route-decision`：来自路线规划 store 与 job artifact 的 `route_decision`
 * - `artifact`：来自 artifact 投影（`artifact_created` / `node_completed`）
 *
 * 每张卡片必须以可识别的图标或角标在 UI 上标注 `Card_Source`，便于演示者
 * 向观众解释信号来源。
 */
export type CardSource =
  | 'reasoning'
  | 'role-status'
  | 'capability'
  | 'fleet-activation'
  | 'route-decision'
  | 'artifact';

// ─── Stage ─────────────────────────────────────────────────────────────────

/**
 * Autopilot 工作台的 6 个阶段标识。
 *
 * 严格继承自 `autopilot-workbench-stage-rhythm` spec 冻结的 `STAGE_ORDER`
 * 常量（`stage-viewport/stage-config.ts`），不允许在本文件中创建别名或
 * 派生出第二条阶段顺序源。当 `WorkbenchStage` 增减值时，下方
 * `STAGE_VALIDATION` 会触发编译期穷举校验失败。
 *
 * 当前 6 个值固定为：
 * `input → clarification → route → spec_tree → spec_documents → effect_preview`
 */
export type Stage = WorkbenchStage;

/**
 * 编译期穷举校验：确保 `Stage` 与 `STAGE_ORDER` 的 6 个值完全一一对应。
 *
 * 利用 `Record<Stage, true>` 的强约束：
 * - 若 `Stage` 新增值（例如 `STAGE_ORDER` 引入第 7 阶段），此对象缺少键，
 *   TypeScript 会在编译期报错 `Property 'xxx' is missing`。
 * - 若 `Stage` 移除值，此对象多出键，TypeScript 会报 `not assignable`。
 *
 * 该常量仅作为类型守卫存在，不在运行时被任何代码读取（保持纯类型语义）。
 */
const STAGE_VALIDATION: Record<Stage, true> = {
  input: true,
  clarification: true,
  route: true,
  spec_tree: true,
  spec_documents: true,
  effect_preview: true,
};
// 引用一次以避免 `noUnusedLocals` 报错；运行时副作用为零（仅取键数组）。
void STAGE_VALIDATION;

// ─── Card_Severity ─────────────────────────────────────────────────────────

/**
 * Narrative_Card 的严重程度枚举。
 *
 * 用于驱动卡片边框色强度与 Stage_Visual_Lane 的状态色叠加（Req 11.2）：
 * - `info`：默认信息态，沿用冷灰中性色
 * - `success`：完成 / 成功落地，使用品牌绿色调
 * - `warning`：需要关注但不阻塞，使用琥珀色调
 * - `danger`：阻塞 / 错误，使用红色调
 *
 * 卡片在不传 `severity` 时按 `info` 渲染，避免出现未定义中间态。
 */
export type CardSeverity = 'info' | 'success' | 'warning' | 'danger';

// ─── Routing ───────────────────────────────────────────────────────────────

/**
 * Narrative_Card 的来源路由意图（Req 4.5）。
 *
 * 与 `right-rail/right-rail-console-routing.ts` 输出的 `RoutingTarget`
 * 对齐，但只保留进入 Narrative_Swiper 的两类目标——`console-only` 由路由
 * 模块在入队前过滤掉，因此不会出现在 `NarrativeCard.routing` 中。
 *
 * - `narrative-only`：仅在右下叙事 Swiper 展示
 * - `both`：同时进入左下 Mini_Console_Bar 与右下 Narrative_Swiper，
 *   但展示字段焦点不同（左下展示 jobId / raw，右下展示 headline / actor）
 */
export type NarrativeCardRouting = 'narrative-only' | 'both';

// ─── Narrative_Card ────────────────────────────────────────────────────────

/**
 * Narrative_Swiper 中单张卡片的归一化数据契约（Req 3.3 / 3.4）。
 *
 * 字段语义：
 * - `id`：稳定 id；优先复用底层 entry id，否则按 `source + occurredAt` 派生。
 *   同一 id 第二次入队时走原地更新而非动效切换，避免视觉抖动。
 * - `source`：卡片来源类型（`Card_Source` 6 类之一），驱动 UI 角标与
 *   `<NarrativeCard>` 的子卡片分发逻辑。
 * - `stage`：卡片所属 Stage；缺失时视为 `"global"`，默认在所有 Stage 显示。
 *   Stage 切换时按 `useNarrativeCardStream` 的过滤策略保留 N=2 张回声卡片。
 * - `headline`：单行主标题，已 i18n。后端事件已带文案时直接使用，未带则
 *   走前端 fallback 键（Req 12.2 / 12.3）。
 * - `detail`：可选副文，建议 ≤ 80 字，已 i18n。
 * - `actorAvatar`：可选演员 / 角色头像；URL 或资源 token 均可。
 * - `severity`：可选严重程度；不传时按 `info` 渲染。
 * - `occurredAt`：入队 / 最近一次原地更新的时间戳（毫秒），用于排序与
 *   Auto_Rotation 调度。
 * - `sourceEntryId`：派生指针，指向原始底层 entry 的 id；用于检测同一
 *   entry 的细节更新并触发原地更新（Req 3.4）。
 * - `routing`：来源路由意图，由共享 `right-rail-console-routing.ts` 写入；
 *   `console-only` 的 entry 会在入队前被过滤，不会出现在此字段中。
 */
export interface NarrativeCard {
  /** 稳定 id；优先复用底层 entry id，否则按 `source + occurredAt` 派生。 */
  id: string;
  /** 卡片来源类型，驱动 UI 角标与子卡片分发。 */
  source: CardSource;
  /** 卡片所属 Stage；缺失时视为 `"global"`，默认在所有 Stage 显示。 */
  stage: Stage | 'global';
  /** 单行主标题，已 i18n。 */
  headline: string;
  /** 可选副文（建议 ≤ 80 字），已 i18n。 */
  detail?: string;
  /** 可选演员 / 角色头像；URL 或资源 token。 */
  actorAvatar?: string;
  /** 可选严重程度；不传时按 `info` 渲染。 */
  severity?: CardSeverity;
  /** 入队 / 最近一次原地更新的时间戳（毫秒）。 */
  occurredAt: number;
  /** 派生指针：原始底层 entry 的 id，用于原地更新。 */
  sourceEntryId?: string;
  /** 来源路由意图：`narrative-only` 或 `both`，与共享路由模块对齐。 */
  routing: NarrativeCardRouting;
}

// ─── Narrative_Card_Stream ─────────────────────────────────────────────────

/**
 * `useNarrativeCardStream(...)` hook 的返回结构（Req 6.1 / 6.2 / 6.3）。
 *
 * 字段语义：
 * - `cards`：当前可见队列，已按 Capacity_Limit（默认 8）裁剪并按
 *   `occurredAt` 升序排列。Stage 切换时队列起始的 N=2 张为跨阶段回声。
 * - `echoCount`：来自上一 Stage 的「上一幕回声」张数（≤ N=2）。回声卡片
 *   不参与新 Stage 的 Auto_Rotation 主轮播，仅以视觉淡化（如
 *   `data-echo="true"`）形态留在队列起始。`echoCount = 0` 表示当前队列
 *   全部属于当前 Stage。
 *
 * 该结构对外只读，hook 内部维护 stable reference 以避免引发右栏主区
 * 组件的额外重渲染（Req 9.3）。
 */
export interface NarrativeCardStream {
  /** 当前可见的 Narrative_Card 队列，长度 ≤ Capacity_Limit。 */
  cards: NarrativeCard[];
  /** 跨阶段回声张数（≤ N=2），位于 `cards` 起始位置。 */
  echoCount: number;
}
