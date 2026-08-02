/**
 * 面团标识（2026-08-03）。
 *
 * 照用户提供的 logo 复刻：一坨圆润的、不完全对称的"面团"形，上面一张笑脸，
 * 描边是青→蓝→紫的渐变。
 *
 * ## 为什么手写 SVG 而不是放图片文件
 *
 * · **随字号缩放**：登录页要 56px、侧栏要 20px、favicon 要 32px，一份矢量全覆盖，
 *   不用维护三套 PNG
 * · **跟随主题**：`currentColor` 让它在深色底上也能用（虽然默认走渐变）
 * · **零请求**：登录页是首屏，少一个图片请求就少一次白屏机会
 *
 * 渐变 id 带随机后缀——同页面出现两个实例时，写死的 id 会让第二个引用到第一个的
 * 定义，表现是"其中一个变透明"，而且只在特定组合下复现，很难查。
 */

import { useId } from "react";

export function MianTuanMark({
  size = 40,
  className,
}: {
  size?: number;
  className?: string;
}) {
  // useId 保证同页多实例不撞车（见文件头说明）
  const gid = `mt-grad-${useId().replace(/:/g, "")}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      role="img"
      aria-label="面团"
    >
      <defs>
        <linearGradient id={gid} x1="4" y1="8" x2="58" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="#22D3C5" />
          <stop offset="0.5" stopColor="#3B82F6" />
          <stop offset="1" stopColor="#7C3AED" />
        </linearGradient>
      </defs>
      {/* 外层那坨面团：刻意不对称——正圆会显得像通用头像，失去"一坨面"的手感 */}
      <path
        d="M32 5c9.5 0 15.8 2.6 20.6 7.4C57.4 17.2 60 24 60 32.6c0 9.2-3 15.9-8.2 20.6C46.6 57.9 39.8 60 31.4 60c-8.9 0-15.7-2.4-20.4-7.2C6.3 48 4 41.1 4 32.2c0-8.8 2.5-15.6 7.4-20.3C16.3 7.2 22.9 5 32 5Z"
        fill={`url(#${gid})`}
      />
      {/* 内层留白，让笑脸浮在面团上 */}
      <path
        d="M32 13.5c7.1 0 11.8 1.9 15.3 5.4 3.5 3.5 5.4 8.4 5.4 14.6 0 6.7-2.1 11.5-5.9 14.9-3.8 3.4-8.8 5-15 5-6.6 0-11.6-1.7-15.1-5.2-3.5-3.4-5.2-8.4-5.2-14.9 0-6.4 1.8-11.3 5.4-14.8 3.6-3.5 8.3-5 15.1-5Z"
        fill="#fff"
      />
      {/* 眼睛：竖着的圆角矩形，比圆点更有"眯眼笑"的味道 */}
      <rect x="23" y="26" width="4.6" height="9.5" rx="2.3" fill="#2563EB" />
      <rect x="36.4" y="26" width="4.6" height="9.5" rx="2.3" fill="#2563EB" />
      {/* 嘴 */}
      <path
        d="M25 41.5c1.9 2.6 4.3 3.9 7 3.9s5.1-1.3 7-3.9"
        stroke="#2563EB"
        strokeWidth="3.2"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

/** 标识 + 文字，横向排列。登录页和侧栏共用。 */
export function MianTuanWordmark({
  size = 32,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ""}`}>
      <MianTuanMark size={size} />
      <span className="flex flex-col leading-none">
        <span
          className="font-semibold tracking-tight text-slate-900"
          style={{ fontSize: size * 0.62 }}
        >
          面团
        </span>
        <span
          className="mt-1 font-medium tracking-[0.18em] text-slate-400"
          style={{ fontSize: size * 0.3 }}
        >
          MIANTUAN.AI
        </span>
      </span>
    </span>
  );
}
