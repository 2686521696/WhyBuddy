/**
 * 舞台预览框的外观：投影 + 描边 + 画布要预留的余量。
 *
 * ⚠ 2026-08-24 用户反馈"阴影这块能不能优化，比如内阴影"。真机量完发现问题
 * 不在配色，在**它根本没画出来**：
 *
 *   canvas 1368×764 / frame 1358×764 → gapTop 0、gapBottom 0，
 *   而 sliderule-spec-page-canvas 是 overflow:hidden。
 *
 * 也就是说 `0 8px 32px` 那 32px 模糊上下被整段切掉、左右只剩 5px。用户看到的
 * 是一条平切的硬边，自然觉得"不对"。三件事一起改才有用：
 *
 * 1. **留余量**。useScaleToFit 的 pad 参数本来就是干这个的——手机档早就传了
 *    `{x:36,y:48}`，注释写着"不扣的话 12px 外圈会被 overflow:hidden 切掉顶"。
 *    桌面档一直传 {0,0}，因为以前没有描边、切了也看不出来。代价是缩放比例掉
 *    2~4%（71% → 68% 量级），换阴影真的能显示出来。
 * 2. **分层**。单层大模糊是本仓旧写法；Tailwind 自己的整条标度
 *    （--shadow-sm…2xl，见 node_modules/tailwindcss/theme.css）全是两层
 *    "近距 + 远距 + 负 spread"，Material 3 的 key light / ambient light 同理。
 *    分层的落差才像真实光照，单层只是糊。
 * 3. **1px 描边**。舞台跑在 59%~85% 缩放下，纯投影的**顶边**永远最弱（阴影
 *    朝下偏移），低缩放下顶边就化没了。ring 把四条边一次定死——预览类工具
 *    （DevTools 设备模式、CodeSandbox、v0 预览）都是描边定边界、投影给层次。
 *
 * 色相也顺手统一了：原来是 rgba(60,50,30) 暖棕，落在 --sr-shell-bg #f4f4f6
 * 这个冷中性灰上发闷。改用仓里已有的 rgba(15,23,42)（slate-900）家族——
 * grep `shadow-\[` 能看到它已经是本仓用得最多的那支。
 *
 * ⚠ **两处都要用这份常量**：SpecPageLiveStage（spec-first 页面）和
 * AppRuntimeScreen（区块运行时）画的是同一个预览框，2026-08-24 之前各自硬编
 * 了一份一模一样的 `0 8px 32px rgba(60,50,30,0.18)`。只改一处不会报错，
 * 只会有一半的舞台没变——本仓第四条纪律的标准形态。
 */

/** 桌面预览框：ring 定边界，近/中/远三层给层次。 */
export const STAGE_FRAME_SHADOW =
  "0 0 0 1px rgba(15,23,42,0.06)," +
  "0 1px 2px rgba(15,23,42,0.04)," +
  "0 8px 16px -6px rgba(15,23,42,0.08)," +
  "0 24px 48px -16px rgba(15,23,42,0.14)";

/**
 * 手机档：机身黑边本身就是边界，不需要 ring，只把单层换成分层。
 * 原值 `0 18px 40px rgba(15,23,42,0.28)` —— 色相已经是对的，只是没分层。
 */
export const PHONE_FRAME_SHADOW =
  "0 4px 8px -2px rgba(15,23,42,0.10)," +
  "0 16px 32px -8px rgba(15,23,42,0.18)," +
  "0 32px 64px -24px rgba(15,23,42,0.22)";

/**
 * 桌面档要从画布里扣掉的余量，喂给 useScaleToFit 的 pad。
 *
 * 取 32/36 是按上面那组阴影的实际外扩量定的：远层 48px 模糊 -16px 收缩 ≈ 外扩
 * 16px，加上 ring 1px 和向下 24px 偏移。y 比 x 大一点，因为阴影整体朝下偏。
 * 改这两个数就等于改阴影能不能完整显示，别单独调其中一个。
 */
export const STAGE_FRAME_PAD = { x: 32, y: 36 } as const;
