/**
 * SlideRuleBrandMark — 品牌图标（手绘矢量，2026-07-10 用户参考图裁决）。
 *
 * 计算尺意象：上下两条深藏青刻度杆 + 中间亮蓝渐变滑杆（白色游标点 +
 * 右侧指示箭头）。内联 SVG：任意 DPR 清晰、色值与冷调壳体一致，
 * 替换掉此前 320KB 的位图描摹 svg 资产。
 */

export function SlideRuleBrandMark({ size = 38 }: { size?: number }) {
  const ticksTop = [13, 18.5, 24, 29.5, 35];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      className="native-agent-brand-icon"
    >
      <defs>
        <linearGradient id="sr-slider" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#1677ff" />
          <stop offset="1" stopColor="#45c6ff" />
        </linearGradient>
      </defs>
      {/* 上刻度杆 */}
      <rect x="5" y="6.5" width="38" height="10.5" rx="5.25" fill="#14295E" />
      {ticksTop.map(x => (
        <rect
          key={`t-${x}`}
          x={x}
          y="9"
          width="1.7"
          height="5"
          rx="0.85"
          fill="#ffffff"
          opacity="0.92"
        />
      ))}
      {/* 中间滑杆（渐变）+ 白色游标点 + 指示箭头 */}
      <rect x="5" y="19" width="29" height="10" rx="5" fill="url(#sr-slider)" />
      <circle cx="28.5" cy="24" r="3.4" fill="#ffffff" />
      <path d="M37.5 20.8 L43.5 24 L37.5 27.2 Z" fill="#45c6ff" />
      {/* 下刻度杆 */}
      <rect x="5" y="31" width="38" height="10.5" rx="5.25" fill="#14295E" />
      {ticksTop.map(x => (
        <rect
          key={`b-${x}`}
          x={x}
          y="34"
          width="1.7"
          height="5"
          rx="0.85"
          fill="#ffffff"
          opacity="0.92"
        />
      ))}
    </svg>
  );
}
