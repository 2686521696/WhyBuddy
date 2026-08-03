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
          <stop stopColor="#19D3C5" />
          <stop offset="0.55" stopColor="#1492FF" />
          <stop offset="1" stopColor="#6F3BFF" />
        </linearGradient>
      </defs>
      {/* 外层那坨面团：刻意不对称——正圆会显得像通用头像，失去"一坨面"的手感 */}
      <path
        d="M31.6 5.2c8.5 0 15 1.4 19.7 4.2 5.3 3.2 8.2 8.1 8.8 14.8.1 1 .7 2.1 1.6 3 1.8 1.7 2.8 4.2 2.8 7.5 0 4.2-1.2 7.7-3.7 10.4-1.9 2.1-4.3 3.5-7.2 4.2-.9.2-1.8.8-2.5 1.7-4.5 5.7-11.5 8.5-20.9 8.5-7 0-12.9-1.2-17.7-3.5-6.1-3-9.2-8.1-9.2-15.2 0-2.1.3-4.1 1-6 .5-1.3.5-2.6.1-4C3.7 28.8 3.4 26.9 3.4 25c0-6.1 2.3-10.9 6.8-14.4 5-3.6 12.1-5.4 21.4-5.4Z"
        fill={`url(#${gid})`}
      />
      {/* 内层留白，让笑脸浮在面团上 */}
      <path
        d="M31.9 14.3c6.9 0 12.2 1.4 15.8 4.3 3.8 3 5.7 7.8 5.7 14.2 0 5.1-.5 9.4-1.5 12.8-.4 1.4-.3 2.8.3 4.2.7 1.5 1.1 3.2 1.1 4.8 0 1.3-.4 2.5-1.2 3.5-1 1.4-2.4 2.1-4.2 2.1H15.8c-1.8 0-3.2-.7-4.3-2.1-.7-1-1.1-2.1-1.1-3.4 0-1.7.4-3.4 1.1-4.9.7-1.4.8-2.8.4-4.3-.9-3.2-1.3-7.4-1.3-12.8 0-6.5 1.9-11.2 5.7-14.2 3.7-2.9 8.9-4.3 15.6-4.3Z"
        fill="#fff"
      />
      {/* 眼睛：竖着的圆角矩形，比圆点更有"眯眼笑"的味道 */}
      <rect x="22.4" y="25.4" width="4.9" height="9.2" rx="2.45" fill="#1C78F7" />
      <rect x="36.7" y="25.4" width="4.9" height="9.2" rx="2.45" fill="#1C78F7" />
      {/* 嘴 */}
      <path
        d="M24.8 40.8c2.1 2.1 4.5 3.2 7.2 3.2 2.7 0 5.1-1.1 7.2-3.2"
        stroke="#1C78F7"
        strokeWidth="3"
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
  const aiGradient = {
    backgroundImage: "linear-gradient(135deg,#19D3C5 0%,#1492FF 52%,#6F3BFF 100%)",
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    color: "transparent",
  } as const;

  return (
    <span className={`inline-flex items-center gap-3 ${className ?? ""}`} aria-label="面团AI">
      <MianTuanMark size={size} />
      <span className="flex flex-col leading-none">
        <span className="flex items-end gap-1.5">
          <span
            className="font-semibold tracking-tight text-slate-950"
            style={{ fontSize: size * 0.62 }}
          >
            面团
          </span>
          <span
            className="font-semibold leading-none"
            style={{ ...aiGradient, fontSize: size * 0.62 }}
          >
            AI
          </span>
        </span>
        <span
          className="mt-1.5 font-medium lowercase tracking-[0.18em] text-slate-400"
          style={{ fontSize: size * 0.3 }}
        >
          miantuan.ai
        </span>
      </span>
    </span>
  );
}
