/**
 * 阶段节奏感 — 6 阶段配置常量与顺序定义
 *
 * 本文件定义 Autopilot 工作台 StageViewport 所需的阶段配置数据，
 * 包含每个阶段的英文标识、中文标题、CTA 按钮文案与是否自动推进。
 *
 * 对应 spec：`.kiro/specs/autopilot-workbench-stage-rhythm/`
 * - 需求 5.1：维持固定的 6 阶段顺序
 * - 需求 3.1, 3.2：StageHeader 展示英文步骤标识与中文大标题
 * - 需求 4.2, 4.5：StageCTA 按钮文案与 autoAdvance 只读态
 */

/**
 * Autopilot 工作台的 6 个阶段标识。
 *
 * 顺序固定为：input → clarification → route → spec_tree → spec_documents → effect_preview，
 * 不允许跳过中间阶段直接推进到后续阶段。
 */
export type WorkbenchStage =
  | 'input'
  | 'clarification'
  | 'route'
  | 'spec_tree'
  | 'spec_documents'
  | 'effect_preview';

/**
 * 单个阶段的配置项。
 */
export interface StageConfigItem {
  /** 英文标识，用于 StageHeader 的 "STEP 0N · ENGLISH_LABEL" 展示 */
  englishLabel: string;
  /** 中文大标题，用于 StageHeader 下方展示 */
  chineseTitle: string;
  /** CTA 按钮文案，用于 StageCTA 主按钮 */
  ctaLabel: string;
  /** 是否自动推进（无需用户点击 CTA），为 true 时 StageCTA 展示只读提示 */
  autoAdvance: boolean;
}

/**
 * 6 阶段配置常量。
 *
 * 每个阶段包含英文标识、中文标题、CTA 按钮文案与是否自动推进的配置。
 * 当 `autoAdvance` 为 true 时，StageCTA 渲染为只读状态提示而非可点击按钮。
 */
export const STAGE_CONFIG: Record<WorkbenchStage, StageConfigItem> = {
  input: {
    englishLabel: 'INPUT',
    chineseTitle: '需求输入',
    ctaLabel: '开始澄清',
    autoAdvance: false,
  },
  clarification: {
    englishLabel: 'CLARIFICATION',
    chineseTitle: '智能澄清',
    ctaLabel: '生成路线',
    autoAdvance: false,
  },
  route: {
    englishLabel: 'ROUTE',
    chineseTitle: '路线规划',
    ctaLabel: '确认路线',
    autoAdvance: false,
  },
  spec_tree: {
    englishLabel: 'SPEC TREE',
    chineseTitle: '规格树',
    ctaLabel: '生成文档',
    autoAdvance: false,
  },
  spec_documents: {
    englishLabel: 'SPEC DOCUMENTS',
    chineseTitle: '规格文档',
    ctaLabel: '预览效果',
    autoAdvance: true,
  },
  effect_preview: {
    englishLabel: 'EFFECT PREVIEW',
    chineseTitle: '效果预览',
    ctaLabel: '完成',
    autoAdvance: false,
  },
} as const;

/**
 * 6 阶段的固定顺序数组，用于迭代和 index 查找。
 *
 * 顺序与 `WorkbenchStage` 类型定义一致，任何阶段推进或回看的 index 判定
 * 都必须以本常量为准。
 */
export const STAGE_ORDER: readonly WorkbenchStage[] = [
  'input',
  'clarification',
  'route',
  'spec_tree',
  'spec_documents',
  'effect_preview',
] as const;
