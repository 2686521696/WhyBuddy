/**
 * 阶段底部固定行动栏组件
 *
 * 固定在 StageViewport 底部，承载当前阶段的主操作按钮。
 * 使用 sticky 定位与深色毛玻璃背景，与上方内容区形成视觉分层。
 *
 * 支持三种状态：
 * - 默认态：可点击主按钮，触发阶段推进
 * - loading 态：按钮脉冲动画 + 进度文案，不可点击
 * - readOnly 态：展示只读提示文案，无按钮交互（用于自动流式生成中）
 *
 * @example
 * ```tsx
 * <StageCTA
 *   label="开始澄清"
 *   loading={false}
 *   disabled={false}
 *   onAction={() => advanceStage()}
 * />
 * ```
 *
 * 对应需求: 4.1, 4.2, 4.3, 4.4, 4.5
 */

import type { FC } from "react";

/** StageCTA 组件 Props */
export interface StageCTAProps {
  /** 主按钮文案，如 '开始澄清' | '生成路线' | '确认路线' 等 */
  label: string;
  /** 是否处于 loading 状态（异步操作进行中） */
  loading: boolean;
  /** 是否禁用按钮（如过渡动画期间） */
  disabled: boolean;
  /** 是否为只读态（自动流式生成中，展示只读提示而非可点击按钮） */
  readOnly?: boolean;
  /** 只读态提示文案，如 "文档正在自动生成中..." */
  readOnlyHint?: string;
  /** 主按钮点击回调 */
  onAction: () => void;
}

/**
 * 阶段底部固定行动栏
 *
 * 使用 sticky bottom-0 定位，深色毛玻璃背景（bg-black/30 backdrop-blur-md），
 * 顶部细线分隔（border-t border-white/5）与内容区形成视觉层次。
 */
const StageCTA: FC<StageCTAProps> = ({
  label,
  loading,
  disabled,
  readOnly = false,
  readOnlyHint,
  onAction,
}) => {
  // readOnly 态：展示只读提示文案，不渲染可点击按钮
  if (readOnly) {
    return (
      <div className="sticky bottom-0 z-10 bg-white border-t border-slate-100 px-4 py-3">
        <p className="w-full text-center text-slate-400 text-xs py-2.5">
          {readOnlyHint || label}
        </p>
      </div>
    );
  }

  return (
    <div className="sticky bottom-0 z-10 bg-white border-t border-slate-100 px-4 py-3">
      <button
        type="button"
        className={`w-full rounded-lg bg-slate-900 hover:bg-slate-700 text-white text-xs font-bold py-2.5 transition ${
          loading ? "animate-pulse opacity-70" : ""
        } ${disabled || loading ? "pointer-events-none opacity-50" : ""}`}
        disabled={disabled || loading}
        onClick={onAction}
      >
        {loading ? `${label}...` : label}
      </button>
    </div>
  );
};

export default StageCTA;
