/**
 * WebRTC connection management for UE5 Pixel Streaming.
 *
 * @module webrtc
 */

export { WebRTCConnectionManager } from './connection-manager';
export { SignalingClient } from './signaling-client';
export { QualityMonitor } from './quality-monitor';
export { RenderModeMachine, nextRenderMode } from './render-mode-machine';
export type {
  RenderMode,
  RenderModeEvent,
  RenderModeMachineConfig,
} from './render-mode-machine';
export type {
  QualityMetrics,
  QualityMonitorConfig,
  QualityMonitorEvents,
} from './quality-monitor';
export type {
  ConnectionManagerEvents,
  ConnectionState,
  QualityLevel,
  SignalingMessage,
  StreamError,
} from './types';
