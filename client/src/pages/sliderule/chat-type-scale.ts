/**
 * 对话栏的字号：四级，别再加。
 *
 * ⚠ 2026-10-10 用户看采购审批那一轮的截图说「整体文字大小不协调」。量下来同一栏里七种字号：
 *
 *     输入框 15 · 模型说的话 14 · 你说的话 13.5 · 问卷题面 13.5 · 计划书 13.5 · 思考流 12.5 · 卡片 13 / 12
 *
 *   最大的字是**输入框里的占位字**，比对话正文还大；你说的话比模型说的话小半号；半号（13.5、12.5）
 *   肉眼分不出是两级，只会觉得「哪儿有点歪」。另外模型收尾里的「## 标题」被 Tailwind 的样式重置抹成跟正文
 *   一模一样（不加粗、不放大），行内代码是等宽字体原号，英文显得比中文大一圈。
 *
 *   现在：正文一级（谁说的话都是这一级，输入框也是——你打的字发出去就是气泡里那行字），次级、辅助、标签各一级。
 *   新写的对话栏组件从这里取，不要再写 text-[13.5px] 这种半号。
 */

/** 正文：模型说的话、你说的话、输入框、问卷题面、计划书。 */
export const CHAT_BODY = "text-[14px]";
/** 次级：卡片标题、待办项、活动行、思考流。 */
export const CHAT_SECONDARY = "text-[13px]";
/** 辅助：时间、按钮、状态。 */
export const CHAT_META = "text-[12px]";

/**
 * 模型说的话按 markdown 画时的排版（收尾总结、纯回答轮，两处同一份——SpeechMarkdown 头注 §四）。
 * 标题只加粗、最多大一号；行内代码小一号、灰底，免得等宽英文比旁边的中文大一圈。
 */
export const CHAT_PROSE = [
  "min-w-0 space-y-2 text-[14px] leading-[1.7] text-[#171717] [overflow-wrap:anywhere]",
  "[&_h1]:text-[15px] [&_h1]:font-semibold [&_h2]:text-[14px] [&_h2]:font-semibold [&_h3]:text-[14px] [&_h3]:font-semibold",
  "[&_h4]:font-semibold [&_strong]:font-semibold",
  "[&_code]:rounded [&_code]:bg-[#f3f4f6] [&_code]:px-1 [&_code]:py-px [&_code]:text-[13px]",
  "[&_pre]:overflow-x-auto [&_pre]:rounded-[8px] [&_pre]:bg-[#f3f4f6] [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_a]:text-[#2f6bff] [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5",
].join(" ");
