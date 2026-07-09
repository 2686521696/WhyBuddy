import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock Scene3D — we only need to verify that Scene3DFallback passes the right
// props through; the real Scene3D requires a full WebGL context.
// ---------------------------------------------------------------------------

let lastScene3DProps: Record<string, unknown> = {};

vi.mock('@/components/Scene3D', () => ({
  Scene3D: (props: Record<string, unknown>) => {
    lastScene3DProps = props;
    return <div data-testid="mock-scene3d" data-hidden={String(props.hidden)} />;
  },
}));

import { Scene3DFallback } from '../Scene3DFallback';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function render(
  overrides?: Partial<React.ComponentProps<typeof Scene3DFallback>>,
): string {
  lastScene3DProps = {};
  return renderToStaticMarkup(
    <Scene3DFallback visible={false} {...overrides} />,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Scene3DFallback', () => {
  // -- 4.1 Wrapping Scene3D as fallback backend ------------------------------

  describe('4.1 Wraps Scene3D as degradation fallback', () => {
    it('renders the fallback wrapper with data-testid', () => {
      const markup = render();
      expect(markup).toContain('data-testid="scene3d-fallback"');
    });

    it('renders the inner Scene3D component', () => {
      const markup = render();
      expect(markup).toContain('data-testid="mock-scene3d"');
    });

    it('passes performanceProfile through to Scene3D', () => {
      render({ visible: true, performanceProfile: 'resizing' });
      expect(lastScene3DProps.performanceProfile).toBe('resizing');
    });

    it('passes sidebarWidth through to Scene3D', () => {
      render({ visible: true, sidebarWidth: 280 });
      expect(lastScene3DProps.sidebarWidth).toBe(280);
    });

    // Wave A：自动驾驶 3D 场景融合 mode prop 透传回归。
    // 验证 Scene3DFallback 把 mode 透传给内部 Scene3D，且默认 mode 为 undefined（由 Scene3D 默认值兜底）。
    it('passes mode through to Scene3D when mode="blueprint"', () => {
      render({ visible: true, mode: 'blueprint' });
      expect(lastScene3DProps.mode).toBe('blueprint');
    });

    it('passes mode through to Scene3D when mode="mission-first"', () => {
      render({ visible: true, mode: 'mission-first' });
      expect(lastScene3DProps.mode).toBe('mission-first');
    });

    it('omits mode when not provided so Scene3D uses its default', () => {
      render({ visible: true });
      expect(lastScene3DProps.mode).toBeUndefined();
    });
  });

  // -- 4.2 Flicker-free switching via CSS ------------------------------------

  describe('4.2 Flicker-free visibility switching', () => {
    it('applies opacity-100 when visible', () => {
      const markup = render({ visible: true });
      expect(markup).toContain('opacity-100');
      expect(markup).not.toContain('opacity-0');
    });

    it('applies opacity-0 when hidden', () => {
      const markup = render({ visible: false });
      expect(markup).toContain('opacity-0');
      expect(markup).not.toContain('opacity-100');
    });

    it('sets Scene3D hidden=true when not visible (preserves WebGL context)', () => {
      render({ visible: false });
      expect(lastScene3DProps.hidden).toBe(true);
    });

    it('sets Scene3D hidden=false when visible', () => {
      render({ visible: true });
      expect(lastScene3DProps.hidden).toBe(false);
    });

    it('disables pointer events when not visible', () => {
      const markup = render({ visible: false });
      expect(markup).toContain('pointer-events:none');
    });

    it('enables pointer events when visible', () => {
      const markup = render({ visible: true });
      expect(markup).toContain('pointer-events:auto');
    });

    it('uses CSS transition-opacity for smooth switching', () => {
      const markup = render({ visible: true });
      expect(markup).toContain('transition-opacity');
      expect(markup).toContain('duration-300');
    });
  });

  // -- 4.3 Interaction passthrough -------------------------------------------

  describe('4.3 3D interaction passthrough in fallback mode', () => {
    it('does not override Scene3D hidden when explicit hidden prop is provided', () => {
      render({ visible: true, hidden: true });
      // Explicit hidden=true should take precedence
      expect(lastScene3DProps.hidden).toBe(true);
    });

    it('wrapper is absolutely positioned to stack with video layer', () => {
      const markup = render({ visible: true });
      expect(markup).toContain('absolute');
      expect(markup).toContain('inset-0');
    });
  });
});
