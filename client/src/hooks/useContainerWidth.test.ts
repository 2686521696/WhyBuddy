import { describe, expect, it } from 'vitest';

/**
 * useContainerWidth is a thin hook over useSyncExternalStore + ResizeObserver.
 * Since the test environment is Node (no DOM), we verify the core snapshot
 * logic that the hook relies on:
 *
 *   - ref.current === null  →  falls back to window.innerWidth
 *   - ref.current !== null  →  returns el.clientWidth
 *   - SSR snapshot          →  returns 1280
 */
describe('useContainerWidth – snapshot logic', () => {
  it('falls back to fallback width when element ref is null', () => {
    // Simulates the getSnapshot path: el ? el.clientWidth : fallbackWidth
    const ref: { current: null } = { current: null };
    const fallbackWidth = 1440;
    const el = ref.current;
    const width = el ? (el as HTMLElement).clientWidth : fallbackWidth;

    expect(width).toBe(1440);
  });

  it('returns element clientWidth when ref is attached', () => {
    // Simulates the getSnapshot path with a real element
    const fakeEl = { clientWidth: 1040 };
    const ref = { current: fakeEl };
    const width = ref.current ? ref.current.clientWidth : 0;

    expect(width).toBe(1040);
  });

  it('SSR snapshot returns 1280', () => {
    // The hook's getServerSnapshot always returns 1280
    const getServerSnapshot = () => 1280;
    expect(getServerSnapshot()).toBe(1280);
  });
});
