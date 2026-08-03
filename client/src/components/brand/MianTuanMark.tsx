/**
 * 面团标识（2026-08-03 换成官方素材）。
 *
 * ## 从手绘 SVG 换成官方 PNG
 *
 * 这个文件原来是**照着一张截图手写的 SVG 复刻**——那时候还没有官方素材。
 * 手写的好处是随字号缩放、零请求；坏处是它终究只是"很像"：渐变的走向、
 * 面团那几个不对称的凸起、笑脸的弧度，全是估的。
 *
 * 现在有官方素材了（client/public/brand/miantuan-mark.png），就该用真的。
 * 一个"很像"的标识比换个字体还伤品牌——它会出现在标签页、侧栏、登录页，
 * 每一处都在告诉人这个产品长什么样。
 *
 * ## 为什么不做成 SVG
 *
 * 素材给的就是 PNG（462×450，带透明通道）。它在页面上最大只用到 34px，
 * 而位图有 462px 宽——像素密度 13 倍，任何屏幕上都锐利。要矢量得回去找
 * 设计源文件，那是另一件事，不该为此把一个"很像"的手绘版留在代码里。
 *
 * ## 调用口径没变
 *
 * 仍然是 `size` 一个数控制宽高，调用点一行不用改（登录页 34、页脚 14、
 * 窄屏 30）。原图不是严格正方，靠 object-contain 保证不变形。
 */

/** 官方方标。放 public 下而不是 import：它同时被 index.html 的 favicon 引用，
 *  走同一份文件才不会出现"标签页和页面里是两个版本"。 */
const MARK_SRC = "/brand/miantuan-mark.png";

export function MianTuanMark({
  size = 40,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      src={MARK_SRC}
      width={size}
      height={size}
      className={className}
      // 原图 462×450 不是严格正方，不加 contain 会被拉扁
      style={{ objectFit: "contain", display: "block" }}
      alt="面团"
      // 不能 lazy：登录页首屏就要它，懒加载会先空一块再跳出来
      decoding="async"
    />
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
