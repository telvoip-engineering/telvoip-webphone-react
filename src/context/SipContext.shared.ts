"use client";

import { createContext, type ReactNode } from "react";
import type { WebphoneRingtoneId, WebphoneSoundPreferences } from "../core/webphoneSounds";
import type { UseSIPClientReturn } from "../core/useSIPClient";

// --- Credentials types ---
export interface SipCredentialsInput {
  sipUsername?: string;
  sipPassword?: string;
  sipWsUrl?: string;
  sipDomain?: string;
  sipAuthUser?: string;
  sipDisplayName?: string;
  sipRegistrar?: string;
  sipIceServers?: RTCIceServer[];
  sipIceTransportPolicy?: RTCIceTransportPolicy;
}

export interface NormalizedSipCredentials {
  wsUri: string;
  uri: string;
  password: string;
  authorizationUser: string;
  displayName?: string;
  registrarServer?: string;
  iceServers?: RTCIceServer[];
  iceTransportPolicy?: RTCIceTransportPolicy;
}

// --- Remote identity (from currentCall.remote) ---
export interface SipRemoteIdentity {
  displayName: string | null;
  uri: string | null;
}

// --- Context state (mapped from useSIPClient) ---
export type SipCallStatus =
  "idle" | "dialing" | "ringing" | "in-call" | "incoming" | "ended" | "failed" | "connecting";

export interface SipState {
  registered: boolean;
  registering: boolean;
  /** Whether the underlying SIP WebSocket is currently connected. */
  signalingConnected: boolean;
  registrationEnabled: boolean;
  availableDevices: {
    inputs: Array<{ deviceId: string; label: string }>;
    outputs: Array<{ deviceId: string; label: string }>;
  };
  selectedInputDeviceId: string | null;
  selectedOutputDeviceId: string | null;
  deviceError: string | null;
  outputSelectionSupported: boolean;
  session: null;
  callStatus: SipCallStatus;
  direction: "in" | "out" | null;
  remoteIdentity: SipRemoteIdentity | null;
  muted: boolean;
  onHold: boolean;
  speakerEnabled: boolean;
  duration: number;
  startTime: number | null;
  iceState: string | null;
  audioReady: boolean;
  lastError: string | null;
  pendingCallStatus: SipCallStatus;
  pendingCallRemote: SipRemoteIdentity | null;
  speakerNeedsResume: boolean;
  diagnostics: { live: unknown; last: unknown };
  soundPreferences: WebphoneSoundPreferences;
  selfTest: {
    running: boolean;
    lastStartedAt: string | null;
    lastCompletedAt: string | null;
    lastResult: string | null;
    lastError: string | null;
  };
  /** Seconds left in the post-call wrap-up window; 0 when none. */
  wrapUpRemainingSeconds: number;
  /** Total length of the current wrap-up window (base + extensions). */
  wrapUpTotalSeconds: number;
  /** How many times the current wrap-up window can still be extended. */
  wrapUpExtensionsLeft: number;
  /** Whether the RNNoise noise-suppression filter is active on the mic. */
  noiseSuppressionEnabled: boolean;
  /** Whether the browser can run the RNNoise AudioWorklet filter. */
  noiseSuppressionAvailable: boolean;
}

// --- Context actions (mapped from useSIPClient) ---
export interface SipActions {
  setRegistrationEnabled: (enabled: boolean) => void;
  refreshDevices: () => Promise<void>;
  selectInputDevice: (deviceId: string | null) => Promise<void>;
  selectOutputDevice: (deviceId: string | null) => Promise<void>;
  reconnect: () => void;
  startCall: (target: string) => Promise<void>;
  hangup: () => void;
  answer: () => Promise<void>;
  reject: () => void;
  sendDtmf: (tones: string) => void;
  toggleMute: () => void;
  toggleHold: () => void;
  transferCall: (target: string) => Promise<void>;
  toggleSpeaker: () => void;
  resumeSpeaker: () => void;
  resumeCallTones: () => Promise<void>;
  setIncomingRingtone: (id: WebphoneRingtoneId) => void;
  previewIncomingRingtone: (id: WebphoneRingtoneId) => Promise<void>;
  registerAudioElement: (element: HTMLAudioElement | null) => void;
  startSelfTest: () => Promise<{ ok: boolean; reason?: string; error?: string }>;
  stopSelfTest: (reason?: string) => void;
  /** End the wrap-up window early; the agent is ready for the next call. */
  skipWrapUp: () => void;
  /** Add 30s to the wrap-up window (capped per window). */
  extendWrapUp: () => void;
  /** Turn the noise-suppression filter on/off (applies live when in a call). */
  setNoiseSuppression: (enabled: boolean) => Promise<void>;
}

export interface SipContextValue {
  state: SipState;
  actions: SipActions;
  credentials: NormalizedSipCredentials | null;
}

// Exported so an alternate provider implementation (e.g. a future cross-tab
// relay) can republish state through the same context shape.
export const SipContext = createContext<SipContextValue | null>(null);

// Actions-only context with a referentially stable value. SipContext's value
// changes on every internal tick (the call-duration timer fires once per
// second during calls), so components that only need to trigger actions —
// e.g. click-to-call cells rendered per table row — must subscribe here
// instead of useSip() to avoid re-rendering on every tick.
export const SipActionsContext = createContext<SipActions | null>(null);

const extractDomainFromSip = (value: string = ""): string | null => {
  if (!value) return null;
  const normalized = value.replace(/^sip:/i, "");
  const parts = normalized.split("@");
  return parts.length === 2 ? parts[1] : null;
};

const deriveDomainFromWs = (wsUrl: string): string | null => {
  try {
    const { hostname } = new URL(wsUrl);
    return hostname || null;
  } catch {
    return null;
  }
};

// `process.env.NODE_ENV` is replaced at build time by most bundlers
// (webpack/Vite/esbuild/tsup), but `process` itself isn't guaranteed to
// exist as a global in every environment this package might run in - guard
// it rather than assume a Next.js-style polyfill.
const isProductionBuild = (): boolean => {
  try {
    return typeof process !== "undefined" && process.env?.NODE_ENV === "production";
  } catch {
    return false;
  }
};

const isAllowedSipWebSocketUrl = (wsUrl: string): boolean => {
  try {
    const url = new URL(wsUrl);
    if (url.protocol === "wss:") return true;

    const localDevelopmentHost = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]).has(
      url.hostname
    );
    return !isProductionBuild() && url.protocol === "ws:" && localDevelopmentHost;
  } catch {
    return false;
  }
};

const buildSipUri = (username: string, domain: string | null): string | null => {
  if (!username) return null;
  const bare = username.replace(/^sip:/i, "");
  if (bare.includes("@")) {
    return `sip:${bare}`;
  }
  if (domain) {
    return `sip:${bare}@${domain}`;
  }
  return null;
};

export const normalizeCredentials = (
  credentials: SipCredentialsInput = {}
): NormalizedSipCredentials | null => {
  const {
    sipUsername,
    sipPassword,
    sipWsUrl,
    sipDomain,
    sipAuthUser,
    sipDisplayName,
    sipRegistrar,
    sipIceServers,
    sipIceTransportPolicy,
  } = credentials;
  if (!sipUsername || !sipPassword || !sipWsUrl) {
    return null;
  }
  if (!isAllowedSipWebSocketUrl(sipWsUrl)) {
    console.error("[SIP] Refusing an insecure or invalid SIP WebSocket URL.");
    return null;
  }

  const derivedDomain =
    sipDomain || extractDomainFromSip(sipUsername) || deriveDomainFromWs(sipWsUrl);
  const uri = buildSipUri(sipUsername, derivedDomain);
  if (!uri) {
    return null;
  }

  return {
    wsUri: sipWsUrl,
    uri,
    password: sipPassword,
    authorizationUser: sipAuthUser || uri.replace(/^sip:/i, "").split("@")[0],
    displayName: sipDisplayName,
    registrarServer: sipRegistrar || (derivedDomain ? `sip:${derivedDomain}` : undefined),
    iceServers: sipIceServers || undefined,
    iceTransportPolicy: sipIceTransportPolicy || undefined,
  };
};

export const mapState = (sip: UseSIPClientReturn): SipState => ({
  registered: sip.isRegistered,
  registering: sip.isRegistering,
  signalingConnected: sip.signalingConnected,
  registrationEnabled: sip.registrationEnabled,
  availableDevices: sip.availableDevices,
  selectedInputDeviceId: sip.selectedInputDeviceId,
  selectedOutputDeviceId: sip.selectedOutputDeviceId,
  deviceError: sip.deviceError,
  outputSelectionSupported: sip.sinkIdSupported,
  session: null,
  callStatus: sip.currentCall.state,
  direction:
    sip.currentCall.direction === "incoming"
      ? "in"
      : sip.currentCall.direction === "outgoing"
        ? "out"
        : null,
  remoteIdentity: sip.currentCall.remote,
  muted: sip.currentCall.muted,
  onHold: sip.currentCall.onHold,
  speakerEnabled: sip.speakerEnabled,
  duration: sip.currentCall.duration,
  startTime: sip.currentCall.startTime,
  iceState: sip.currentCall.iceState,
  audioReady: sip.audioReady,
  lastError: sip.lastError,
  pendingCallStatus: sip.pendingIncomingCall.state,
  pendingCallRemote: sip.pendingIncomingCall.remote,
  speakerNeedsResume: sip.speakerNeedsResume,
  diagnostics: sip.diagnostics,
  soundPreferences: sip.soundPreferences,
  selfTest: sip.selfTestState,
  wrapUpRemainingSeconds: sip.wrapUpRemainingSeconds,
  wrapUpTotalSeconds: sip.wrapUpTotalSeconds,
  wrapUpExtensionsLeft: sip.wrapUpExtensionsLeft,
  noiseSuppressionEnabled: sip.noiseSuppressionEnabled,
  noiseSuppressionAvailable: sip.noiseSuppressionAvailable,
});

export interface SipProviderProps {
  credentials: SipCredentialsInput;
  children: ReactNode;
  onCallSummary?: (summary: unknown) => void | Promise<void>;
  onRegistrationFailed?: (cause?: unknown) => void;
}
