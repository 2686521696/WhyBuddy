/**
 * SlideRule brand constants.
 *
 * The project's user-facing brand is SlideRule.
 *
 * Strategy: alias-first, not big-bang rename. Internal symbols (file names,
 * module identifiers, audit / lineage event families, the 287 spec dirs that
 * mention old names) keep their existing strings unless a coordinated rename
 * is safe; user-visible touchpoints consume these constants.
 *
 * The legacy package name stays exported here (`BRAND_PACKAGE_LEGACY`) for
 * the small number of modules that need to reference the old token while a
 * future `sliderule-internal-rename` spec carries out a coordinated sweep.
 */

export const BRAND_NAME_DISPLAY = "SlideRule";
export const BRAND_NAME_LATIN = "SlideRule";
export const BRAND_NAME_FULL = "SlideRule";
export const BRAND_DOMAIN = "sliderule.ai";

export const BRAND_TAGLINE_ZH = "把想法问清楚，把产品跑起来";
/** English mirror of the Chinese tagline — keep short and parallel. */
export const BRAND_TAGLINE_EN = "Clarify ideas, ship a runnable product.";

/**
 * One-line product tagline that combines display name + tagline. Used by the
 * HTML <title> and the login subtitle.
 */
export const BRAND_HEADLINE_ZH = `${BRAND_NAME_DISPLAY} · 产品推演引擎`;
export const BRAND_HEADLINE_EN = `${BRAND_NAME_LATIN} · Product Rehearsal Engine`;

/**
 * 面团 / miantuan.ai —— 对外产品品牌（2026-08-03）。
 *
 * 与上面那组 SlideRule 常量**并存**，不是替换：SlideRule 仍然是引擎和内部
 * 标识的名字（文件名、事件族、几百个 spec 目录都写着它），一次性全量改名的
 * 风险远大于收益。这里只给**面向用户的新触点**（登录页、后续的产品外壳）
 * 用，等真要做全站改名时，把上面那组的值换掉即可，调用点不用动。
 *
 * 这正是这个文件开头写的 alias-first 策略。
 */
export const PRODUCT_NAME_ZH = "面团";
export const PRODUCT_NAME_LATIN = "MianTuan";
export const PRODUCT_DOMAIN = "miantuan.ai";
export const PRODUCT_TAGLINE_ZH = "把一句模糊想法，推演成能跑起来的完整应用";
export const PRODUCT_TAGLINE_EN = "Turn a vague idea into a runnable product.";

/**
 * Legacy package name — kept for places that still need to reference the
 * old token while the internal rename is staged.
 */
export const BRAND_PACKAGE_LEGACY = "sliderule";
