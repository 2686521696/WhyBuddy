import { useCallback, useSyncExternalStore } from 'react';

/**
 * Monitors the width of a DOM element via ResizeObserver.
 *
 * When the ref has not yet been attached (null), falls back to
 * `window.innerWidth` so camera calculations always have a
 * reasonable value.  SSR snapshot returns 1280.
 */
export function useContainerWidth(
  ref: React.RefObject<HTMLElement | null>
): number {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const el = ref.current;
      if (!el) {
        window.addEventListener('resize', onStoreChange, { passive: true });
        return () => window.removeEventListener('resize', onStoreChange);
      }
      const observer = new ResizeObserver(onStoreChange);
      observer.observe(el);
      return () => observer.disconnect();
    },
    [ref]
  );

  const getSnapshot = useCallback(() => {
    const el = ref.current;
    return el ? el.clientWidth : window.innerWidth;
  }, [ref]);

  const getServerSnapshot = useCallback(() => 1280, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
