/**
 * Shared types for the WebRTC video stream player.
 */

/** Connection lifecycle states exposed to consumers. */
export type ConnectionState =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'failed';

/** Video quality levels that can be requested from the UE stream. */
export type QualityLevel = 'high' | 'medium' | 'low';

/** Structured error produced by the connection manager. */
export interface StreamError {
  code:
    | 'CONNECTION_FAILED'
    | 'STREAM_LOST'
    | 'SIGNALING_ERROR'
    | 'TIMEOUT';
  message: string;
  retryable: boolean;
}

/** Events emitted by the connection manager. */
export interface ConnectionManagerEvents {
  onStateChange?: (state: ConnectionState) => void;
  onError?: (error: StreamError) => void;
  onStream?: (stream: MediaStream) => void;
}

/**
 * Signaling message types exchanged with the Pixel Streaming signaling proxy.
 *
 * The protocol follows the standard Pixel Streaming signaling flow:
 *   1. Client sends `{ type: 'offer', sdp }` after creating an SDP offer
 *   2. Server responds with `{ type: 'answer', sdp }`
 *   3. Both sides exchange `{ type: 'iceCandidate', candidate }` messages
 */
export type SignalingMessage =
  | { type: 'offer'; sdp: string }
  | { type: 'answer'; sdp: string }
  | { type: 'iceCandidate'; candidate: RTCIceCandidateInit }
  | { type: 'config'; peerConnectionOptions?: RTCConfiguration }
  | { type: 'ping' }
  | { type: 'pong' };
