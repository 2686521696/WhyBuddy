/**
 * VideoStreamPlayer — React component for UE5 Pixel Streaming video playback.
 *
 * Renders a WebRTC video stream from a UE5 instance via the signaling proxy,
 * manages internal render mode state, supports adaptive container sizing and
 * fullscreen, and shows connecting / error / degradation UI overlays.
 */

import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  Maximize,
  Minimize,
  MonitorPlay,
  RefreshCw,
  Wifi,
  WifiOff,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { WebRTCConnectionManager, QualityMonitor } from '@/lib/webrtc';
import type { ConnectionState, QualityLevel, StreamError } from '@/lib/webrtc';

import { QualitySelector } from './QualitySelector';
import type { QualityOption } from './QualitySelector';
import { Scene3DFallback } from './Scene3DFallback';
import type { ScenePerformanceProfile } from '@/components/Scene3D';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Render modes the player can be in at any given time. */
export type RenderMode =
  | 'ue-stream'
  | 'threejs'
  | 'prerender'
  | 'connecting'
  | 'error';

export interface VideoStreamPlayerProps {
  /** Signaling proxy WebSocket URL for the Pixel Streaming instance. */
  signalingUrl: string;
  /** Whether to connect automatically on mount. @default true */
  autoConnect?: boolean;
  /** Requested quality level. @default 'auto' */
  quality?: 'high' | 'medium' | 'low' | 'auto';
  /** Fallback rendering mode when UE stream is unavailable. @default 'none' */
  fallbackMode?: 'threejs' | 'prerender' | 'none';
  /** Called when the WebRTC connection is established and streaming. */
  onConnected?: () => void;
  /** Called when the connection is lost. */
  onDisconnected?: () => void;
  /** Called when a connection error occurs. */
  onError?: (error: StreamError) => void;
  /** Called when the internal render mode changes. */
  onModeChange?: (mode: RenderMode) => void;
  /** Performance profile forwarded to the Three.js fallback Scene3D. @default 'balanced' */
  performanceProfile?: ScenePerformanceProfile;
  /** Sidebar width in pixels, forwarded to Scene3D for camera compensation. @default 0 */
  sidebarWidth?: number;
  /** Additional CSS class names for the root container. */
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function VideoStreamPlayer({
  signalingUrl,
  autoConnect = true,
  quality = 'auto',
  fallbackMode = 'none',
  onConnected,
  onDisconnected,
  onError,
  onModeChange,
  performanceProfile = 'balanced',
  sidebarWidth = 0,
  className,
}: VideoStreamPlayerProps) {
  // -- Refs ------------------------------------------------------------------
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const managerRef = useRef<WebRTCConnectionManager | null>(null);
  const monitorRef = useRef<QualityMonitor | null>(null);

  // -- State -----------------------------------------------------------------
  const [renderMode, setRenderMode] = useState<RenderMode>('connecting');
  const [connectionState, setConnectionState] =
    useState<ConnectionState>('disconnected');
  const [lastError, setLastError] = useState<StreamError | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [activeQuality, setActiveQuality] = useState<QualityOption>(quality);

  // -- Render mode helper ----------------------------------------------------
  const updateRenderMode = useCallback(
    (mode: RenderMode) => {
      setRenderMode((prev) => {
        if (prev === mode) return prev;
        onModeChange?.(mode);
        return mode;
      });
    },
    [onModeChange],
  );

  // -- Bind MediaStream to <video> -------------------------------------------
  const attachStream = useCallback((stream: MediaStream) => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    video.play().catch(() => {
      // Autoplay may be blocked; user interaction will resume.
    });
  }, []);

  // -- Connection lifecycle --------------------------------------------------
  const connect = useCallback(async () => {
    // Tear down any previous manager.
    managerRef.current?.disconnect();

    updateRenderMode('connecting');
    setLastError(null);
    setReconnectAttempt(0);

    const manager = new WebRTCConnectionManager({
      onStateChange(state) {
        setConnectionState(state);

        if (state === 'connected') {
          updateRenderMode('ue-stream');
          setReconnectAttempt(0);
          onConnected?.();
        } else if (state === 'connecting') {
          setReconnectAttempt((prev) => prev + 1);
          updateRenderMode('connecting');
        } else if (state === 'disconnected') {
          onDisconnected?.();
        } else if (state === 'failed') {
          // Determine fallback mode.
          if (fallbackMode === 'threejs') {
            updateRenderMode('threejs');
          } else if (fallbackMode === 'prerender') {
            updateRenderMode('prerender');
          } else {
            updateRenderMode('error');
          }
          onDisconnected?.();
        }
      },
      onError(error) {
        setLastError(error);
        onError?.(error);
      },
      onStream(stream) {
        attachStream(stream);
      },
    });

    managerRef.current = manager;

    // Apply quality if not auto.
    if (quality !== 'auto') {
      manager.setQuality(quality);
    }

    try {
      const stream = await manager.connect(signalingUrl);
      attachStream(stream);
    } catch {
      // Errors are surfaced through the onError callback above.
    }
  }, [
    signalingUrl,
    quality,
    fallbackMode,
    onConnected,
    onDisconnected,
    onError,
    updateRenderMode,
    attachStream,
  ]);

  // -- Auto-connect on mount -------------------------------------------------
  useEffect(() => {
    if (autoConnect) {
      connect();
    }

    return () => {
      managerRef.current?.disconnect();
      managerRef.current = null;

      // Release video element reference.
      const video = videoRef.current;
      if (video) {
        video.srcObject = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoConnect, signalingUrl]);

  // -- Quality changes -------------------------------------------------------
  useEffect(() => {
    if (quality !== 'auto' && managerRef.current) {
      managerRef.current.setQuality(quality);
    }
  }, [quality]);

  // -- Quality monitor lifecycle (Tasks 5.1 & 5.2) --------------------------
  useEffect(() => {
    const manager = managerRef.current;
    if (!manager) return;

    // Create monitor if it doesn't exist yet.
    if (!monitorRef.current) {
      monitorRef.current = new QualityMonitor(manager, {
        onQualityChange(newQuality: QualityLevel) {
          setActiveQuality(newQuality);
        },
      });
    }

    if (activeQuality === 'auto') {
      // Auto mode: start the monitor.
      monitorRef.current.start();
    } else {
      // Manual mode: stop the monitor and apply the selected quality.
      monitorRef.current.stop();
      monitorRef.current.setQuality(activeQuality);
    }

    return () => {
      monitorRef.current?.stop();
    };
  }, [activeQuality, connectionState]);

  // Cleanup monitor on unmount
  useEffect(() => {
    return () => {
      monitorRef.current?.destroy();
      monitorRef.current = null;
    };
  }, []);

  // -- Quality selector handler (Task 5.3) -----------------------------------
  const handleQualityChange = useCallback((selected: QualityOption) => {
    setActiveQuality(selected);
    if (selected !== 'auto' && managerRef.current) {
      managerRef.current.setQuality(selected);
    }
  }, []);

  // -- Fullscreen support ----------------------------------------------------
  const toggleFullscreen = useCallback(async () => {
    const container = containerRef.current;
    if (!container) return;

    try {
      if (!document.fullscreenElement) {
        await container.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // Fullscreen may not be available in all contexts.
    }
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  // -- Manual reconnect ------------------------------------------------------
  const handleReconnect = useCallback(() => {
    connect();
  }, [connect]);

  // -- Derived state ---------------------------------------------------------
  const isConnecting =
    renderMode === 'connecting' || connectionState === 'connecting';
  const isError = renderMode === 'error';
  const isDegraded =
    renderMode === 'threejs' || renderMode === 'prerender';
  const isStreaming = renderMode === 'ue-stream';
  const isThreejsFallback = renderMode === 'threejs';

  // -- Render ----------------------------------------------------------------
  return (
    <div
      ref={containerRef}
      className={`relative h-full w-full overflow-hidden bg-black ${className ?? ''}`}
      data-testid="video-stream-player"
      data-render-mode={renderMode}
    >
      {/* Layer 0: Video element — always present, hidden when not streaming */}
      <video
        ref={videoRef}
        className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-300 ${
          isStreaming ? 'opacity-100' : 'opacity-0'
        }`}
        autoPlay
        playsInline
        muted
        data-testid="video-stream-element"
      />

      {/* Layer 0b: Three.js fallback — always mounted when fallbackMode is
          'threejs' to preserve WebGL context; visibility controlled via CSS */}
      {fallbackMode === 'threejs' && (
        <Scene3DFallback
          visible={isThreejsFallback}
          performanceProfile={performanceProfile}
          sidebarWidth={sidebarWidth}
        />
      )}

      {/* Layer 1: UI overlays */}
      <AnimatePresence mode="wait">
        {/* Connecting state */}
        {isConnecting && (
          <ConnectingOverlay
            key="connecting"
            reconnectAttempt={reconnectAttempt}
          />
        )}

        {/* Error state */}
        {isError && (
          <ErrorOverlay
            key="error"
            error={lastError}
            onReconnect={handleReconnect}
          />
        )}

        {/* Degraded / fallback state */}
        {isDegraded && (
          <DegradedOverlay
            key="degraded"
            mode={renderMode as 'threejs' | 'prerender'}
            onReconnect={handleReconnect}
          />
        )}
      </AnimatePresence>

      {/* Layer 2: Controls — always visible */}
      <div className="absolute right-3 top-3 z-20 flex items-center gap-2">
        {/* Connection indicator */}
        {isStreaming && (
          <div className="flex items-center gap-1.5 rounded-full bg-black/50 px-2.5 py-1 text-xs text-emerald-400 backdrop-blur-sm">
            <Wifi className="size-3" />
            <span>Live</span>
          </div>
        )}

        {/* Quality selector (Task 5.3) */}
        {isStreaming && (
          <QualitySelector
            value={activeQuality}
            onChange={handleQualityChange}
          />
        )}

        <button
          type="button"
          onClick={toggleFullscreen}
          className="rounded-lg bg-black/50 p-2 text-white/80 backdrop-blur-sm transition-colors hover:bg-black/70 hover:text-white"
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        >
          {isFullscreen ? (
            <Minimize className="size-4" />
          ) : (
            <Maximize className="size-4" />
          )}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components: Overlay states
// ---------------------------------------------------------------------------

/** Connecting / reconnecting overlay with spinner. */
function ConnectingOverlay({
  reconnectAttempt,
}: {
  reconnectAttempt: number;
}) {
  const isReconnecting = reconnectAttempt > 1;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm"
      role="status"
      aria-live="polite"
    >
      <div className="mb-4 size-10 animate-spin rounded-full border-4 border-white/20 border-t-white" />
      <p className="text-sm font-medium text-white">
        {isReconnecting ? '正在重新连接…' : '正在连接视频流…'}
      </p>
      {isReconnecting && (
        <p className="mt-1 text-xs text-white/60">
          重连尝试 {reconnectAttempt - 1} / 3
        </p>
      )}
    </motion.div>
  );
}

/** Error overlay with reconnect action. */
function ErrorOverlay({
  error,
  onReconnect,
}: {
  error: StreamError | null;
  onReconnect: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-black/70 backdrop-blur-sm"
      role="alert"
    >
      <div className="flex size-14 items-center justify-center rounded-full bg-red-500/20">
        <WifiOff className="size-7 text-red-400" />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium text-white">连接失败</p>
        {error && (
          <p className="mt-1 max-w-xs text-xs text-white/60">
            {error.message}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onReconnect}
        className="flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/20"
      >
        <RefreshCw className="size-4" />
        重新连接
      </button>
    </motion.div>
  );
}

/** Degraded mode indicator overlay. */
function DegradedOverlay({
  mode,
  onReconnect,
}: {
  mode: 'threejs' | 'prerender';
  onReconnect: () => void;
}) {
  const label =
    mode === 'threejs' ? '简化渲染模式 (Three.js)' : '预渲染模式';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-black/50 backdrop-blur-sm"
      role="status"
      aria-live="polite"
    >
      <div className="flex size-14 items-center justify-center rounded-full bg-amber-500/20">
        <AlertTriangle className="size-7 text-amber-400" />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium text-white">
          当前为{label}
        </p>
        <p className="mt-1 text-xs text-white/60">
          UE 实时渲染不可用，已自动降级
        </p>
      </div>
      <button
        type="button"
        onClick={onReconnect}
        className="flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/20"
      >
        <MonitorPlay className="size-4" />
        尝试恢复 UE 流
      </button>

      {/* Persistent degradation badge — stays visible even after overlay fades */}
      <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-black/60 px-2.5 py-1 text-xs text-amber-400 backdrop-blur-sm">
        <AlertTriangle className="size-3" />
        {label}
      </div>
    </motion.div>
  );
}
