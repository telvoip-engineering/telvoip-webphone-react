export const SIP_CRLF_KEEPALIVE_REQUEST = "\r\n\r\n";
export const SIP_CRLF_KEEPALIVE_RESPONSE = "\r\n";
export const SIP_CRLF_KEEPALIVE_TIMEOUT_MS = 10_000;
// Two consecutive misses are deliberate: browsers can suspend workers/timers,
// so a single late callback must not replace a live signaling flow mid-call.
export const SIP_CRLF_KEEPALIVE_MAX_MISSES = 2;

type SocketPayload = string | ArrayBufferLike | Blob | ArrayBufferView;

export interface JsSipSocketLike {
  via_transport: string;
  readonly url: string;
  readonly sip_uri: string;
  connect(): void;
  disconnect(): void;
  send(message: SocketPayload): boolean;
  isConnected(): boolean;
  isConnecting(): boolean;
  onconnect: () => void;
  ondisconnect: (error: boolean, code?: number, reason?: string) => void;
  ondata: (data: unknown) => void;
}

export type SipKeepalivePongPolicy = "auto" | "observe" | "required";

export interface SipKeepaliveEvent {
  type: "sent" | "response" | "missed" | "transport-failed";
  generation: number;
  at: number;
  rttMs?: number;
  consecutiveMisses?: number;
  enforced?: boolean;
  reason?: string;
}

export interface SipWebSocketDiagnostics {
  generation: number;
  connected: boolean;
  connectedAt: number | null;
  lastInboundAt: number | null;
  lastOutboundAt: number | null;
  lastKeepaliveSentAt: number | null;
  lastKeepaliveResponseAt: number | null;
  lastKeepaliveRttMs: number | null;
  keepaliveResponseSupported: boolean;
  keepaliveResponseRequired: boolean;
  consecutiveKeepaliveMisses: number;
}

interface PendingKeepalive {
  generation: number;
  sentAt: number;
  deadline: unknown;
}

interface SipKeepaliveSocketOptions {
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => unknown;
  cancel?: (handle: unknown) => void;
  timeoutMs?: number;
  maxConsecutiveMisses?: number;
  pongPolicy?: SipKeepalivePongPolicy;
  onEvent?: (event: SipKeepaliveEvent) => void;
}

const defaultSchedule = (callback: () => void, delayMs: number): unknown =>
  globalThis.setTimeout(callback, delayMs);

const defaultCancel = (handle: unknown): void => {
  globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
};

const decodeExactKeepalive = (data: unknown): string | null => {
  if (typeof data === "string") return data;

  let bytes: Uint8Array | null = null;
  if (data instanceof ArrayBuffer) {
    bytes = new Uint8Array(data);
  } else if (ArrayBuffer.isView(data)) {
    bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (!bytes || (bytes.byteLength !== 2 && bytes.byteLength !== 4)) return null;

  for (let index = 0; index < bytes.byteLength; index += 1) {
    const expected = index % 2 === 0 ? 13 : 10;
    if (bytes[index] !== expected) return null;
  }
  return bytes.byteLength === 2 ? SIP_CRLF_KEEPALIVE_RESPONSE : SIP_CRLF_KEEPALIVE_REQUEST;
};

/**
 * Structural JsSIP Socket wrapper that adds RFC 5626 CRLF flow keepalives.
 * JsSIP remains responsible for reconnection; this class only reports a dead
 * flow after the server has demonstrated CRLF-pong support (or policy requires it).
 */
export class SipKeepaliveSocket implements JsSipSocketLike {
  onconnect: () => void = () => undefined;
  ondisconnect: (error: boolean, code?: number, reason?: string) => void = () => undefined;
  ondata: (data: unknown) => void = () => undefined;

  private readonly now: () => number;
  private readonly schedule: (callback: () => void, delayMs: number) => unknown;
  private readonly cancel: (handle: unknown) => void;
  private readonly timeoutMs: number;
  private readonly maxConsecutiveMisses: number;
  private readonly pongPolicy: SipKeepalivePongPolicy;
  private readonly onEvent?: (event: SipKeepaliveEvent) => void;
  private pendingKeepalive: PendingKeepalive | null = null;
  private generation = 0;
  private connectedAt: number | null = null;
  private lastInboundAt: number | null = null;
  private lastOutboundAt: number | null = null;
  private lastKeepaliveSentAt: number | null = null;
  private lastKeepaliveResponseAt: number | null = null;
  private lastKeepaliveRttMs: number | null = null;
  private keepaliveResponseObserved = false;
  private keepaliveResponseConfirmed = false;
  private consecutiveKeepaliveMisses = 0;
  private syntheticDisconnectGeneration: number | null = null;

  constructor(
    private readonly socket: JsSipSocketLike,
    options: SipKeepaliveSocketOptions = {}
  ) {
    this.now = options.now ?? Date.now;
    this.schedule = options.schedule ?? defaultSchedule;
    this.cancel = options.cancel ?? defaultCancel;
    this.timeoutMs = Math.max(1_000, options.timeoutMs ?? SIP_CRLF_KEEPALIVE_TIMEOUT_MS);
    this.maxConsecutiveMisses = Math.max(
      1,
      options.maxConsecutiveMisses ?? SIP_CRLF_KEEPALIVE_MAX_MISSES
    );
    this.pongPolicy = options.pongPolicy ?? "auto";
    this.onEvent = options.onEvent;

    socket.onconnect = () => this.handleConnect();
    socket.ondisconnect = (error, code, reason) => this.handleDisconnect(error, code, reason);
    socket.ondata = (data) => this.handleData(data);
  }

  get via_transport(): string {
    return this.socket.via_transport;
  }

  set via_transport(value: string) {
    this.socket.via_transport = value;
  }

  get url(): string {
    return this.socket.url;
  }

  get sip_uri(): string {
    return this.socket.sip_uri;
  }

  connect(): void {
    this.socket.connect();
  }

  disconnect(): void {
    this.clearPendingKeepalive();
    this.connectedAt = null;
    this.socket.disconnect();
  }

  send(message: SocketPayload): boolean {
    const sent = this.socket.send(message);
    if (sent) this.lastOutboundAt = this.now();
    return sent;
  }

  isConnected(): boolean {
    // JsSIP's implementation returns null before it creates a native socket,
    // even though the public type declaration promises a boolean.
    return Boolean(this.socket.isConnected());
  }

  isConnecting(): boolean {
    return Boolean(this.socket.isConnecting());
  }

  /** Arm strict timeout handling after REGISTER proves RFC 5626 support. */
  confirmServerKeepaliveSupport(): void {
    this.keepaliveResponseConfirmed = true;
  }

  sendKeepalive(): boolean {
    if (!this.isConnected() || this.pendingKeepalive) return false;

    const sentAt = this.now();
    let sent = false;
    try {
      sent = this.send(SIP_CRLF_KEEPALIVE_REQUEST);
    } catch (error) {
      this.failTransport(error instanceof Error ? error.message : "SIP keepalive send failed");
      return false;
    }

    if (!sent) {
      this.failTransport("SIP keepalive send failed");
      return false;
    }

    const generation = this.generation;
    const deadline = this.schedule(() => this.handleKeepaliveTimeout(generation), this.timeoutMs);
    this.pendingKeepalive = { generation, sentAt, deadline };
    this.lastKeepaliveSentAt = sentAt;
    this.emit({ type: "sent", generation, at: sentAt });
    return true;
  }

  getDiagnostics(): SipWebSocketDiagnostics {
    return {
      generation: this.generation,
      connected: this.isConnected(),
      connectedAt: this.connectedAt,
      lastInboundAt: this.lastInboundAt,
      lastOutboundAt: this.lastOutboundAt,
      lastKeepaliveSentAt: this.lastKeepaliveSentAt,
      lastKeepaliveResponseAt: this.lastKeepaliveResponseAt,
      lastKeepaliveRttMs: this.lastKeepaliveRttMs,
      keepaliveResponseSupported: this.keepaliveResponseObserved || this.keepaliveResponseConfirmed,
      keepaliveResponseRequired: this.shouldEnforceKeepaliveResponse(),
      consecutiveKeepaliveMisses: this.consecutiveKeepaliveMisses,
    };
  }

  private handleConnect(): void {
    this.generation += 1;
    this.syntheticDisconnectGeneration = null;
    this.clearPendingKeepalive();
    this.connectedAt = this.now();
    this.lastInboundAt = null;
    this.lastOutboundAt = null;
    this.lastKeepaliveSentAt = null;
    this.lastKeepaliveResponseAt = null;
    this.lastKeepaliveRttMs = null;
    this.keepaliveResponseObserved = false;
    this.keepaliveResponseConfirmed = false;
    this.consecutiveKeepaliveMisses = 0;
    this.onconnect();
  }

  private handleDisconnect(error: boolean, code?: number, reason?: string): void {
    if (this.syntheticDisconnectGeneration === this.generation) return;
    this.clearPendingKeepalive();
    this.connectedAt = null;
    this.ondisconnect(error, code, reason);
  }

  private handleData(data: unknown): void {
    const decodedKeepalive = decodeExactKeepalive(data);
    const now = this.now();
    this.lastInboundAt = now;

    if (this.pendingKeepalive) {
      const sentAt = this.pendingKeepalive.sentAt;
      this.clearPendingKeepalive();
      this.consecutiveKeepaliveMisses = 0;
      if (decodedKeepalive === SIP_CRLF_KEEPALIVE_RESPONSE) {
        this.keepaliveResponseObserved = true;
        this.lastKeepaliveResponseAt = now;
        this.lastKeepaliveRttMs = Math.max(0, now - sentAt);
        this.emit({
          type: "response",
          generation: this.generation,
          at: now,
          rttMs: this.lastKeepaliveRttMs,
        });
      }
    }

    // JsSIP's Transport recognizes only string CRLF tokens. Preserve all
    // ordinary SIP payloads exactly as delivered by the native socket.
    this.ondata(decodedKeepalive ?? data);
  }

  private handleKeepaliveTimeout(generation: number): void {
    const pending = this.pendingKeepalive;
    if (!pending || pending.generation !== generation || generation !== this.generation) return;

    this.pendingKeepalive = null;
    this.consecutiveKeepaliveMisses += 1;
    const enforced = this.shouldEnforceKeepaliveResponse();
    this.emit({
      type: "missed",
      generation,
      at: this.now(),
      consecutiveMisses: this.consecutiveKeepaliveMisses,
      enforced,
    });

    if (enforced && this.consecutiveKeepaliveMisses >= this.maxConsecutiveMisses) {
      this.failTransport("SIP CRLF keepalive timeout");
    }
  }

  private shouldEnforceKeepaliveResponse(): boolean {
    if (this.pongPolicy === "required") return true;
    if (this.pongPolicy === "observe") return false;
    return this.keepaliveResponseConfirmed || this.keepaliveResponseObserved;
  }

  private failTransport(reason: string): void {
    if (this.syntheticDisconnectGeneration === this.generation) return;
    this.syntheticDisconnectGeneration = this.generation;
    this.clearPendingKeepalive();
    this.connectedAt = null;
    try {
      this.socket.disconnect();
    } finally {
      this.emit({
        type: "transport-failed",
        generation: this.generation,
        at: this.now(),
        reason,
      });
      this.ondisconnect(true, undefined, reason);
    }
  }

  private clearPendingKeepalive(): void {
    if (!this.pendingKeepalive) return;
    this.cancel(this.pendingKeepalive.deadline);
    this.pendingKeepalive = null;
  }

  private emit(event: SipKeepaliveEvent): void {
    try {
      this.onEvent?.(event);
    } catch (error) {
      // Telemetry is observational. It must not interrupt transport failure
      // reporting or prevent JsSIP from entering its recovery loop.
      console.error("[SIP] Keepalive observer failed", error);
    }
  }
}
