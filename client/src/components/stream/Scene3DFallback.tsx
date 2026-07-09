/**
 * Scene3DFallback — Wrapper around the existing Scene3D component for use as
 * a degradation fallback inside VideoStreamPlayer.
 *
 * Key design decisions:
 *   - Uses CSS `visibility` (not `display:none`) to preserve the WebGL context
 *     when hidden, avoiding expensive re-initialization on mode switch.
 *   - Opacity transition provides flicker-free switching between ue-stream and
 *     threejs render modes.
 *   - Passes through all Scene3D props so existing 3D interactions (camera,
 *     click, hover) continue to work normally in fallback mode.
 */

import { Scene3D } from '@/components/Scene3D';
import type { Scene3DProps } from '@/components/Scene3D';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Scene3DFallbackProps extends Scene3DProps {
  /**
   * Whether the Three.js fallback canvas is the active render layer.
   * When `false`, the canvas is hidden via CSS visibility + opacity-0 but the
   * WebGL context is preserved (Scene3D receives `hidden=true` which sets
   * `frameloop="demand"`).
   */
  visible: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Scene3DFallback({
  visible,
  performanceProfile,
  sidebarWidth,
  hidden,
  mode,
  ...rest
}: Scene3DFallbackProps) {
  // Scene3D's own `hidden` prop controls CSS visibility and frameloop.
  // We derive it from the inverse of `visible`, but also respect an explicit
  // `hidden` override from the parent (e.g. when the entire player unmounts).
  const effectiveHidden = hidden ?? !visible;

  return (
    <div
      className={`absolute inset-0 z-0 transition-opacity duration-300 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
      style={{ pointerEvents: visible ? 'auto' : 'none' }}
      data-testid="scene3d-fallback"
    >
      <Scene3D
        performanceProfile={performanceProfile}
        sidebarWidth={sidebarWidth}
        hidden={effectiveHidden}
        mode={mode}
        {...rest}
      />
    </div>
  );
}
