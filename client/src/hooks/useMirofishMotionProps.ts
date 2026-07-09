import { useMirofishTheme } from "@/hooks/useMirofishTheme";

/**
 * Disabled motion props for MiroFish scope.
 * Disables framer-motion spring/tween animations, replacing them with instant transitions.
 *
 * Retained animations (handled via CSS, not framer-motion):
 * - cursor blink
 * - hover color transitions
 * - translateY(-2px) button hover
 */
const DISABLED_MOTION_PROPS = {
  initial: false as const,
  animate: false as const,
  exit: undefined,
  transition: { duration: 0 },
};

/**
 * Returns framer-motion props that disable animations when inside a MiroFish
 * theme scope or when the user prefers reduced motion.
 *
 * When inside MiroFish scope (or prefers-reduced-motion: reduce):
 *   returns `{ initial: false, animate: false, exit: undefined, transition: { duration: 0 } }`
 *
 * When outside MiroFish scope:
 *   returns empty object (default framer-motion behavior)
 *
 * Usage:
 * ```tsx
 * const motionOverrides = useMirofishMotionProps();
 * <motion.div {...originalProps} {...motionOverrides}>
 * ```
 */
export function useMirofishMotionProps() {
  const isMirofish = useMirofishTheme();

  // Also respect prefers-reduced-motion (with guard for environments like jsdom
  // where window.matchMedia may not exist)
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    if (prefersReduced) {
      return DISABLED_MOTION_PROPS;
    }
  }

  if (isMirofish) {
    return DISABLED_MOTION_PROPS;
  }

  return {};
}
