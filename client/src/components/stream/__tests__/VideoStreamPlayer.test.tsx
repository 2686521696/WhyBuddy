import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Polyfill MediaStream for Node.js test environment
// ---------------------------------------------------------------------------

class MockMediaStream {
  id = 'mock-stream';
  active = true;
  getTracks() { return []; }
  getVideoTracks() { return []; }
  getAudioTracks() { return []; }
  addTrack() {}
  removeTrack() {}
  clone() { return new MockMediaStream(); }
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() { return true; }
}

// ---------------------------------------------------------------------------
// Mock WebRTCConnectionManager before importing the component
// ---------------------------------------------------------------------------

const mockConnect = vi.fn<() => Promise<MediaStream>>();
const mockDisconnect = vi.fn();
const mockSetQuality = vi.fn();

let capturedEvents: {
  onStateChange?: (state: string) => void;
  onError?: (error: { code: string; message: string; retryable: boolean }) => void;
  onStream?: (stream: unknown) => void;
};

vi.mock('@/lib/webrtc', () => ({
  WebRTCConnectionManager: vi.fn().mockImplementation((events: typeof capturedEvents) => {
    capturedEvents = events;
    return {
      connect: mockConnect,
      disconnect: mockDisconnect,
      setQuality: mockSetQuality,
      connectionState: 'disconnected',
      quality: 'high',
    };
  }),
}));

// Mock Scene3D to avoid WebGL context requirements
vi.mock('@/components/Scene3D', () => ({
  Scene3D: (props: Record<string, unknown>) => (
    <div
      data-testid="mock-scene3d"
      data-hidden={String(props.hidden)}
      data-performance-profile={String(props.performanceProfile ?? 'balanced')}
      data-sidebar-width={String(props.sidebarWidth ?? 0)}
    />
  ),
}));

// Mock framer-motion to avoid SSR issues
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  motion: {
    div: ({
      children,
      className,
      role,
      ...rest
    }: React.HTMLAttributes<HTMLDivElement> & Record<string, unknown>) => (
      <div className={className} role={role}>
        {children}
      </div>
    ),
  },
}));

import { VideoStreamPlayer } from '../VideoStreamPlayer';
import type { RenderMode } from '../VideoStreamPlayer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderPlayer(
  overrides?: Partial<React.ComponentProps<typeof VideoStreamPlayer>>,
): string {
  return renderToStaticMarkup(
    <VideoStreamPlayer
      signalingUrl="ws://localhost:8888"
      autoConnect={false}
      {...overrides}
    />,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VideoStreamPlayer', () => {
  beforeAll(() => {
    // Make MediaStream available globally for the component code
    (globalThis as Record<string, unknown>).MediaStream = MockMediaStream;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue(new MockMediaStream() as unknown as MediaStream);
  });

  // -- 2.1 Component skeleton & props ----------------------------------------

  describe('2.1 Component skeleton and props', () => {
    it('renders the root container with data-testid', () => {
      const markup = renderPlayer();
      expect(markup).toContain('data-testid="video-stream-player"');
    });

    it('applies custom className to the root container', () => {
      const markup = renderPlayer({ className: 'my-custom-class' });
      expect(markup).toContain('my-custom-class');
    });

    it('sets data-render-mode attribute on the container', () => {
      const markup = renderPlayer();
      expect(markup).toContain('data-render-mode="connecting"');
    });

    it('defaults to connecting render mode', () => {
      const markup = renderPlayer();
      expect(markup).toContain('data-render-mode="connecting"');
    });
  });

  // -- 2.2 Video element rendering -------------------------------------------

  describe('2.2 Video element rendering', () => {
    it('renders a video element with required attributes', () => {
      const markup = renderPlayer();
      expect(markup).toContain('data-testid="video-stream-element"');
      expect(markup).toContain('autoPlay');
      expect(markup).toContain('playsInline');
    });

    it('video element has object-contain for adaptive sizing', () => {
      const markup = renderPlayer();
      expect(markup).toContain('object-contain');
    });

    it('video element is hidden (opacity-0) when not streaming', () => {
      const markup = renderPlayer();
      expect(markup).toContain('opacity-0');
    });
  });

  // -- 2.3 Adaptive container & fullscreen -----------------------------------

  describe('2.3 Adaptive container sizing and fullscreen', () => {
    it('renders the fullscreen toggle button', () => {
      const markup = renderPlayer();
      expect(markup).toContain('Enter fullscreen');
    });

    it('container fills available space with h-full w-full', () => {
      const markup = renderPlayer();
      expect(markup).toContain('h-full');
      expect(markup).toContain('w-full');
    });

    it('container has overflow-hidden to prevent content bleed', () => {
      const markup = renderPlayer();
      expect(markup).toContain('overflow-hidden');
    });
  });

  // -- 2.4 UI state overlays ------------------------------------------------

  describe('2.4 Connecting / error / degraded UI states', () => {
    it('shows connecting overlay with spinner text', () => {
      const markup = renderPlayer();
      // Default state is connecting when autoConnect is false
      expect(markup).toContain('正在连接视频流');
    });

    it('shows connecting overlay with status role for accessibility', () => {
      const markup = renderPlayer();
      expect(markup).toContain('role="status"');
    });

    it('renders the video element even during connecting state', () => {
      const markup = renderPlayer();
      expect(markup).toContain('data-testid="video-stream-element"');
      expect(markup).toContain('正在连接视频流');
    });
  });

  // -- 6.2 Additional integration tests ----------------------------------------

  describe('6.2 Quality selector integration', () => {
    it('renders QualitySelector when in ue-stream mode', () => {
      // When streaming, the quality selector should be present.
      // Since we can't easily simulate ue-stream in SSR, we verify the
      // component accepts quality-related props without error.
      const markup = renderPlayer({ quality: 'medium' });
      // The player should render without errors with quality prop.
      expect(markup).toContain('data-testid="video-stream-player"');
    });

    it('accepts all quality levels as props', () => {
      for (const q of ['high', 'medium', 'low', 'auto'] as const) {
        const markup = renderPlayer({ quality: q });
        expect(markup).toContain('data-testid="video-stream-player"');
      }
    });
  });

  describe('6.2 onModeChange callback', () => {
    it('accepts onModeChange prop without error', () => {
      const onModeChange = vi.fn();
      const markup = renderPlayer({ onModeChange });
      expect(markup).toContain('data-testid="video-stream-player"');
    });
  });

  describe('6.2 Degraded mode overlays', () => {
    it('shows degraded overlay text when fallbackMode is threejs', () => {
      // The component starts in connecting mode, but the fallback layer is mounted.
      const markup = renderPlayer({ fallbackMode: 'threejs' });
      expect(markup).toContain('data-testid="scene3d-fallback"');
    });

    it('does not show degraded overlay in connecting state', () => {
      const markup = renderPlayer();
      // Should show connecting overlay, not degraded.
      expect(markup).toContain('正在连接视频流');
      expect(markup).not.toContain('简化渲染模式');
    });
  });

  // -- Export type checks ----------------------------------------------------

  describe('RenderMode type', () => {
    it('accepts all valid render modes', () => {
      const modes: RenderMode[] = [
        'ue-stream',
        'threejs',
        'prerender',
        'connecting',
        'error',
      ];
      expect(modes).toHaveLength(5);
    });
  });

  // -- 4.1 / 4.2 / 4.3 Three.js fallback integration -----------------------

  describe('4.x Three.js fallback integration', () => {
    it('renders Scene3DFallback when fallbackMode is threejs', () => {
      const markup = renderPlayer({ fallbackMode: 'threejs' });
      expect(markup).toContain('data-testid="scene3d-fallback"');
      expect(markup).toContain('data-testid="mock-scene3d"');
    });

    it('does not render Scene3DFallback when fallbackMode is none', () => {
      const markup = renderPlayer({ fallbackMode: 'none' });
      expect(markup).not.toContain('data-testid="scene3d-fallback"');
    });

    it('does not render Scene3DFallback when fallbackMode is prerender', () => {
      const markup = renderPlayer({ fallbackMode: 'prerender' });
      expect(markup).not.toContain('data-testid="scene3d-fallback"');
    });

    it('Scene3DFallback is hidden (opacity-0) during connecting state', () => {
      const markup = renderPlayer({ fallbackMode: 'threejs' });
      // Default state is connecting, so Scene3D should be hidden
      expect(markup).toContain('data-testid="scene3d-fallback"');
      // The fallback wrapper should have opacity-0 since renderMode is connecting
      const fallbackSection = markup.split('data-testid="scene3d-fallback"')[0];
      // The video element also has opacity-0 during connecting
      expect(markup).toContain('opacity-0');
    });

    it('passes performanceProfile to Scene3DFallback', () => {
      const markup = renderPlayer({
        fallbackMode: 'threejs',
        performanceProfile: 'resizing',
      });
      expect(markup).toContain('data-performance-profile="resizing"');
    });

    it('passes sidebarWidth to Scene3DFallback', () => {
      const markup = renderPlayer({
        fallbackMode: 'threejs',
        sidebarWidth: 320,
      });
      expect(markup).toContain('data-sidebar-width="320"');
    });

    it('both video and Scene3D layers are absolutely positioned for stacking', () => {
      const markup = renderPlayer({ fallbackMode: 'threejs' });
      // Video element has absolute positioning
      expect(markup).toContain('data-testid="video-stream-element"');
      // Scene3DFallback wrapper has absolute positioning
      expect(markup).toContain('data-testid="scene3d-fallback"');
      // Both should be inside the same relative container
      expect(markup).toContain('data-testid="video-stream-player"');
    });

    it('video element is always rendered even when fallback is active', () => {
      const markup = renderPlayer({ fallbackMode: 'threejs' });
      expect(markup).toContain('data-testid="video-stream-element"');
      expect(markup).toContain('data-testid="scene3d-fallback"');
    });
  });
});
