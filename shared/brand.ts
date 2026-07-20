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
 * Legacy package name — kept for places that still need to reference the
 * old token while the internal rename is staged.
 */
export const BRAND_PACKAGE_LEGACY = "sliderule";
