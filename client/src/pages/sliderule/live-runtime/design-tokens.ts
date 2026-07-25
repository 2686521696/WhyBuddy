/**
 * design-tokens — 结构性刻度（间距/圆角/阴影），跟 identity-themes.ts 的
 * 品牌色刻度是两回事（那个随 app 变、这个不变）。
 *
 * 起因（2026-07-24）：审查发现 AppRuntimeScreen.tsx 里的 padding/margin/
 * borderRadius/boxShadow 几乎每处都是现场手写的数字（11/12/13/15/16/20/24px、
 * 圆角 6/7/8px 混用），FreeformInsight 的 style 白名单其实早就开放了这些
 * CSS 属性——问题不是"能力缺失"，是没有一套双方都对齐的刻度，各写各的，
 * 卡片之间边距/圆角/阴影自然不协调（用户截图反馈的原始问题）。
 *
 * 不重新发明一套刻度，直接吃 antd 自己的 Design Token（Seed→Map→Alias
 * 三层，ant-design/ant-design 同一套），原因：
 * 1) 项目本来就跑在 antd 上，Card/Menu/Layout 这些组件的间距/圆角/阴影
 *    已经是这套刻度算出来的，跟它对齐才是真正"协调"，不是另起一套还要
 *    手动保持视觉一致；
 * 2) 用 antdTheme.useToken() 现取，不是抄一份静态数字——以后 ConfigProvider
 *    换主题/换算法，这里跟着变，不会变成一份过时快照。
 */

import type { GlobalToken } from "antd";

export interface LayoutTokens {
  /** antd 间距刻度：paddingXXS(4)/XS(8)/SM(12)/默认(16)/LG(24)/XL(32)，
   * 数值来自 Seed token 默认值，实际取的是 useToken() 现算结果。 */
  space: {
    xxs: number;
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
  };
  /** antd 圆角刻度：borderRadiusSM(4)/默认(6)/LG(8)。 */
  radius: {
    sm: number;
    md: number;
    lg: number;
  };
  /** antd 阴影刻度：boxShadowTertiary 最轻（卡片常态），boxShadowSecondary
   * 次之（悬浮/顶栏这类需要更明显层次的场景），boxShadow 最重。 */
  shadow: {
    card: string;
    elevated: string;
    strong: string;
  };
}

export function deriveLayoutTokens(token: GlobalToken): LayoutTokens {
  return {
    space: {
      xxs: token.paddingXXS,
      xs: token.paddingXS,
      sm: token.paddingSM,
      md: token.padding,
      lg: token.paddingLG,
      xl: token.paddingXL,
    },
    radius: {
      sm: token.borderRadiusSM,
      md: token.borderRadius,
      lg: token.borderRadiusLG,
    },
    shadow: {
      card: token.boxShadowTertiary,
      elevated: token.boxShadowSecondary,
      strong: token.boxShadow,
    },
  };
}
