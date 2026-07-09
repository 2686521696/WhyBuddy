/**
 * WebRTC Connection Manager for UE5 Pixel Streaming.
 *
 * Encapsulates RTCPeerConnection creation, ICE candidate exchange, SDP
 * negotiation, connection state monitoring, disconnect detection, and
 * automatic reconnection with exponential backoff (max 3 attempts).
 *
 * Uses the native RTCPeerConnection API — no third-party WebRTC libraries.
 */

import { SignalingClient } from './signaling-client';
import type {
  ConnectionManagerEvents,
  ConnectionState,
  QualityLevel,
  SignalingMessage,
  StreamError,
} from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of automatic reconnection attempts. */
const MAX_RECONNECT_ATTEMPTS = 3;

/** Base delay in ms for exponential backoff (doubles each attempt). */
const BASE_RECONNECT_DELAY_MS = 1_000;

/** Timeout in ms to wait for a remote stream after connection is established. */
const STREAM_TIMEOUT_MS = 10_000;

/** Default ICE servers used when the signaling proxy does not provide config. */
const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
];

// ---------------------------------------------------------------------------
// Quality presets
// ---------------------------------------------------------------------------

const QUALITY_CONSTRAINTS: Record<QualityLevel, { maxBitrate: number }> = {
  high: { maxBitrate: 10_000_000 },
  medium: { maxBitrate: 4_000_000 },
  low: { maxBitrate: 1_500_000 },
};

// ---------------------------------------------------------------------------
// WebRTCConnectionManager
// ---------------------------------------------------------------------------

export class WebRTCConnectionManager {
  // -- Public observable state ------------------------------------------------
  private _connectionState: ConnectionState = 'disconnected';
  private _quality: QualityLevel = 'high';

  // -- Internal resources -----------------------------------------------------
  private peerConnection: RTCPeerConnection | null = null;
  private signalingClient: SignalingClient | null = null;
  private remoteStream: MediaStream | null = null;
  private signalingUrl = '';
  private iceConfig: RTCConfiguration = { iceServers: DEFAULT_ICE_SERVERS };

  // -- Reconnection state -----------------------------------------------------
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isReconnecting = false;
  private intentionalDisconnect = false;

  // -- Event callbacks --------------------------------------------------------
  private events: ConnectionManagerEvents;

  constructor(events: ConnectionManagerEvents = {}) {
    this.events = events;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Current connection state. */
  get connectionState(): ConnectionState {
    return this._connectionState;
  }

  /** Current quality level. */
  get quality(): QualityLevel {
    return this._quality;
  }

  /**
   * Establish a WebRTC connection through the given signaling URL.
   * Resolves with the remote MediaStream once video is available.
   */
  async connect(signalingUrl: string): Promise<MediaStream> {
    this.signalingUrl = signalingUrl;
    this.intentionalDisconnect = false;
    this.reconnectAttempts = 0;
    return this.establishConnection();
  }

  /**
   * Gracefully disconnect and release all resources.
   * No automatic reconnection will be attempted after this call.
   */
  disconnect(): void {
    this.intentionalDisconnect = true;
    this.cancelReconnect();
    this.teardown();
    this.setConnectionState('disconnected');
  }

  /**
   * Manually trigger a reconnection attempt.
   * Resets the attempt counter so the caller gets a fresh set of retries.
   */
  async reconnect(): Promise<MediaStream> {
    this.reconnectAttempts = 0;
    this.intentionalDisconnect = false;
    this.teardown();
    return this.establishConnection();
  }

  /** Retrieve the latest RTCStatsReport from the peer connection. */
  async getStats(): Promise<RTCStatsReport> {
    if (!this.peerConnection) {
      throw new Error('No active peer connection');
    }
    return this.peerConnection.getStats();
  }

  /**
   * Request a quality level change.
   * Takes effect on the next SDP renegotiation or sender parameter update.
   */
  setQuality(quality: QualityLevel): void {
    this._quality = quality;
    this.applyQualityConstraints();
  }

  // ---------------------------------------------------------------------------
  // Connection lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Core connection flow:
   *   1. Open signaling WebSocket
   *   2. Create RTCPeerConnection
   *   3. Create & send SDP offer
   *   4. Wait for answer + ICE candidates
   *   5. Wait for remote MediaStream
   */
  private async establishConnection(): Promise<MediaStream> {
    this.setConnectionState('connecting');

    try {
      // 1. Signaling channel
      this.signalingClient = new SignalingClient({
        onMessage: (msg) => this.handleSignalingMessage(msg),
        onClose: () => this.handleSignalingClose(),
        onError: () => {
          // Signaling errors are surfaced through the close handler.
        },
      });

      await this.signalingClient.connect(this.signalingUrl);

      // 2. Peer connection
      this.createPeerConnection();

      // 3. Add a transceiver so the remote side knows we want video.
      this.peerConnection!.addTransceiver('video', { direction: 'recvonly' });
      this.peerConnection!.addTransceiver('audio', { direction: 'recvonly' });

      // 4. Create and send SDP offer
      const offer = await this.peerConnection!.createOffer();
      await this.peerConnection!.setLocalDescription(offer);

      this.signalingClient.send({
        type: 'offer',
        sdp: offer.sdp!,
      });

      // 5. Wait for the remote stream
      const stream = await this.waitForStream();
      this.remoteStream = stream;
      this.setConnectionState('connected');
      this.reconnectAttempts = 0;
      this.events.onStream?.(stream);
      return stream;
    } catch (err) {
      const error = this.toStreamError(err);
      this.events.onError?.(error);

      // If the error is retryable and we haven't exhausted attempts, auto-reconnect.
      if (error.retryable && !this.intentionalDisconnect) {
        return this.scheduleReconnect();
      }

      this.setConnectionState('failed');
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // RTCPeerConnection setup (Task 1.1)
  // ---------------------------------------------------------------------------

  private createPeerConnection(): void {
    this.peerConnection = new RTCPeerConnection(this.iceConfig);

    // ICE candidate exchange
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.signalingClient?.send({
          type: 'iceCandidate',
          candidate: event.candidate.toJSON(),
        });
      }
    };

    // Track arrival → build remote stream
    this.peerConnection.ontrack = (event) => {
      if (!this.remoteStream) {
        this.remoteStream = new MediaStream();
      }
      this.remoteStream.addTrack(event.track);
    };

    // Connection state monitoring (Task 1.3)
    this.peerConnection.onconnectionstatechange = () => {
      this.handlePeerConnectionStateChange();
    };

    this.peerConnection.oniceconnectionstatechange = () => {
      this.handleIceConnectionStateChange();
    };
  }

  // ---------------------------------------------------------------------------
  // Signaling message handling (Task 1.2)
  // ---------------------------------------------------------------------------

  private handleSignalingMessage(message: SignalingMessage): void {
    switch (message.type) {
      case 'answer':
        this.handleAnswer(message.sdp);
        break;
      case 'iceCandidate':
        this.handleRemoteIceCandidate(message.candidate);
        break;
      case 'config':
        if (message.peerConnectionOptions) {
          this.iceConfig = message.peerConnectionOptions;
        }
        break;
      default:
        // pong / unknown — ignore
        break;
    }
  }

  private async handleAnswer(sdp: string): Promise<void> {
    if (!this.peerConnection) return;
    try {
      await this.peerConnection.setRemoteDescription({
        type: 'answer',
        sdp,
      });
    } catch {
      // SDP application failure — will surface through connection state.
    }
  }

  private async handleRemoteIceCandidate(
    candidate: RTCIceCandidateInit
  ): Promise<void> {
    if (!this.peerConnection) return;
    try {
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch {
      // Non-fatal: some candidates may arrive after connection is established.
    }
  }

  private handleSignalingClose(): void {
    if (this.intentionalDisconnect) return;
    // Signaling channel dropped — treat as disconnect.
    if (this._connectionState === 'connected' || this._connectionState === 'connecting') {
      this.handleUnexpectedDisconnect();
    }
  }

  // ---------------------------------------------------------------------------
  // Connection state monitoring (Task 1.3)
  // ---------------------------------------------------------------------------

  private handlePeerConnectionStateChange(): void {
    const state = this.peerConnection?.connectionState;
    switch (state) {
      case 'connected':
        this.setConnectionState('connected');
        break;
      case 'disconnected':
        // Brief disconnects are common; wait for ICE to recover.
        break;
      case 'failed':
        this.handleUnexpectedDisconnect();
        break;
      case 'closed':
        if (!this.intentionalDisconnect) {
          this.handleUnexpectedDisconnect();
        }
        break;
    }
  }

  private handleIceConnectionStateChange(): void {
    const state = this.peerConnection?.iceConnectionState;
    if (state === 'failed' || state === 'disconnected') {
      // Give the peer connection a moment to recover before treating as lost.
      setTimeout(() => {
        if (
          this.peerConnection?.iceConnectionState === 'failed' ||
          this.peerConnection?.iceConnectionState === 'disconnected'
        ) {
          this.handleUnexpectedDisconnect();
        }
      }, 2_000);
    }
  }

  private handleUnexpectedDisconnect(): void {
    if (this.intentionalDisconnect || this.isReconnecting) return;

    this.teardown();

    if (this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      // Fire-and-forget: errors are surfaced through the onError callback.
      this.scheduleReconnect().catch(() => {
        // Reconnection failures are already reported via onError events.
      });
    } else {
      this.setConnectionState('failed');
      this.events.onError?.({
        code: 'CONNECTION_FAILED',
        message: `Reconnection failed after ${MAX_RECONNECT_ATTEMPTS} attempts`,
        retryable: false,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Auto-reconnect with exponential backoff (Task 1.4)
  // ---------------------------------------------------------------------------

  private scheduleReconnect(): Promise<MediaStream> {
    return new Promise<MediaStream>((resolve, reject) => {
      if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        this.setConnectionState('failed');
        this.events.onError?.({
          code: 'CONNECTION_FAILED',
          message: `Reconnection failed after ${MAX_RECONNECT_ATTEMPTS} attempts`,
          retryable: false,
        });
        reject(new Error('Max reconnection attempts exceeded'));
        return;
      }

      this.isReconnecting = true;
      this.reconnectAttempts++;
      this.setConnectionState('connecting');

      const delay = BASE_RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempts - 1);

      this.reconnectTimer = setTimeout(async () => {
        try {
          const stream = await this.establishConnection();
          this.isReconnecting = false;
          resolve(stream);
        } catch (err) {
          this.isReconnecting = false;
          reject(err);
        }
      }, delay);
    });
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.isReconnecting = false;
  }

  // ---------------------------------------------------------------------------
  // Quality constraints
  // ---------------------------------------------------------------------------

  private applyQualityConstraints(): void {
    if (!this.peerConnection) return;

    const senders = this.peerConnection.getSenders();
    const preset = QUALITY_CONSTRAINTS[this._quality];

    for (const sender of senders) {
      if (sender.track?.kind !== 'video') continue;

      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      for (const encoding of params.encodings) {
        encoding.maxBitrate = preset.maxBitrate;
      }
      sender.setParameters(params).catch(() => {
        // Best-effort quality adjustment.
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Stream waiting
  // ---------------------------------------------------------------------------

  private waitForStream(): Promise<MediaStream> {
    return new Promise<MediaStream>((resolve, reject) => {
      // If we already received tracks, resolve immediately.
      if (this.remoteStream && this.remoteStream.getTracks().length > 0) {
        resolve(this.remoteStream);
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error('Timed out waiting for remote media stream'));
      }, STREAM_TIMEOUT_MS);

      // Listen for the first track event.
      const handler = (event: RTCTrackEvent) => {
        clearTimeout(timeout);
        this.peerConnection?.removeEventListener('track', handler);

        if (!this.remoteStream) {
          this.remoteStream = new MediaStream();
        }
        this.remoteStream.addTrack(event.track);
        resolve(this.remoteStream);
      };

      this.peerConnection?.addEventListener('track', handler);
    });
  }

  // ---------------------------------------------------------------------------
  // Teardown & helpers
  // ---------------------------------------------------------------------------

  /** Release all WebRTC and signaling resources. */
  private teardown(): void {
    this.signalingClient?.close();
    this.signalingClient = null;

    if (this.peerConnection) {
      this.peerConnection.onicecandidate = null;
      this.peerConnection.ontrack = null;
      this.peerConnection.onconnectionstatechange = null;
      this.peerConnection.oniceconnectionstatechange = null;
      this.peerConnection.close();
      this.peerConnection = null;
    }

    if (this.remoteStream) {
      for (const track of this.remoteStream.getTracks()) {
        track.stop();
      }
      this.remoteStream = null;
    }
  }

  private setConnectionState(state: ConnectionState): void {
    if (this._connectionState === state) return;
    this._connectionState = state;
    this.events.onStateChange?.(state);
  }

  private toStreamError(err: unknown): StreamError {
    const message =
      err instanceof Error ? err.message : 'Unknown connection error';

    if (message.includes('Signaling')) {
      return { code: 'SIGNALING_ERROR', message, retryable: true };
    }
    if (message.includes('Timed out')) {
      return { code: 'TIMEOUT', message, retryable: true };
    }
    return { code: 'CONNECTION_FAILED', message, retryable: true };
  }
}
