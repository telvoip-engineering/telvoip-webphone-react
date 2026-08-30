"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import JsSIP from "jssip";
import {
  CALL_ENDED_TONE_PATTERN,
  CALL_FAILED_TONE_PATTERN,
  getIncomingRingtonePreset,
  getSoundPatternDurationMs,
  HOLD_TONE_PATTERN,
  readWebphoneSoundPreferences,
  RINGBACK_TONE_PATTERN,
  SPEAKER_TEST_PATTERN,
  type SoundPattern,
  type WebphoneRingtoneId,
  type WebphoneSoundPreferences,
  writeWebphoneSoundPreferences,
} from "./webphoneSounds";
import { createSessionActivationGate, type SessionActivationGate } from "./sessionActivationGate";
import { updateAudioRtpFlowEvidence, type AudioRtpFlowEvidence } from "./rtpFlowEvidence";
import {
  classifySipSessionEnd,
  type SipSessionEndClassification,
  type SipSessionEndFailureKind,
} from "./sipSessionEnd";
import {
  applyNoiseSuppressionToStream,
  disposeNoiseSuppression,
  disposeNoiseSuppressionForStream,
  isNoiseSuppressionSupported,
  preloadNoiseSuppression,
} from "../noise-suppression/noiseSuppression";
import {
  buildSpeechAudioConstraints,
  resolveNoiseSuppressionEnabled,
  shouldApplyCustomNoiseSuppression,
} from "../noise-suppression/noiseSuppressionConfig";
import {
  createCallQualityOptimizer,
  type AdaptiveAudioQualityMetrics,
} from "./callQualityOptimizer";
import { selectCandidatePairReport } from "./selectCandidatePair";
import {
  getIceGatheringWatchdogMs,
  ICE_DISCONNECTED_RESTART_DELAY_MS,
  ICE_RESTART_READINESS_RETRY_DELAY_MS,
  shouldAttemptIceRestart,
  shouldRetryIceRestartReadiness,
  summarizeIceServerUrl,
  summarizeSdpIceConnectivity,
} from "./iceRecovery";
import { detachRemoteAudioElement, shouldMuteRemoteAudio } from "./remoteAudio";
import { type SipSessionTimerRefreshMethod } from "./sipSessionTimerConfig";
import {
  DEFAULT_WRAP_UP_DURATION_SECONDS,
  DEFAULT_WRAP_UP_REJECT_INCOMING,
  rejectIncomingDuringWrapUp,
} from "./wrapUpConfig";
import { getOrCreateSipInstanceId } from "./sipInstanceId";
import {
  SipKeepaliveSocket,
  type JsSipSocketLike,
  type SipWebSocketDiagnostics,
} from "./sipWebSocket";
import { canSendRtpDtmf, setOutgoingAudioEnabled } from "./sipCallControl";
import { bindIceNetworkAdvisories } from "./iceNetworkAdvisory";
import { minimizeSdpCandidates } from "./minimizeSdpCandidates";
import {
  createDialTargetFormatter,
  toDialTargetInput,
  type DialTargetFormat,
  type DialTargetFormatter,
  type DialTargetInput,
} from "./dialTarget";
import type { CountryCode } from "libphonenumber-js/min";

// --- Call state and identity types ---
export type SipCallStateValue =
  "idle" | "dialing" | "ringing" | "connecting" | "in-call" | "incoming" | "ended" | "failed";

export interface SipRemoteIdentity {
  displayName: string | null;
  uri: string | null;
}

export interface CurrentCallState {
  id: string | null;
  state: SipCallStateValue;
  direction: "incoming" | "outgoing" | null;
  remote: SipRemoteIdentity | null;
  muted: boolean;
  onHold: boolean;
  duration: number;
  startTime: number | null;
  iceState: string | null;
}

// --- Config and options (matches NormalizedSipCredentials from SipContext) ---
export interface SipClientConfig {
  wsUri?: string;
  uri?: string;
  password?: string;
  authorizationUser?: string;
  displayName?: string;
  registrarServer?: string;
  iceServers?: RTCIceServer[];
  iceTransportPolicy?: RTCIceTransportPolicy;
}

export interface UseSIPClientOptions {
  onCallSummary?: (summary: unknown) => void | Promise<void>;
  /** Called when SIP registration fails — consumer can refresh credentials. */
  onRegistrationFailed?: (cause?: unknown) => void;
  /** Visible after-call work window, in seconds. 0 disables the timer. Default 45. */
  wrapUpDurationSeconds?: number;
  /** How many times the wrap-up window can be extended (0 disables). Default 2. */
  wrapUpMaxExtensions?: number;
  /** Auto-reject incoming INVITEs during the wrap-up window. Default true. */
  wrapUpRejectIncoming?: boolean;
  /**
   * SIP session-timers refresh method (RFC 4028). Some PBXes reject in-dialog
   * UPDATEs — set to "invite" if yours does. Default "update".
   */
  sessionTimersRefreshMethod?: SipSessionTimerRefreshMethod;
  /**
   * Force the browser as session-timers refresher. Default false (keeps
   * JsSIP's negotiated default) — only opt in after validating against your PBX.
   */
  sessionTimersForceRefresher?: boolean;
  /** Enable the RNNoise noise-suppression filter on the microphone. Default true. */
  noiseSuppressionEnabled?: boolean;
  /**
   * Override where the RNNoise WASM/worklet assets load from. Defaults to a
   * jsdelivr URL pinned to this package's installed version. Only consulted
   * on the first load per page - see resolveNoiseSuppressionAssetBaseUrl.
   */
  noiseSuppressionAssetBaseUrl?: string;
  /** Built-in formatting policy applied to every outbound call. Default "preserve". */
  dialTargetFormat?: DialTargetFormat;
  /** ISO 3166-1 alpha-2 country used for local numbers without a country. */
  defaultCallingCountry?: CountryCode;
  /** Custom dial plan transform. Overrides dialTargetFormat when provided. */
  formatDialTarget?: DialTargetFormatter;
}

// --- Device and diagnostics types ---
export interface AvailableDevice {
  deviceId: string;
  label: string;
}

export interface AvailableDevices {
  inputs: AvailableDevice[];
  outputs: AvailableDevice[];
}

export interface DiagnosticsState {
  live: unknown;
  last: unknown;
}

export interface SelfTestState {
  running: boolean;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastResult: string | null;
  lastError: string | null;
}

interface AcquiredInputStream {
  stream: MediaStream;
  resolvedDeviceId: string | null;
  fellBackToDefault: boolean;
}

// --- Tone state ref (internal) ---
interface ToneStateRef {
  active: boolean;
  oscillators: OscillatorNode[];
  gain: GainNode | null;
  stopTimeout: number | null;
  nextTimeout: number | null;
}

// --- Return type of useSIPClient ---
export interface UseSIPClientReturn {
  isRegistered: boolean;
  isRegistering: boolean;
  signalingConnected: boolean;
  registrationEnabled: boolean;
  audioReady: boolean;
  currentCall: CurrentCallState;
  pendingIncomingCall: CurrentCallState;
  lastError: string | null;
  availableDevices: AvailableDevices;
  selectedInputDeviceId: string | null;
  selectedOutputDeviceId: string | null;
  speakerEnabled: boolean;
  deviceError: string | null;
  sinkIdSupported: boolean;
  speakerNeedsResume: boolean;
  soundPreferences: WebphoneSoundPreferences;
  setRegistrationEnabled: (enabled: boolean) => void;
  refreshDevices: () => Promise<void>;
  selectInputDevice: (deviceId: string | null) => Promise<void>;
  selectOutputDevice: (deviceId: string | null) => Promise<void>;
  makeCall: (target: string | DialTargetInput) => Promise<void>;
  endCall: () => void;
  answerCall: () => Promise<void>;
  rejectCall: () => void;
  sendDtmf: (tones: string) => void;
  toggleMute: () => void;
  toggleHold: () => void;
  transferCall: (target: string) => Promise<void>;
  toggleSpeaker: () => void;
  resumeSpeaker: () => void;
  resumeCallTones: () => Promise<void>;
  setIncomingRingtone: (id: WebphoneRingtoneId) => void;
  previewIncomingRingtone: (id: WebphoneRingtoneId) => Promise<void>;
  /** Play a short test tone through the current browser audio output. */
  testSpeaker: () => void;
  reconnect: () => void;
  registerAudioElement: (element: HTMLAudioElement | null) => void;
  diagnostics: DiagnosticsState;
  selfTestState: SelfTestState;
  startSelfTest: () => Promise<{ ok: boolean; reason?: string; error?: string }>;
  stopSelfTest: (reason?: string) => void;
  /** Seconds remaining in the post-call wrap-up window; 0 when idle. */
  wrapUpRemainingSeconds: number;
  /** Total length of the current wrap-up window (base + extensions). */
  wrapUpTotalSeconds: number;
  /** How many times the current wrap-up window can still be extended. */
  wrapUpExtensionsLeft: number;
  /** End the wrap-up window immediately (agent is ready for the next call). */
  skipWrapUp: () => void;
  /** Add WRAP_UP_EXTEND_SECONDS to the wrap-up window (capped). */
  extendWrapUp: () => void;
  /** Whether the RNNoise noise-suppression filter is active on the mic. */
  noiseSuppressionEnabled: boolean;
  /** Whether the browser can run the RNNoise AudioWorklet filter. */
  noiseSuppressionAvailable: boolean;
  /** Turn the noise-suppression filter on/off (applies live when in a call). */
  setNoiseSuppression: (enabled: boolean) => Promise<void>;
}

const CALL_STATES = {
  IDLE: "idle",
  DIALING: "dialing",
  RINGING: "ringing",
  CONNECTING: "connecting",
  ACTIVE: "in-call",
  INCOMING: "incoming",
  ENDED: "ended",
  FAILED: "failed",
} as const;
const TERMINAL_CALL_STATUS_DISPLAY_MS = 3_000;

/** How much time a single "Extend" click adds to the wrap-up window. */
const WRAP_UP_EXTEND_SECONDS = 30;
/** Default cap on wrap-up window extensions when the consumer doesn't override it. */
const DEFAULT_WRAP_UP_MAX_EXTENSIONS = 2;
/** Default session-timers refresh method when the consumer doesn't override it. */
const DEFAULT_SESSION_TIMERS_REFRESH_METHOD: SipSessionTimerRefreshMethod = "update";

const SIP_KEEPALIVE_MESSAGE_TYPE = "sip-keepalive";
const SIP_KEEPALIVE_FALLBACK_MIN_INTERVAL_MS = 20_000;
const SIP_KEEPALIVE_FALLBACK_MAX_INTERVAL_MS = 25_000;
const SIP_REGISTER_EXPIRES_SECONDS = 600;
const MAX_RECORDED_SIGNALING_DROPS = 20;
const SIP_REGISTRATION_RECOVERY_DEBOUNCE_MS = 1_000;
const SIP_REGISTRATION_RECOVERY_TIMEOUT_MS = 10_000;
const OUTPUT_DEVICE_SELECTION_GRACE_MS = 12_000;
// Report unusually slow activation without terminating a dialog that may still
// have working RTP. JsSIP remains authoritative for terminal SIP/ICE failures.
const SESSION_ACTIVATION_TIMEOUT_MS = 30_000;
const MICROPHONE_ACQUISITION_TIMEOUT_MS = 20_000;
const SESSION_ACTIVATION_TIMEOUT_MESSAGE =
  "Call setup is taking longer than expected; the session remains open while connectivity is checked.";
const SESSION_CONNECTIVITY_FAILURE_MESSAGE =
  "The peer connection reported a media failure; waiting for SIP recovery or termination.";
const MICROPHONE_ACQUISITION_TIMEOUT_MESSAGE =
  "Microphone access timed out. Check the browser permission prompt and try again.";
const SDP_CANDIDATE_PRUNING_SESSION_KEY = "orbit.sip.sdpCandidatePruning";

type SipKeepaliveWorkerMessage = {
  type?: typeof SIP_KEEPALIVE_MESSAGE_TYPE;
  sentAt?: number;
};

type SipKeepaliveMessageEvent = MessageEvent<
  typeof SIP_KEEPALIVE_MESSAGE_TYPE | SipKeepaliveWorkerMessage
>;

const initialCallState: CurrentCallState = {
  id: null,
  state: CALL_STATES.IDLE,
  direction: null,
  remote: null,
  muted: false,
  onHold: false,
  duration: 0,
  startTime: null,
  iceState: null,
};

const STORAGE_KEYS = {
  registration: "orbit.sip.registrationEnabled",
  input: "orbit.sip.inputDeviceId",
  output: "orbit.sip.outputDeviceId",
  speaker: "orbit.sip.speakerEnabled",
  noiseSuppression: "orbit.sip.noiseSuppressionEnabled",
} as const;

const loadStoredBoolean = (key: string, fallback = false): boolean => {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = window.localStorage.getItem(key);
    if (stored === null) return fallback;
    return stored === "true";
  } catch {
    return fallback;
  }
};

const loadStoredValue = (key: string): string | null => {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(key);
    return stored && stored.trim() ? stored : null;
  } catch {
    return null;
  }
};

const persistValue = (key: string, value: string | null | undefined): void => {
  if (typeof window === "undefined") return;
  try {
    if (value === null || value === undefined || value === "") {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, String(value));
    }
  } catch {
    // ignore storage errors
  }
};

const isLocalSdpCandidatePruningEnabled = (): boolean => {
  if (typeof window === "undefined") return true;
  try {
    const value = window.sessionStorage.getItem(SDP_CANDIDATE_PRUNING_SESSION_KEY);
    if (value === "0" || value === "false" || value === "off") return false;
    if (value === "1" || value === "true" || value === "on") return true;
  } catch {
    // Session storage can be unavailable in private/restricted contexts.
  }
  return true;
};

const supportsSetSinkId = (): boolean => {
  if (typeof window === "undefined") return false;
  const audio = document.createElement("audio");
  return (
    typeof (audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }).setSinkId ===
    "function"
  );
};

const stopStream = (stream: MediaStream | null | undefined): void => {
  disposeNoiseSuppressionForStream(stream);
  stream?.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch {
      // ignore
    }
  });
};

const markSpeechTrack = (stream: MediaStream): void => {
  stream.getAudioTracks().forEach((track) => {
    const speechTrack = track as MediaStreamTrack & { contentHint?: string };
    if ("contentHint" in speechTrack) {
      try {
        speechTrack.contentHint = "speech";
      } catch {
        // Older browsers expose contentHint but reject writes.
      }
    }
  });
};

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [{ urls: ["stun:stun.l.google.com:19302"] }];
const SIP_SESSION_TIMER_EXPIRES_SECONDS = 1800;

// JsSIP's own default; kept explicit so the unanswered-incoming behaviour is
// visible in the UA configuration (incoming sessions are auto-rejected with
// 408 and cause NO_ANSWER after this window).
const NO_ANSWER_TIMEOUT_SECONDS = 60;

const sanitizeSipDisplayName = (value?: string | null): string | undefined => {
  if (!value) return undefined;
  // JsSIP always encloses display_name in double quotes; embedded quotes or
  // angle brackets would produce a malformed From header.
  const cleaned = value
    .replace(/["\\<>\r\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || undefined;
};

const readAudioInputDiagnostics = (
  track: MediaStreamTrack | undefined,
  selectedDeviceId: string | null,
  customNoiseSuppression: boolean
): Record<string, unknown> => {
  const settings = track?.getSettings?.() || {};
  const supported =
    typeof navigator !== "undefined" && navigator.mediaDevices?.getSupportedConstraints
      ? navigator.mediaDevices.getSupportedConstraints()
      : {};

  return {
    requested: {
      echoCancellation: true,
      noiseSuppression: !customNoiseSuppression,
      autoGainControl: true,
      channelCount: 1,
      selectedDevice: Boolean(selectedDeviceId),
    },
    supported: {
      echoCancellation: supported.echoCancellation ?? null,
      noiseSuppression: supported.noiseSuppression ?? null,
      autoGainControl: supported.autoGainControl ?? null,
      channelCount: supported.channelCount ?? null,
    },
    actual: {
      echoCancellation: settings.echoCancellation ?? null,
      noiseSuppression: settings.noiseSuppression ?? null,
      autoGainControl: settings.autoGainControl ?? null,
      channelCount: settings.channelCount ?? null,
      sampleRate: settings.sampleRate ?? null,
    },
  };
};

const getIceServerUrls = (server: RTCIceServer): string[] => {
  if (typeof server.urls === "string") return [server.urls];
  return Array.isArray(server.urls) ? server.urls : [];
};

const summarizeAudioOfferCodecs = (sdp: string): string[] => {
  const lines = sdp.split(/\r?\n/);
  const mediaIndex = lines.findIndex((line) => line.startsWith("m=audio"));
  if (mediaIndex === -1) return [];

  const mediaParts = lines[mediaIndex].trim().split(/\s+/);
  const payloads = mediaParts.slice(3);
  const codecByPayload = new Map<string, string>();
  for (const line of lines.slice(mediaIndex + 1)) {
    if (line.startsWith("m=")) break;
    const match = line.match(/^a=rtpmap:(\d+)\s+([^/\s]+)/i);
    if (match) codecByPayload.set(match[1], match[2].toUpperCase());
  }

  return payloads.flatMap((payload) => {
    const codec = codecByPayload.get(payload);
    return codec ? [codec] : [];
  });
};

const summarizeIceConfiguration = (
  configuredServers: RTCIceServer[] | undefined,
  policy: RTCIceTransportPolicy | undefined
) => {
  const servers = configuredServers?.length ? configuredServers : DEFAULT_ICE_SERVERS;
  const urls: string[] = [];
  for (const server of servers) {
    for (const url of getIceServerUrls(server)) {
      urls.push(url.toLowerCase());
    }
  }
  return {
    policy: policy || "all",
    serverCount: servers.length,
    hasStun: urls.some((url) => url.startsWith("stun:")),
    hasTurn: urls.some((url) => url.startsWith("turn:") || url.startsWith("turns:")),
    hasTurnCredentials: servers.some((server) =>
      getIceServerUrls(server).some(
        (url) =>
          (url.toLowerCase().startsWith("turn:") || url.toLowerCase().startsWith("turns:")) &&
          Boolean(server.username && server.credential)
      )
    ),
    usingDefaultStun: !configuredServers?.length,
  };
};

const requestAudioOutputPermission = async (deviceId: string): Promise<string | null> => {
  if (typeof navigator === "undefined" || !navigator.mediaDevices) return null;
  if (typeof window !== "undefined" && !window.isSecureContext) return null;

  const mediaDevices = navigator.mediaDevices as MediaDevices & {
    selectAudioOutput?: (options?: { deviceId?: string }) => Promise<{ deviceId: string }>;
  };
  if (typeof mediaDevices.selectAudioOutput !== "function") return null;

  try {
    const selected = await mediaDevices.selectAudioOutput({ deviceId });
    return selected?.deviceId || null;
  } catch (error) {
    console.warn("[SIP] speaker output permission was not granted", error);
    return null;
  }
};

const extractDomain = (uri: string = ""): string | null => {
  if (!uri) return null;
  const normalized = uri.replace(/^sip:/i, "");
  const parts = normalized.split("@");
  return parts.length === 2 ? parts[1] : null;
};

const ensureSipUri = (target: string, fallbackDomain: string | null): string | null => {
  if (!target) return null;
  if (/^sip:/i.test(target)) return target;
  if (target.includes("@")) return `sip:${target}`;
  if (!fallbackDomain) return null;
  return `sip:${target}@${fallbackDomain}`;
};

// JsSIP identity-like object (display_name, uri with user/toString)
interface JsSIPIdentityLike {
  display_name?: string;
  uri?: { user?: string; toString?: () => string } | string;
}

const formatIdentity = (
  identity: JsSIPIdentityLike | null | undefined
): SipRemoteIdentity | null => {
  if (!identity) return null;
  const displayName =
    (identity as { display_name?: string }).display_name ||
    (identity.uri && typeof identity.uri === "object" && "user" in identity.uri
      ? (identity.uri as { user?: string }).user
      : null) ||
    null;
  const uri =
    (identity.uri &&
    typeof identity.uri === "object" &&
    typeof (identity.uri as { toString?: () => string }).toString === "function"
      ? (identity.uri as { toString: () => string }).toString()
      : identity.uri) ?? null;
  return { displayName: displayName ?? null, uri: uri != null ? String(uri) : null };
};

const formatCause = (cause: unknown): string | null => {
  if (!cause) return null;
  if (typeof cause === "string") return cause;
  const c = cause as { cause?: string; reason_phrase?: string; message?: string };
  if (c.cause && typeof c.cause === "string") return c.cause;
  if (c.reason_phrase) return c.reason_phrase;
  if (c.message) return c.message;
  try {
    return JSON.stringify(cause);
  } catch {
    return String(cause);
  }
};

type SipResponseDetails = {
  status_code?: number;
  reason_phrase?: string;
};

type SipFailureEvent = {
  cause?: unknown;
  response?: SipResponseDetails;
  message?: SipResponseDetails;
};

type SipReinviteEvent = {
  request?: {
    body?: string | null;
    cseq?: number | string;
    session_expires?: number;
    session_expires_refresher?: string;
    from?: { uri?: string };
  };
};

const getSipResponseDetails = (eventData: unknown): SipResponseDetails | null => {
  if (!eventData || typeof eventData !== "object") return null;
  const event = eventData as SipFailureEvent;
  return event.response || event.message || null;
};

const formatSipFailure = (eventData: unknown, fallback: string): string => {
  const event = eventData as SipFailureEvent | null;
  const cause = formatCause(event?.cause);
  const response = getSipResponseDetails(eventData);
  const status = response?.status_code;
  const reason = response?.reason_phrase?.trim();

  if (typeof status === "number") {
    return `${cause || fallback} (${status}${reason ? ` ${reason}` : ""})`;
  }
  return cause || fallback;
};

const formatNoAnswerFailure = (
  eventData: unknown,
  isIncoming: boolean,
  fallback: string
): string => {
  const cause = formatCause((eventData as SipFailureEvent | null)?.cause);
  if (cause === JsSIP.C.causes.NO_ANSWER) {
    return isIncoming
      ? "The incoming call was not answered in time."
      : "The call was not answered.";
  }
  return formatSipFailure(eventData, fallback);
};

// MediaStream renegotiation (e.g. the PBX's session-timer re-INVITEs) delivers
// a new MediaStream object wrapping the same tracks. Re-attaching those to the
// audio elements tears down the previous, still-loading element and makes the
// browser print "The fetching process for the media resource was aborted..."
// even though the new element plays fine. Compare track identity instead so
// identical renegotiations are skipped.
const sameTrackSet = (
  a: MediaStream | null | undefined,
  b: MediaStream | null | undefined
): boolean => {
  if (!a || !b) return false;
  if (a === b) return true;
  const aTracks = a.getTracks();
  const bTracks = b.getTracks();
  if (aTracks.length !== bTracks.length) return false;
  const bIds = new Set(bTracks.map((track) => track.id));
  return aTracks.every((track) => bIds.has(track.id));
};

// Self-documenting drop logs: every terminal session event prints the
// classified cause so failures like early remote hang-ups, NO_ACK or
// session-timer errors are diagnosable from the console alone.
const logSessionTermination = (
  label: string,
  sessionId: string,
  eventData: unknown,
  termination: SipSessionEndClassification,
  transportDropMsBefore: number | null = null,
  recentTransportDrop: { downtimeMs: number; endedMsAgo: number } | null = null
): void => {
  const event = eventData as SipFailureEvent | null;
  const response = getSipResponseDetails(eventData);
  const details = {
    sessionId,
    cause: formatCause(event?.cause) ?? null,
    statusCode: response?.status_code ?? null,
    reasonPhrase: response?.reason_phrase?.trim() || null,
    failureKind: termination.failureKind,
    message: termination.message,
    transportDropMsBefore,
    recentTransportDrop,
  };
  if (termination.failed) {
    console.warn(`[SIP] ${label} (failed)`, details);
  } else {
    console.info(`[SIP] ${label}`, details);
  }
};

const TRANSIENT_TRANSPORT_CAUSES = new Set<string>([
  JsSIP.C.causes.CONNECTION_ERROR,
  JsSIP.C.causes.REQUEST_TIMEOUT,
]);

const isTransientSipConnectionError = (cause: string | null, message: string | null): boolean => {
  if (cause && TRANSIENT_TRANSPORT_CAUSES.has(cause)) return true;
  if (!message) return false;
  const normalized = message.toLowerCase();
  return (
    normalized.includes("websocket") ||
    normalized.includes("transport") ||
    normalized.includes("network error") ||
    normalized.includes("request timeout")
  );
};

const safeStructuredClone = <T>(value: T): T | null => {
  try {
    if (typeof structuredClone !== "function") {
      console.warn("[SIP] structuredClone is unavailable for diagnostics payload");
      return null;
    }
    return structuredClone(value);
  } catch (error) {
    console.warn("[SIP] Failed to clone diagnostics payload", error);
    return null;
  }
};

type CandidateFields =
  "protocol" | "priority" | "candidateType" | "relayProtocol" | "networkType" | "foundation";

const sanitizeCandidate = (
  candidate: Record<string, unknown> | null | undefined
): Record<string, unknown> | null => {
  if (!candidate || typeof candidate !== "object") {
    return null;
  }
  const result: Record<string, unknown> = {};
  const fields: CandidateFields[] = [
    "protocol",
    "priority",
    "candidateType",
    "relayProtocol",
    "networkType",
    "foundation",
  ];
  fields.forEach((field) => {
    if (candidate[field] !== undefined && candidate[field] !== null) {
      result[field] = candidate[field];
    }
  });
  return Object.keys(result).length ? result : null;
};

// Minimal type for RTCPeerConnection.getStats() report entries
interface RTCStatsReportEntry {
  type?: string;
  id?: string;
  selected?: boolean;
  nominated?: boolean;
  state?: string;
  selectedCandidatePairId?: string;
  localCandidateId?: string;
  remoteCandidateId?: string;
  kind?: string;
  isRemote?: boolean;
  codecId?: string;
  mimeType?: string;
  jitter?: number;
  packetsLost?: number;
  fractionLost?: number;
  packetsReceived?: number;
  bytesReceived?: number;
  jitterBufferDelay?: number;
  audioLevel?: number;
  packetsSent?: number;
  bytesSent?: number;
  retransmittedPacketsSent?: number;
  targetBitrate?: number;
  roundTripTime?: number;
  priority?: number;
  requestsSent?: number;
  responsesReceived?: number;
  availableOutgoingBitrate?: number;
  currentRoundTripTime?: number;
  jitterBufferEmittedCount?: number;
  totalSamplesReceived?: number;
  concealedSamples?: number;
  concealmentEvents?: number;
}

interface PeerConnectionDiagnostics {
  iceConnectionState: string | null;
  inboundAudio?: Record<string, unknown>;
  outboundAudio?: Record<string, unknown>;
  remoteInbound?: Record<string, unknown>;
  codecs?: { inbound?: string | null; outbound?: string | null };
  candidatePair?: Record<string, unknown>;
  adaptive?: AdaptiveAudioQualityMetrics;
  statsError?: string;
}

const readDiagnosticNumber = (
  record: Record<string, unknown> | undefined,
  key: string
): number | null => {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const collectPeerConnectionDiagnostics = async (
  connection: RTCPeerConnection | null | undefined
): Promise<PeerConnectionDiagnostics> => {
  if (!connection) {
    return { iceConnectionState: null };
  }

  const diagnostics: PeerConnectionDiagnostics = {
    iceConnectionState: connection.iceConnectionState || null,
  };

  if (typeof connection.getStats !== "function") {
    return diagnostics;
  }

  try {
    const stats = await connection.getStats();
    const codecs: { inbound?: string | null; outbound?: string | null } = {};
    const reports: RTCStatsReportEntry[] = [];

    stats.forEach((report: RTCStatsReportEntry) => {
      reports.push(report);
    });
    const selectedPairReport = selectCandidatePairReport(reports);

    let selectedPair: Record<string, unknown> | null = null;
    let localCandidate: Record<string, unknown> | null = null;
    let remoteCandidate: Record<string, unknown> | null = null;

    stats.forEach((report: RTCStatsReportEntry) => {
      if (report.type === "candidate-pair") {
        if (report === selectedPairReport) {
          selectedPair = {
            state: report.state,
            priority: report.priority,
            requestsSent: report.requestsSent,
            responsesReceived: report.responsesReceived,
            availableOutgoingBitrate: report.availableOutgoingBitrate,
            currentRoundTripTime: report.currentRoundTripTime,
          };
          if (report.localCandidateId && typeof (stats as RTCStatsReport).get === "function") {
            const localCandidateReport = (stats as RTCStatsReport).get(report.localCandidateId);
            if (localCandidateReport) {
              localCandidate = sanitizeCandidate(
                localCandidateReport as unknown as Record<string, unknown>
              );
            }
          }
          if (report.remoteCandidateId && typeof (stats as RTCStatsReport).get === "function") {
            const remoteCandidateReport = (stats as RTCStatsReport).get(report.remoteCandidateId);
            if (remoteCandidateReport) {
              remoteCandidate = sanitizeCandidate(
                remoteCandidateReport as unknown as Record<string, unknown>
              );
            }
          }
        }
      } else if (report.type === "inbound-rtp" && report.kind === "audio" && !report.isRemote) {
        diagnostics.inboundAudio = {
          jitter: report.jitter,
          packetsLost: report.packetsLost,
          packetsReceived: report.packetsReceived,
          bytesReceived: report.bytesReceived,
          jitterBufferDelay: report.jitterBufferDelay,
          audioLevel: report.audioLevel,
          jitterBufferEmittedCount: report.jitterBufferEmittedCount,
          totalSamplesReceived: report.totalSamplesReceived,
          concealedSamples: report.concealedSamples,
          concealmentEvents: report.concealmentEvents,
        };
        if (report.codecId && typeof (stats as RTCStatsReport).get === "function") {
          const codecReport = (stats as RTCStatsReport).get(report.codecId) as
            RTCStatsReportEntry | undefined;
          codecs.inbound = codecReport?.mimeType || null;
        }
      } else if (report.type === "outbound-rtp" && report.kind === "audio") {
        diagnostics.outboundAudio = {
          packetsSent: report.packetsSent,
          bytesSent: report.bytesSent,
          retransmittedPacketsSent: report.retransmittedPacketsSent,
          targetBitrate: report.targetBitrate,
        };
        if (report.codecId && typeof (stats as RTCStatsReport).get === "function") {
          const codecReport = (stats as RTCStatsReport).get(report.codecId) as
            RTCStatsReportEntry | undefined;
          codecs.outbound = codecReport?.mimeType || null;
        }
      } else if (report.type === "remote-inbound-rtp" && report.kind === "audio") {
        diagnostics.remoteInbound = {
          jitter: report.jitter,
          packetsLost: report.packetsLost,
          packetsReceived: report.packetsReceived,
          fractionLost: report.fractionLost,
          roundTripTime: report.roundTripTime,
        };
      }
    });

    if (Object.keys(codecs).length) {
      diagnostics.codecs = codecs;
    }

    if (selectedPair) {
      diagnostics.candidatePair = {
        ...(selectedPair as object),
        local: localCandidate,
        remote: remoteCandidate,
      };
    }

    return diagnostics;
  } catch (error) {
    return {
      iceConnectionState: connection.iceConnectionState || null,
      statsError: error instanceof Error ? error.message : String(error),
    };
  }
};

const normalizeDirection = (value: string | undefined): "in" | "out" | null => {
  if (value === "incoming" || value === "in") return "in";
  if (value === "outgoing" || value === "out") return "out";
  return null;
};

// JsSIP UA and session types (minimal for refs - JsSIP may not ship types)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsSIPUA = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsSIPSession = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EmitterHandler = (...args: any[]) => void;
type CleanupFn = () => void;

const bindEmitterEvent = (target: unknown, event: string, handler: EmitterHandler): CleanupFn => {
  const emitter = target as {
    on?: (event: string, handler: EmitterHandler) => unknown;
    off?: (event: string, handler: EmitterHandler) => unknown;
    removeListener?: (event: string, handler: EmitterHandler) => unknown;
  };
  emitter.on?.(event, handler);
  return () => {
    if (typeof emitter.off === "function") {
      emitter.off(event, handler);
      return;
    }
    emitter.removeListener?.(event, handler);
  };
};

const bindTargetEvent = (
  target: EventTarget,
  event: string,
  handler: EventListener,
  options?: boolean | AddEventListenerOptions
): CleanupFn => {
  target.addEventListener(event, handler, options);
  return () => target.removeEventListener(event, handler, options);
};

const runCleanups = (cleanups: CleanupFn[]) => {
  while (cleanups.length) {
    const cleanup = cleanups.pop();
    try {
      cleanup?.();
    } catch {
      /* noop */
    }
  }
};

export default function useSIPClient(
  config: SipClientConfig = {},
  options: UseSIPClientOptions = {}
): UseSIPClientReturn {
  const {
    wsUri,
    uri,
    password,
    authorizationUser,
    displayName,
    registrarServer,
    iceServers,
    iceTransportPolicy,
  } = config;
  const {
    onCallSummary,
    onRegistrationFailed,
    wrapUpDurationSeconds: wrapUpDurationSecondsOption,
    wrapUpMaxExtensions: wrapUpMaxExtensionsOption,
    wrapUpRejectIncoming: wrapUpRejectIncomingOption,
    sessionTimersRefreshMethod: sessionTimersRefreshMethodOption,
    sessionTimersForceRefresher: sessionTimersForceRefresherOption,
    noiseSuppressionEnabled: noiseSuppressionEnabledOption,
    noiseSuppressionAssetBaseUrl,
    dialTargetFormat: dialTargetFormatOption,
    defaultCallingCountry: defaultCallingCountryOption,
    formatDialTarget: formatDialTargetOption,
  } = options;
  // Frozen at first mount, matching the original module-level-constant
  // semantics (these feed UA/session config built once per registration
  // cycle, not meant to change reactively mid-session on a prop update).
  const WRAP_UP_DURATION_SECONDS = useRef(
    wrapUpDurationSecondsOption ?? DEFAULT_WRAP_UP_DURATION_SECONDS
  ).current;
  const WRAP_UP_MAX_EXTENSIONS = useRef(
    wrapUpMaxExtensionsOption ?? DEFAULT_WRAP_UP_MAX_EXTENSIONS
  ).current;
  const WRAP_UP_REJECT_INCOMING = useRef(
    wrapUpRejectIncomingOption ?? DEFAULT_WRAP_UP_REJECT_INCOMING
  ).current;
  const SESSION_TIMERS_REFRESH_METHOD = useRef(
    sessionTimersRefreshMethodOption ?? DEFAULT_SESSION_TIMERS_REFRESH_METHOD
  ).current;
  const SESSION_TIMERS_FORCE_REFRESHER = useRef(sessionTimersForceRefresherOption ?? false).current;
  const CUSTOM_NOISE_SUPPRESSION_ALLOWED = useRef(noiseSuppressionEnabledOption ?? true).current;
  // preloadNoiseSuppression's own module-level cache only honors the first
  // call's base URL per page load anyway (see its docstring) - freezing here
  // just keeps this option consistent with its siblings above.
  const NOISE_SUPPRESSION_ASSET_BASE_URL = useRef(noiseSuppressionAssetBaseUrl).current;
  const DIAL_TARGET_FORMATTER = useRef(
    formatDialTargetOption ||
      createDialTargetFormatter(dialTargetFormatOption ?? "preserve", defaultCallingCountryOption)
  ).current;
  const uaRef = useRef<JsSIPUA | null>(null);
  const iceServersRef = useRef(iceServers);
  const iceTransportPolicyRef = useRef(iceTransportPolicy);
  iceServersRef.current = iceServers;
  iceTransportPolicyRef.current = iceTransportPolicy;
  const registrationDesiredRef = useRef(false);
  const sessionRef = useRef<JsSIPSession | null>(null);
  const locallyTerminatedSessionRef = useRef<JsSIPSession | null>(null);
  // Sessions whose "ended" event must NOT play the drop tone — currently only a
  // call-switch (ending the active call to answer a second incoming), where the
  // agent immediately continues on the other call.
  const suppressEndToneSessionRef = useRef<JsSIPSession | null>(null);
  const pendingIncomingSessionRef = useRef<JsSIPSession | null>(null);
  // Answering waits for microphone acquisition. Lock the SIP dialog so rapid
  // clicks or multiple visible controls cannot answer the same INVITE twice.
  const answeringSessionRef = useRef<JsSIPSession | null>(null);
  const promotedSessionCleanupRef = useRef<CleanupFn | null>(null);
  const sessionActivationGateRef = useRef(new WeakMap<object, SessionActivationGate>());
  const rtpFlowEvidenceRef = useRef(new WeakMap<object, AudioRtpFlowEvidence>());
  const callQualityOptimizerRef = useRef(
    new WeakMap<object, ReturnType<typeof createCallQualityOptimizer>>()
  );
  const setupFailureReasonRef = useRef(new WeakMap<object, string>());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hangupFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const toneContextRef = useRef<AudioContext | null>(null);
  const ringbackToneRef = useRef<ToneStateRef | null>(null);
  const inboundRingToneRef = useRef<ToneStateRef | null>(null);
  const holdToneRef = useRef<ToneStateRef | null>(null);
  const endingToneRef = useRef<ToneStateRef | null>(null);
  const previewToneRef = useRef<ToneStateRef | null>(null);
  const callMetaRef = useRef<Record<string, unknown> | null>(null);
  const diagnosticsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sipSocketRef = useRef<SipKeepaliveSocket | null>(null);
  const lastRegistrationRecoveryAtRef = useRef(0);
  const registrationRecoveryRef = useRef(false);
  const registrationRecoveryTimerRef = useRef<number | null>(null);
  const selfTestRef = useRef<{
    stream: MediaStream | null;
    previousStream: MediaStream | null;
    timeout: number | null;
    running: boolean;
  }>({
    stream: null,
    previousStream: null,
    timeout: null,
    running: false,
  });
  const lastErrorRef = useRef<string | null>(null);
  const onCallSummaryRef = useRef(onCallSummary);
  const onRegistrationFailedRef = useRef(onRegistrationFailed);
  const uaRebuildDeferredRef = useRef(false);
  const localHoldFallbackRef = useRef(false);
  const unmountMediaCleanupRef = useRef<CleanupFn>(() => undefined);
  // jssip 3.x does not expose `session.request`; capture the call-id from the
  // newRTCSession event payload instead (session.id = call_id + from_tag).
  const sessionCallIdsRef = useRef(new WeakMap<JsSIPSession, string | null>());
  const transportDropStartedAtRef = useRef<number | null>(null);
  const answerRequestedAtPerfRef = useRef<number | null>(null);
  const dialRequestedAtPerfRef = useRef<number | null>(null);
  const confirmedAtPerfRef = useRef<number | null>(null);
  const recentTransportDropRef = useRef<{
    droppedAt: number;
    recoveredAt: number;
    downtimeMs: number;
  } | null>(null);

  const getTransportDropMsBefore = (): number | null => {
    const startedAt = transportDropStartedAtRef.current;
    if (startedAt === null) return null;
    const elapsed = Date.now() - startedAt;
    return elapsed <= 60_000 ? elapsed : null;
  };
  // A drop that already recovered is invisible to getTransportDropMsBefore;
  // keep the last one so mid-call failures (e.g. No ACK after a lost PBX
  // ACK) can be correlated with a transport blip that happened moments ago.
  const getRecentTransportDropBefore = (): {
    downtimeMs: number;
    endedMsAgo: number;
  } | null => {
    const drop = recentTransportDropRef.current;
    if (!drop) return null;
    const endedMsAgo = Date.now() - drop.recoveredAt;
    if (endedMsAgo > 120_000) return null;
    return { downtimeMs: drop.downtimeMs, endedMsAgo };
  };
  const speakerNeedsResumeRef = useRef(false);
  const firstConnectionRef = useRef(true);
  const currentCallStateRef = useRef<CurrentCallState["state"]>(initialCallState.state);
  const currentCallRef = useRef<CurrentCallState>(initialCallState);
  const outputDeviceSelectionInProgressRef = useRef(false);
  const outputDeviceSelectionGraceUntilRef = useRef(0);
  const localInputStreamRef = useRef<MediaStream | null>(null);
  const inputOperationGenerationRef = useRef(0);
  const inputTrackReplacementQueueRef = useRef<Promise<void>>(Promise.resolve());
  const selectedInputDeviceIdRef = useRef<string | null>(null);
  const selectedOutputDeviceIdRef = useRef<string | null>(null);
  const defaultInputDeviceIdRef = useRef<string | null>(null);
  const audioInputDiagnosticsRef = useRef<Record<string, unknown> | null>(null);

  const [isRegistered, setIsRegistered] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [signalingConnected, setSignalingConnected] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [registrationEnabled, setRegistrationEnabledState] = useState(() =>
    Boolean(wsUri && uri && password)
  );
  const [currentCall, setCurrentCall] = useState<CurrentCallState>(initialCallState);
  // Setter removed along with the disabled call-waiting paths; the state is
  // kept (always idle) because consumers still read pendingIncomingCall.
  const [pendingIncomingCall] = useState<CurrentCallState>(initialCallState);
  const [lastError, setLastError] = useState<string | null>(null);
  const [uaGeneration, setUaGeneration] = useState(0);

  const [availableDevices, setAvailableDevices] = useState<AvailableDevices>({
    inputs: [],
    outputs: [],
  });
  const [selectedInputDeviceId, setSelectedInputDeviceId] = useState<string | null>(() =>
    loadStoredValue(STORAGE_KEYS.input)
  );
  const [selectedOutputDeviceId, setSelectedOutputDeviceId] = useState<string | null>(() =>
    loadStoredValue(STORAGE_KEYS.output)
  );
  const [speakerEnabled, setSpeakerEnabled] = useState(() =>
    loadStoredBoolean(STORAGE_KEYS.speaker, true)
  );
  const [soundPreferences, setSoundPreferencesState] = useState<WebphoneSoundPreferences>(() =>
    readWebphoneSoundPreferences()
  );
  const soundPreferencesRef = useRef(soundPreferences);
  const speakerEnabledRef = useRef(speakerEnabled);
  useEffect(() => {
    speakerEnabledRef.current = speakerEnabled;
  }, [speakerEnabled]);
  useEffect(() => {
    soundPreferencesRef.current = soundPreferences;
  }, [soundPreferences]);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [diagnosticsState, setDiagnosticsState] = useState<DiagnosticsState>({
    live: null,
    last: null,
  });
  const [selfTestState, setSelfTestState] = useState<SelfTestState>({
    running: false,
    lastStartedAt: null,
    lastCompletedAt: null,
    lastResult: null,
    lastError: null,
  });

  const latestRegistrationEnabledRef = useRef(registrationEnabled);
  const registrationCredentialsReadyRef = useRef(Boolean(wsUri && uri && password));
  const downstreamDomain = useMemo(
    () => extractDomain(uri) || extractDomain(registrarServer),
    [uri, registrarServer]
  );

  const sinkIdSupported = useMemo(() => supportsSetSinkId(), []);

  const updateLastError = useCallback((value: string | null | undefined) => {
    // Suppress transient errors during initial connection warmup
    if (firstConnectionRef.current && value) return;
    const normalized = value || null;
    lastErrorRef.current = normalized;
    setLastError(normalized);
  }, []);

  const commitSelectedInputDeviceId = useCallback((deviceId: string | null) => {
    selectedInputDeviceIdRef.current = deviceId;
    setSelectedInputDeviceId(deviceId);
  }, []);

  const commitSelectedOutputDeviceId = useCallback((deviceId: string | null) => {
    selectedOutputDeviceIdRef.current = deviceId;
    setSelectedOutputDeviceId(deviceId);
  }, []);

  const releaseLocalInputStream = useCallback((nextStream?: MediaStream | null) => {
    const currentStream = localInputStreamRef.current;
    if (currentStream && currentStream !== nextStream) {
      stopStream(currentStream);
    }
    localInputStreamRef.current = nextStream ?? null;
  }, []);

  const acquireInputStream = useCallback(
    async (deviceId: string | null): Promise<AcquiredInputStream> => {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        throw new Error("Microphone access is unavailable in this browser.");
      }

      const requestedCustomNoiseSuppression =
        noiseSuppressionEnabledRef.current &&
        CUSTOM_NOISE_SUPPRESSION_ALLOWED &&
        (await preloadNoiseSuppression(NOISE_SUPPRESSION_ASSET_BASE_URL)).ok;
      const getStream = (targetDeviceId: string | null, useCustomSuppression: boolean) =>
        navigator.mediaDevices.getUserMedia({
          audio: buildSpeechAudioConstraints(targetDeviceId, useCustomSuppression),
          video: false,
        });

      const captureStream = async (
        targetDeviceId: string | null
      ): Promise<{ stream: MediaStream; useCustomSuppression: boolean }> => {
        let useCustomSuppression = requestedCustomNoiseSuppression;
        let stream: MediaStream;
        try {
          stream = await getStream(targetDeviceId, useCustomSuppression);
        } catch (error) {
          const name = (error as { name?: string } | null)?.name;
          if (!useCustomSuppression || name !== "OverconstrainedError") throw error;
          // Some browsers cannot guarantee native suppression is disabled.
          // Capture with browser DSP instead of failing the call or layering
          // RNNoise over an unknown native pipeline.
          stream = await getStream(targetDeviceId, false);
          useCustomSuppression = false;
        }

        const nativeSetting = stream.getAudioTracks()[0]?.getSettings?.().noiseSuppression;
        useCustomSuppression = shouldApplyCustomNoiseSuppression(
          useCustomSuppression,
          nativeSetting
        );
        return { stream, useCustomSuppression };
      };

      const applyCustomNoiseSuppression = async (
        stream: MediaStream,
        useCustomSuppression: boolean
      ): Promise<MediaStream> => {
        if (!useCustomSuppression) {
          markSpeechTrack(stream);
          return stream;
        }
        const applied = await applyNoiseSuppressionToStream(stream);
        markSpeechTrack(stream);
        if (!applied) {
          console.warn("[SIP] Noise suppression unavailable, falling back to built-in");
          const rawTrack = stream.getAudioTracks()[0];
          try {
            await rawTrack?.applyConstraints({ noiseSuppression: true });
          } catch {
            /* noop */
          }
        }
        return stream;
      };

      try {
        const { stream, useCustomSuppression } = await captureStream(deviceId);
        audioInputDiagnosticsRef.current = readAudioInputDiagnostics(
          stream.getAudioTracks()[0],
          deviceId,
          useCustomSuppression
        );
        console.info("[SIP] Audio input processing", audioInputDiagnosticsRef.current);
        setDeviceError(null);
        await applyCustomNoiseSuppression(stream, useCustomSuppression);
        return { stream, resolvedDeviceId: deviceId, fellBackToDefault: false };
      } catch (err: unknown) {
        const name = (err as { name?: string } | null)?.name;

        if (deviceId && (name === "NotFoundError" || name === "OverconstrainedError")) {
          const { stream: fallbackStream, useCustomSuppression } = await captureStream(null);
          audioInputDiagnosticsRef.current = readAudioInputDiagnostics(
            fallbackStream.getAudioTracks()[0],
            null,
            useCustomSuppression
          );
          console.info("[SIP] Audio input processing", audioInputDiagnosticsRef.current);
          setDeviceError("Selected microphone unavailable. Using the default microphone.");
          await applyCustomNoiseSuppression(fallbackStream, useCustomSuppression);
          return {
            stream: fallbackStream,
            resolvedDeviceId: null,
            fellBackToDefault: true,
          };
        }

        if (!deviceId && (name === "OverconstrainedError" || name === "NotReadableError")) {
          // This last-resort request intentionally uses the browser defaults.
          // Do not layer RNNoise on top because native suppression may already
          // be active and double suppression distorts speech.
          const fallbackStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: false,
          });
          audioInputDiagnosticsRef.current = readAudioInputDiagnostics(
            fallbackStream.getAudioTracks()[0],
            null,
            false
          );
          console.info("[SIP] Audio input processing fallback", audioInputDiagnosticsRef.current);
          setDeviceError(null);
          await applyCustomNoiseSuppression(fallbackStream, false);
          return { stream: fallbackStream, resolvedDeviceId: null, fellBackToDefault: false };
        }

        throw err;
      }
    },
    [CUSTOM_NOISE_SUPPRESSION_ALLOWED, NOISE_SUPPRESSION_ASSET_BASE_URL]
  );

  const replaceSessionInputTrack = useCallback(
    (stream: MediaStream): Promise<boolean> => {
      const targetSession = sessionRef.current;
      const replace = async (): Promise<boolean> => {
        const session = targetSession;
        const audioTrack = stream.getAudioTracks()[0];

        if (!session || sessionRef.current !== session || session.isEnded?.() || !audioTrack) {
          return false;
        }

        if (currentCallRef.current.muted || currentCallRef.current.onHold) {
          audioTrack.enabled = false;
        }

        const sender = session.connection
          ?.getSenders?.()
          ?.find((candidate: RTCRtpSender) => candidate.track && candidate.track.kind === "audio");

        if (!sender) {
          return false;
        }

        try {
          await sender.replaceTrack(audioTrack);
        } catch (error) {
          console.warn("[SIP] Failed to replace the outgoing audio track", error);
          return false;
        }
        // The call may have ended or the provider may have unmounted while the
        // browser was switching tracks. Never reattach a candidate stream
        // after teardown.
        if (sessionRef.current !== session || session.isEnded?.()) {
          return false;
        }
        releaseLocalInputStream(stream);
        return true;
      };

      const queued = inputTrackReplacementQueueRef.current.then(replace, replace);
      inputTrackReplacementQueueRef.current = queued.then(
        () => undefined,
        () => undefined
      );
      return queued;
    },
    [releaseLocalInputStream]
  );

  const ensureToneContext = useCallback((): AudioContext | null => {
    if (typeof window === "undefined") return null;
    const AudioContextCtor =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return null;
    if (!toneContextRef.current) {
      try {
        toneContextRef.current = new AudioContextCtor();
      } catch (error) {
        console.warn("[SIP] Unable to create audio context for call tones", error);
        return null;
      }
    }
    return toneContextRef.current;
  }, []);

  const stopTone = useCallback((stateRef: MutableRefObject<ToneStateRef | null>) => {
    const state = stateRef.current;
    if (!state) return;
    state.active = false;
    if (state.stopTimeout) {
      clearTimeout(state.stopTimeout);
    }
    if (state.nextTimeout) {
      clearTimeout(state.nextTimeout);
    }
    state.oscillators.forEach((oscillator) => {
      try {
        oscillator.stop();
      } catch {
        /* noop */
      }
      try {
        oscillator.disconnect();
      } catch {
        /* noop */
      }
    });
    if (state.gain) {
      try {
        state.gain.disconnect();
      } catch {
        /* noop */
      }
    }
    stateRef.current = null;
  }, []);

  const clearCurrentOscillator = useCallback((state: ToneStateRef) => {
    state.oscillators.forEach((oscillator) => {
      try {
        oscillator.stop();
      } catch {
        /* noop */
      }
      try {
        oscillator.disconnect();
      } catch {
        /* noop */
      }
    });
    state.oscillators = [];
    if (state.gain) {
      try {
        state.gain.disconnect();
      } catch {
        /* noop */
      }
      state.gain = null;
    }
  }, []);

  const startTonePattern = useCallback(
    (
      stateRef: MutableRefObject<ToneStateRef | null>,
      pattern: SoundPattern,
      { loop = true }: { loop?: boolean } = {}
    ) => {
      if (stateRef.current?.active || !pattern.steps.length) return;
      const state: ToneStateRef = {
        active: true,
        oscillators: [],
        gain: null,
        stopTimeout: null,
        nextTimeout: null,
      };
      stateRef.current = state;

      const runStep = async (stepIndex: number) => {
        if (!state.active) return;
        const context = ensureToneContext();
        if (!context) {
          stopTone(stateRef);
          return;
        }
        if (context.state === "suspended") {
          try {
            await context.resume();
          } catch (error) {
            console.warn("[SIP] Failed to resume audio context for call tone", error);
            if (state.active) {
              state.nextTimeout = window.setTimeout(() => {
                state.stopTimeout = null;
                state.nextTimeout = null;
                void runStep(stepIndex);
              }, 600);
            }
            return;
          }
        }
        if (!state.active) return;

        const step = pattern.steps[stepIndex];
        try {
          const frequencies = step.frequencies?.length ? step.frequencies : [step.frequency ?? 440];
          const gain = context.createGain();
          const oscillators = frequencies.map((frequency) => {
            const oscillator = context.createOscillator();
            oscillator.type = step.type || "sine";
            oscillator.frequency.value = frequency;
            oscillator.connect(gain);
            oscillator.start();
            return oscillator;
          });
          gain.gain.setValueAtTime(step.volume ?? pattern.volume ?? 0.12, context.currentTime);
          gain.connect(context.destination);
          state.oscillators = oscillators;
          state.gain = gain;

          state.stopTimeout = window.setTimeout(
            () => {
              if (!state.active) return;
              clearCurrentOscillator(state);

              const nextStepIndex = stepIndex + 1;
              const hasNextStep = nextStepIndex < pattern.steps.length;
              const delay = hasNextStep ? step.gapMs || 0 : pattern.cycleGapMs || step.gapMs || 0;

              if (hasNextStep || loop) {
                state.nextTimeout = window.setTimeout(() => {
                  state.stopTimeout = null;
                  state.nextTimeout = null;
                  void runStep(hasNextStep ? nextStepIndex : 0);
                }, delay);
                return;
              }

              state.active = false;
              stateRef.current = null;
            },
            Math.max(20, step.durationMs)
          );
        } catch (error) {
          console.warn("[SIP] Failed to play tone", error);
          stopTone(stateRef);
        }
      };

      void runStep(0);
    },
    [clearCurrentOscillator, ensureToneContext, stopTone]
  );

  const startRingbackTone = useCallback(
    () => startTonePattern(ringbackToneRef, RINGBACK_TONE_PATTERN),
    [startTonePattern]
  );

  const stopRingbackTone = useCallback(() => stopTone(ringbackToneRef), [stopTone]);

  const startInboundRingTone = useCallback(
    () =>
      startTonePattern(
        inboundRingToneRef,
        getIncomingRingtonePreset(soundPreferencesRef.current.incomingRingtoneId).pattern
      ),
    [startTonePattern]
  );

  const stopInboundRingTone = useCallback(() => stopTone(inboundRingToneRef), [stopTone]);

  const shouldPlayInboundRing = useCallback(() => {
    const primaryIncoming = currentCall.state === CALL_STATES.INCOMING;
    const pendingIncoming = pendingIncomingCall.state === CALL_STATES.INCOMING;
    return primaryIncoming || pendingIncoming;
  }, [currentCall.state, pendingIncomingCall.state]);

  const resumeCallTones = useCallback(async () => {
    const context = ensureToneContext();
    if (!context) return;
    if (context.state === "suspended") {
      try {
        await context.resume();
      } catch (error) {
        console.warn("[SIP] resumeCallTones: audio context still suspended", error);
      }
    }
    if (shouldPlayInboundRing() && !inboundRingToneRef.current?.active) {
      startInboundRingTone();
    }
  }, [ensureToneContext, shouldPlayInboundRing, startInboundRingTone]);

  const startHoldTone = useCallback(
    () => startTonePattern(holdToneRef, HOLD_TONE_PATTERN),
    [startTonePattern]
  );

  const stopHoldTone = useCallback(() => stopTone(holdToneRef), [stopTone]);

  const playCallEndedTone = useCallback(() => {
    stopTone(endingToneRef);
    startTonePattern(endingToneRef, CALL_ENDED_TONE_PATTERN, { loop: false });
  }, [startTonePattern, stopTone]);

  const playCallFailedTone = useCallback(() => {
    stopTone(endingToneRef);
    startTonePattern(endingToneRef, CALL_FAILED_TONE_PATTERN, { loop: false });
  }, [startTonePattern, stopTone]);

  const setIncomingRingtone = useCallback(
    (id: WebphoneRingtoneId) => {
      const preset = getIncomingRingtonePreset(id);
      const next = {
        ...soundPreferencesRef.current,
        incomingRingtoneId: preset.id,
      };
      soundPreferencesRef.current = next;
      setSoundPreferencesState(next);
      writeWebphoneSoundPreferences(next);

      if (inboundRingToneRef.current?.active) {
        stopTone(inboundRingToneRef);
        startTonePattern(inboundRingToneRef, preset.pattern);
      }
    },
    [startTonePattern, stopTone]
  );

  const previewIncomingRingtone = useCallback(
    async (id: WebphoneRingtoneId) => {
      const preset = getIncomingRingtonePreset(id);
      stopTone(previewToneRef);
      startTonePattern(previewToneRef, preset.pattern, { loop: false });
      await new Promise<void>((resolve) => {
        if (typeof window === "undefined") {
          resolve();
          return;
        }
        window.setTimeout(resolve, getSoundPatternDurationMs(preset.pattern) + 80);
      });
    },
    [startTonePattern, stopTone]
  );

  const testSpeaker = useCallback(() => {
    stopTone(previewToneRef);
    startTonePattern(previewToneRef, SPEAKER_TEST_PATTERN, { loop: false });
  }, [startTonePattern, stopTone]);

  const refreshDevices = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
      setAvailableDevices({ inputs: [], outputs: [] });
      return;
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs: AvailableDevice[] = [];
      const outputs: AvailableDevice[] = [];
      let inputIndex = 0;
      let outputIndex = 0;
      for (const device of devices) {
        if (device.kind === "audioinput") {
          inputs.push({
            deviceId: device.deviceId,
            label: device.label || `Microphone ${inputIndex + 1}`,
          });
          inputIndex += 1;
        } else if (device.kind === "audiooutput") {
          outputs.push({
            deviceId: device.deviceId,
            label: device.label || `Speaker ${outputIndex + 1}`,
          });
          outputIndex += 1;
        }
      }

      setAvailableDevices({ inputs, outputs });

      const defaultInputDeviceId = inputs[0]?.deviceId ?? null;
      const selectedInputId = selectedInputDeviceIdRef.current;
      const selectedOutputId = selectedOutputDeviceIdRef.current;
      const defaultInputChanged =
        !selectedInputId &&
        Boolean(defaultInputDeviceIdRef.current) &&
        defaultInputDeviceIdRef.current !== defaultInputDeviceId;
      defaultInputDeviceIdRef.current = defaultInputDeviceId;

      let shouldReacquireDefaultInput = false;

      if (selectedInputId) {
        const exists = inputs.some((device) => device.deviceId === selectedInputId);
        if (!exists) {
          console.warn("[SIP] selected microphone missing, falling back to default input");
          commitSelectedInputDeviceId(null);
          setDeviceError("Selected microphone disconnected. Using the default microphone.");
          shouldReacquireDefaultInput = true;
        }
      }

      if (selectedOutputId) {
        const exists = outputs.some((device) => device.deviceId === selectedOutputId);
        if (!exists) {
          console.warn("[SIP] selected speaker missing, falling back to default output");
          commitSelectedOutputDeviceId(null);
          setDeviceError("Selected speaker disconnected. Using the default speaker.");
        }
      }

      const shouldRefreshActiveDefaultInput = defaultInputChanged || shouldReacquireDefaultInput;
      const activeSession = sessionRef.current;

      if (shouldRefreshActiveDefaultInput && activeSession && !activeSession.isEnded?.()) {
        const operationToken = ++inputOperationGenerationRef.current;
        try {
          const { stream } = await acquireInputStream(null);
          if (inputOperationGenerationRef.current !== operationToken) {
            stopStream(stream);
            return;
          }
          const replaced = await replaceSessionInputTrack(stream);
          if (!replaced) {
            stopStream(stream);
          }
        } catch (error) {
          console.warn("[SIP] failed to follow default microphone change", error);
        }
      }
    } catch (error) {
      console.warn("[SIP] enumerateDevices failed", error);
      setAvailableDevices({ inputs: [], outputs: [] });
    }
  }, [
    acquireInputStream,
    commitSelectedInputDeviceId,
    commitSelectedOutputDeviceId,
    replaceSessionInputTrack,
  ]);

  const callOptions = useMemo(
    () => ({
      mediaConstraints: {
        audio: buildSpeechAudioConstraints(null, false),
        video: false,
      },
      pcConfig: {
        iceServers: iceServers && iceServers.length > 0 ? iceServers : DEFAULT_ICE_SERVERS,
        iceTransportPolicy: iceTransportPolicy || "all",
      },
      rtcOfferConstraints: {
        offerToReceiveAudio: true,
        offerToReceiveVideo: false,
      },
      sessionTimersExpires: SIP_SESSION_TIMER_EXPIRES_SECONDS,
    }),
    [iceServers, iceTransportPolicy]
  );

  const createCallOptionsWithAudio = useCallback(
    async (activateStream = true) => {
      const operationToken = ++inputOperationGenerationRef.current;
      const acquisition = acquireInputStream(selectedInputDeviceIdRef.current);
      const { stream, resolvedDeviceId, fellBackToDefault } =
        await new Promise<AcquiredInputStream>((resolve, reject) => {
          let settled = false;
          const timeoutId = window.setTimeout(() => {
            settled = true;
            reject(new Error(MICROPHONE_ACQUISITION_TIMEOUT_MESSAGE));
          }, MICROPHONE_ACQUISITION_TIMEOUT_MS);

          acquisition.then(
            (result) => {
              if (settled) {
                stopStream(result.stream);
                return;
              }
              settled = true;
              window.clearTimeout(timeoutId);
              resolve(result);
            },
            (error) => {
              if (settled) return;
              settled = true;
              window.clearTimeout(timeoutId);
              reject(error);
            }
          );
        });

      if (inputOperationGenerationRef.current !== operationToken) {
        stopStream(stream);
        throw new Error("Microphone setup was superseded by a newer audio selection.");
      }

      if (fellBackToDefault && selectedInputDeviceIdRef.current) {
        commitSelectedInputDeviceId(null);
      } else if (resolvedDeviceId !== selectedInputDeviceIdRef.current) {
        commitSelectedInputDeviceId(resolvedDeviceId);
      }

      if (activateStream) {
        releaseLocalInputStream(stream);
      }
      return {
        ...callOptions,
        mediaStream: stream,
      };
    },
    [acquireInputStream, callOptions, commitSelectedInputDeviceId, releaseLocalInputStream]
  );

  const [speakerNeedsResume, setSpeakerNeedsResume] = useState(false);

  useEffect(() => {
    speakerNeedsResumeRef.current = speakerNeedsResume;
  }, [speakerNeedsResume]);

  useEffect(() => {
    selectedInputDeviceIdRef.current = selectedInputDeviceId;
  }, [selectedInputDeviceId]);

  useEffect(() => {
    selectedOutputDeviceIdRef.current = selectedOutputDeviceId;
  }, [selectedOutputDeviceId]);

  useEffect(() => {
    currentCallStateRef.current = currentCall.state;
    currentCallRef.current = currentCall;
  }, [currentCall]);

  const beginOutputDeviceSelection = useCallback(() => {
    outputDeviceSelectionInProgressRef.current = true;
    outputDeviceSelectionGraceUntilRef.current = Date.now() + OUTPUT_DEVICE_SELECTION_GRACE_MS;
  }, []);

  const settleOutputDeviceSelection = useCallback(() => {
    outputDeviceSelectionInProgressRef.current = false;
    outputDeviceSelectionGraceUntilRef.current = Date.now() + OUTPUT_DEVICE_SELECTION_GRACE_MS;
  }, []);

  const shouldSuppressTransientSipRecovery = useCallback(() => {
    return (
      outputDeviceSelectionInProgressRef.current ||
      Date.now() < outputDeviceSelectionGraceUntilRef.current
    );
  }, []);

  const finishRegistrationRecovery = useCallback(() => {
    registrationRecoveryRef.current = false;
    if (registrationRecoveryTimerRef.current) {
      clearTimeout(registrationRecoveryTimerRef.current);
      registrationRecoveryTimerRef.current = null;
    }
  }, []);

  const beginRegistrationRecovery = useCallback((ua: JsSIPUA) => {
    registrationRecoveryRef.current = true;
    if (registrationRecoveryTimerRef.current) {
      clearTimeout(registrationRecoveryTimerRef.current);
    }
    registrationRecoveryTimerRef.current = window.setTimeout(() => {
      registrationRecoveryTimerRef.current = null;
      if (!registrationRecoveryRef.current || uaRef.current !== ua) return;

      registrationRecoveryRef.current = false;
      setIsRegistered(false);
      setIsRegistering(false);
    }, SIP_REGISTRATION_RECOVERY_TIMEOUT_MS);
  }, []);

  const clearRemoteAudio = useCallback(() => {
    detachRemoteAudioElement(audioElementRef.current);
    remoteStreamRef.current = null;
    setAudioReady(false);
    setSpeakerNeedsResume(false);
  }, []);

  const applySpeakerPreference = useCallback((enabled: boolean) => {
    const audioElement = audioElementRef.current;
    if (!audioElement) return;
    audioElement.muted = shouldMuteRemoteAudio(enabled, currentCallRef.current.onHold);
    if (enabled && typeof audioElement.play === "function") {
      audioElement
        .play()
        .then(() => {
          setSpeakerNeedsResume(false);
        })
        .catch((error) => {
          if (error?.name === "NotAllowedError") {
            console.warn("[SIP] speaker playback blocked, awaiting user gesture");
            setSpeakerNeedsResume(true);
          } else {
            console.warn("[SIP] resume speaker playback failed", error);
          }
        });
    }
  }, []);

  const applySinkIdToElement = useCallback(
    async (element: HTMLAudioElement | null, target: string) => {
      if (!element) {
        return;
      }
      const audioWithSink = element as HTMLAudioElement & {
        setSinkId: (sinkId: string) => Promise<void>;
      };
      if (typeof audioWithSink.setSinkId !== "function") {
        return;
      }
      if ((audioWithSink as HTMLMediaElement & { sinkId?: string }).sinkId === target) {
        return;
      }
      await audioWithSink.setSinkId(target);
    },
    []
  );

  const applyOutputDevice = useCallback(
    async (deviceId: string | null) => {
      if (!sinkIdSupported) {
        return;
      }
      if (typeof window !== "undefined" && !window.isSecureContext) {
        return;
      }
      const target = deviceId || "";
      const applyTarget = (sinkId: string) => applySinkIdToElement(audioElementRef.current, sinkId);

      try {
        await applyTarget(target);
        setDeviceError(null);
      } catch (error) {
        const name = (error as Error)?.name;

        if (name === "NotFoundError" || name === "OverconstrainedError") {
          console.warn("[SIP] selected speaker not found, reverting to default");
        } else {
          console.warn("[SIP] failed to route audio to selected device", error);
        }
        if (deviceId) {
          setDeviceError(
            name === "NotAllowedError" || name === "SecurityError"
              ? "Browser blocked speaker switching. Reverting to the default output device."
              : "Unable to route audio to the selected speaker. Reverting to default output."
          );
          commitSelectedOutputDeviceId(null);
          await applyTarget("").catch(() => {});
        }
      }
    },
    [applySinkIdToElement, commitSelectedOutputDeviceId, sinkIdSupported]
  );

  const attachStream = useCallback(
    (stream: MediaStream) => {
      if (!stream) return;
      if (sameTrackSet(stream, remoteStreamRef.current)) {
        return;
      }
      remoteStreamRef.current = stream;
      setAudioReady(false);
      const audioElement = audioElementRef.current;
      if (!audioElement) return;

      try {
        if (audioElement.srcObject !== stream) {
          audioElement.srcObject = stream;
        }
        const playPromise = audioElement.play();
        if (playPromise && typeof playPromise.then === "function") {
          void playPromise
            .then(() => setAudioReady(true))
            .catch((error) => {
              console.warn("[SIP] autoplay prevented", error);
              if (error?.name === "NotAllowedError") {
                setSpeakerNeedsResume(true);
              }
            });
        } else {
          setAudioReady(true);
        }
      } catch (error) {
        console.warn("[SIP] failed to attach remote stream", error);
      }

      applySpeakerPreference(speakerEnabledRef.current);

      if (sinkIdSupported) {
        void applyOutputDevice(selectedOutputDeviceIdRef.current);
      }
    },
    [applyOutputDevice, applySpeakerPreference, sinkIdSupported]
  );

  const addTrackToStream = useCallback((track: MediaStreamTrack) => {
    if (!track) return null;

    let stream = remoteStreamRef.current;
    if (!stream) {
      try {
        stream = new MediaStream();
        remoteStreamRef.current = stream;
      } catch (error) {
        console.warn("[SIP] unable to create media stream", error);
        return null;
      }
    }

    const alreadyPresent = stream.getTracks().some((existing) => existing.id === track.id);
    if (!alreadyPresent) {
      stream.addTrack(track);
    }

    return stream;
  }, []);

  const stopDiagnosticsInterval = useCallback(() => {
    if (diagnosticsIntervalRef.current) {
      clearInterval(diagnosticsIntervalRef.current);
      diagnosticsIntervalRef.current = null;
    }
  }, []);

  interface SampleDiagnosticsOptions {
    type?: "live" | "summary";
    status?: string | null;
    extra?: { sip?: unknown } | null;
    metrics?: PeerConnectionDiagnostics | null;
  }

  const sampleDiagnostics = useCallback(
    async (
      session: JsSIPSession,
      {
        type = "live",
        status = null,
        extra = null,
        metrics: providedMetrics = null,
      }: SampleDiagnosticsOptions = {}
    ): Promise<Record<string, unknown> | null> => {
      if (!session) return null;
      try {
        const snapshot =
          providedMetrics || (await collectPeerConnectionDiagnostics(session.connection));
        if (type === "live") {
          let optimizer = callQualityOptimizerRef.current.get(session);
          if (!optimizer) {
            optimizer = createCallQualityOptimizer();
            callQualityOptimizerRef.current.set(session, optimizer);
          }
          const candidatePair = snapshot.candidatePair;
          const remoteInbound = snapshot.remoteInbound;
          snapshot.adaptive = optimizer.sample({
            jitterSeconds:
              readDiagnosticNumber(snapshot.inboundAudio, "jitter") ??
              readDiagnosticNumber(remoteInbound, "jitter"),
            packetsLost: readDiagnosticNumber(snapshot.inboundAudio, "packetsLost"),
            packetsReceived: readDiagnosticNumber(snapshot.inboundAudio, "packetsReceived"),
            remotePacketsLost: readDiagnosticNumber(remoteInbound, "packetsLost"),
            remotePacketsReceived: readDiagnosticNumber(remoteInbound, "packetsReceived"),
            packetsSent: readDiagnosticNumber(snapshot.outboundAudio, "packetsSent"),
            jitterBufferDelaySeconds: readDiagnosticNumber(
              snapshot.inboundAudio,
              "jitterBufferDelay"
            ),
            jitterBufferEmittedCount: readDiagnosticNumber(
              snapshot.inboundAudio,
              "jitterBufferEmittedCount"
            ),
            totalSamplesReceived: readDiagnosticNumber(
              snapshot.inboundAudio,
              "totalSamplesReceived"
            ),
            concealedSamples: readDiagnosticNumber(snapshot.inboundAudio, "concealedSamples"),
            concealmentEvents: readDiagnosticNumber(snapshot.inboundAudio, "concealmentEvents"),
            roundTripTimeSeconds:
              readDiagnosticNumber(candidatePair, "currentRoundTripTime") ??
              readDiagnosticNumber(remoteInbound, "roundTripTime"),
          });
          const previousEvidence = rtpFlowEvidenceRef.current.get(session);
          const { evidence, becameBidirectional } = updateAudioRtpFlowEvidence(previousEvidence, {
            packetsReceived: snapshot.inboundAudio?.packetsReceived,
            packetsSent: snapshot.outboundAudio?.packetsSent,
          });
          rtpFlowEvidenceRef.current.set(session, evidence);
          if (becameBidirectional) {
            console.info("[SIP] Bidirectional RTP flow verified", {
              sessionId: session.id,
              packetsReceived: evidence.inboundPackets,
              packetsSent: evidence.outboundPackets,
            });
            sessionActivationGateRef.current.get(session)?.markMediaFlowing();
          }
        }
        const enriched = {
          id: session.id,
          updatedAt: new Date().toISOString(),
          direction:
            callMetaRef.current?.direction || normalizeDirection(session.direction) || null,
          remoteIdentity: formatIdentity(session.remote_identity),
          localIdentity: formatIdentity(session.local_identity),
          metrics: snapshot,
          iceConfig: callMetaRef.current?.iceConfig || null,
          audioInput: callMetaRef.current?.audioInput || null,
          localOfferCodecs: callMetaRef.current?.localOfferCodecs || [],
          iceStates: callMetaRef.current?.iceStates || [],
          type,
          status: status || null,
          sip: extra?.sip || null,
        };
        console.info("[SIP] Call quality diagnostics", {
          iceState: snapshot.iceConnectionState,
          codecs: snapshot.codecs || null,
          candidatePair: snapshot.candidatePair || null,
          inboundAudio: snapshot.inboundAudio || null,
          outboundAudio: snapshot.outboundAudio || null,
          remoteInbound: snapshot.remoteInbound || null,
        });
        setDiagnosticsState((prev) => {
          if (type === "live") {
            return {
              ...prev,
              live: enriched,
            };
          }
          return {
            ...prev,
            live: null,
            last: enriched,
          };
        });
        return enriched;
      } catch (error) {
        console.warn("[SIP] Failed to sample diagnostics", error);
        return null;
      }
    },
    []
  );

  const startDiagnosticsInterval = useCallback(
    (session: JsSIPSession) => {
      stopDiagnosticsInterval();
      if (!session) return;
      sampleDiagnostics(session);
      if (typeof window === "undefined") return;
      diagnosticsIntervalRef.current = setInterval(() => {
        sampleDiagnostics(session);
      }, 5000);
    },
    [sampleDiagnostics, stopDiagnosticsInterval]
  );

  const stopSelfTest = useCallback(
    (reason = "stopped") => {
      const data = selfTestRef.current;
      if (!data.running) return;
      if (data.timeout) {
        clearTimeout(data.timeout);
      }
      if (data.stream) {
        stopStream(data.stream);
      }
      const previousStream = data.previousStream || null;
      selfTestRef.current = {
        stream: null,
        previousStream: null,
        timeout: null,
        running: false,
      };
      if (previousStream) {
        attachStream(previousStream);
      } else {
        clearRemoteAudio();
      }
      setSelfTestState((prev) => ({
        ...prev,
        running: false,
        lastCompletedAt: new Date().toISOString(),
        lastResult: reason,
        lastError: null,
      }));
    },
    [attachStream, clearRemoteAudio]
  );

  const startSelfTest = useCallback(async () => {
    if (selfTestRef.current.running) {
      return { ok: false, reason: "already-running" };
    }
    const activeStates: readonly string[] = [
      CALL_STATES.DIALING,
      CALL_STATES.RINGING,
      CALL_STATES.INCOMING,
      CALL_STATES.CONNECTING,
      CALL_STATES.ACTIVE,
    ];
    if (activeStates.includes(currentCall.state)) {
      const message = "End the current call before running the self-test.";
      setSelfTestState((prev) => ({
        ...prev,
        lastError: message,
      }));
      return { ok: false, error: message };
    }
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      const message = "Microphone access is unavailable in this browser.";
      setSelfTestState((prev) => ({
        ...prev,
        lastError: message,
      }));
      return { ok: false, error: message };
    }
    try {
      const operationToken = ++inputOperationGenerationRef.current;
      setSelfTestState((prev) => ({
        ...prev,
        running: true,
        lastError: null,
        lastStartedAt: new Date().toISOString(),
        lastResult: null,
      }));
      const { stream, resolvedDeviceId, fellBackToDefault } = await acquireInputStream(
        selectedInputDeviceIdRef.current
      );
      if (inputOperationGenerationRef.current !== operationToken) {
        stopStream(stream);
        throw new Error("Microphone self-test was superseded by a newer audio selection.");
      }
      if (fellBackToDefault && selectedInputDeviceIdRef.current) {
        commitSelectedInputDeviceId(null);
      } else if (resolvedDeviceId !== selectedInputDeviceIdRef.current) {
        commitSelectedInputDeviceId(resolvedDeviceId);
      }
      const previousStream = remoteStreamRef.current || null;
      selfTestRef.current = {
        stream,
        previousStream,
        timeout: null,
        running: true,
      };
      attachStream(stream);
      if (typeof window !== "undefined") {
        selfTestRef.current.timeout = window.setTimeout(() => {
          stopSelfTest("completed");
        }, 6000);
      }
      return { ok: true };
    } catch (error: unknown) {
      const message =
        formatCause(error) ||
        (error instanceof Error ? error.message : "Unable to start self-test.");
      selfTestRef.current = {
        stream: null,
        previousStream: null,
        timeout: null,
        running: false,
      };
      setSelfTestState((prev) => ({
        ...prev,
        running: false,
        lastError: message,
      }));
      return { ok: false, error: message };
    }
  }, [
    acquireInputStream,
    attachStream,
    commitSelectedInputDeviceId,
    currentCall.state,
    stopSelfTest,
  ]);

  const [wrapUpRemainingSeconds, setWrapUpRemainingSeconds] = useState(0);
  const wrapUpRemainingSecondsRef = useRef(0);
  const [wrapUpTotalSeconds, setWrapUpTotalSeconds] = useState(0);
  const wrapUpTotalSecondsRef = useRef(0);
  const [wrapUpExtensionsLeft, setWrapUpExtensionsLeft] = useState(WRAP_UP_MAX_EXTENSIONS);
  const wrapUpExtensionsLeftRef = useRef(WRAP_UP_MAX_EXTENSIONS);
  const wrapUpTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wrapUpDeadlineRef = useRef(0);

  const updateWrapUpRemaining = useCallback((value: number) => {
    wrapUpRemainingSecondsRef.current = value;
    setWrapUpRemainingSeconds(value);
  }, []);

  const updateWrapUpTotal = useCallback((value: number) => {
    wrapUpTotalSecondsRef.current = value;
    setWrapUpTotalSeconds(value);
  }, []);

  const updateWrapUpExtensionsLeft = useCallback((value: number) => {
    wrapUpExtensionsLeftRef.current = value;
    setWrapUpExtensionsLeft(value);
  }, []);

  const stopWrapUp = useCallback(() => {
    if (wrapUpTimerRef.current) {
      clearInterval(wrapUpTimerRef.current);
      wrapUpTimerRef.current = null;
    }
    wrapUpDeadlineRef.current = 0;
    updateWrapUpRemaining(0);
    updateWrapUpTotal(0);
  }, [updateWrapUpRemaining, updateWrapUpTotal]);

  const skipWrapUp = useCallback(() => {
    stopWrapUp();
  }, [stopWrapUp]);

  const extendWrapUp = useCallback(() => {
    if (wrapUpRemainingSecondsRef.current <= 0) return;
    if (wrapUpExtensionsLeftRef.current <= 0) return;
    const now = Date.now();
    if (wrapUpDeadlineRef.current <= now) {
      stopWrapUp();
      return;
    }
    wrapUpDeadlineRef.current += WRAP_UP_EXTEND_SECONDS * 1000;
    updateWrapUpExtensionsLeft(wrapUpExtensionsLeftRef.current - 1);
    updateWrapUpTotal(wrapUpTotalSecondsRef.current + WRAP_UP_EXTEND_SECONDS);
    updateWrapUpRemaining(Math.ceil((wrapUpDeadlineRef.current - now) / 1000));
  }, [stopWrapUp, updateWrapUpExtensionsLeft, updateWrapUpRemaining, updateWrapUpTotal]);

  const startWrapUp = useCallback(() => {
    stopWrapUp();
    if (!WRAP_UP_DURATION_SECONDS) return;
    updateWrapUpTotal(WRAP_UP_DURATION_SECONDS);
    updateWrapUpExtensionsLeft(WRAP_UP_MAX_EXTENSIONS);
    updateWrapUpRemaining(WRAP_UP_DURATION_SECONDS);
    wrapUpDeadlineRef.current = Date.now() + WRAP_UP_DURATION_SECONDS * 1000;
    wrapUpTimerRef.current = setInterval(() => {
      const next = Math.max(0, Math.ceil((wrapUpDeadlineRef.current - Date.now()) / 1000));
      if (next <= 0) {
        stopWrapUp();
        return;
      }
      if (next !== wrapUpRemainingSecondsRef.current) updateWrapUpRemaining(next);
    }, 1000);
  }, [
    WRAP_UP_DURATION_SECONDS,
    WRAP_UP_MAX_EXTENSIONS,
    stopWrapUp,
    updateWrapUpExtensionsLeft,
    updateWrapUpRemaining,
    updateWrapUpTotal,
  ]);

  useEffect(() => {
    return () => {
      if (wrapUpTimerRef.current) {
        clearInterval(wrapUpTimerRef.current);
        wrapUpTimerRef.current = null;
      }
    };
  }, []);

  const [noiseSuppressionEnabled, setNoiseSuppressionEnabled] = useState(() =>
    resolveNoiseSuppressionEnabled({
      allowed: CUSTOM_NOISE_SUPPRESSION_ALLOWED,
      storedValue: loadStoredValue(STORAGE_KEYS.noiseSuppression),
    })
  );
  const noiseSuppressionEnabledRef = useRef(noiseSuppressionEnabled);

  useEffect(() => {
    // Keep initialization lazy: the first call or live toggle supplies the
    // required user gesture for AudioContext/RNNoise startup.
    return () => {
      inputOperationGenerationRef.current += 1;
      disposeNoiseSuppression();
    };
  }, []);

  const setNoiseSuppression = useCallback(
    async (enabled: boolean) => {
      const nextEnabled = CUSTOM_NOISE_SUPPRESSION_ALLOWED && enabled;
      if (noiseSuppressionEnabledRef.current === nextEnabled) return;
      const requestToken = ++inputOperationGenerationRef.current;
      const isLatestRequest = () => inputOperationGenerationRef.current === requestToken;
      noiseSuppressionEnabledRef.current = nextEnabled;
      setNoiseSuppressionEnabled(nextEnabled);
      persistValue(STORAGE_KEYS.noiseSuppression, String(nextEnabled));

      const currentStream = localInputStreamRef.current;
      if (!currentStream) {
        if (!nextEnabled) disposeNoiseSuppression();
        return;
      }

      let acquiredStream: MediaStream | null = null;
      try {
        const { stream, resolvedDeviceId, fellBackToDefault } = await acquireInputStream(
          selectedInputDeviceIdRef.current
        );
        acquiredStream = stream;
        if (!isLatestRequest()) {
          if (localInputStreamRef.current !== stream) stopStream(stream);
          return;
        }

        const activeSession = sessionRef.current;
        if (activeSession && !activeSession.isEnded?.()) {
          if (!isLatestRequest()) {
            stopStream(stream);
            return;
          }
          const replaced = await replaceSessionInputTrack(stream);
          if (!isLatestRequest()) {
            if (!replaced && localInputStreamRef.current !== stream) stopStream(stream);
            return;
          }
          if (!replaced) {
            stopStream(stream);
            setDeviceError(
              "Unable to apply noise suppression to the active call; the current microphone is unchanged."
            );
            return;
          } else if (!nextEnabled) {
            // Keep the old processed track alive until the raw replacement is live.
            disposeNoiseSuppression();
          }
        } else {
          stopStream(stream);
          if (!nextEnabled) disposeNoiseSuppression();
        }
        if (!isLatestRequest()) return;
        if (fellBackToDefault && selectedInputDeviceIdRef.current) {
          commitSelectedInputDeviceId(null);
        } else {
          commitSelectedInputDeviceId(resolvedDeviceId);
        }
      } catch (error) {
        if (acquiredStream && localInputStreamRef.current !== acquiredStream) {
          stopStream(acquiredStream);
        }
        if (!isLatestRequest()) return;
        // Preserve the user's desired preference for the next acquisition. The
        // current sender keeps its previous working track when replacement fails.
        setDeviceError(formatCause(error) || "Unable to change noise suppression.");
      }
    },
    [
      CUSTOM_NOISE_SUPPRESSION_ALLOWED,
      acquireInputStream,
      commitSelectedInputDeviceId,
      replaceSessionInputTrack,
    ]
  );

  const resetCall = useCallback(
    (overrides: Partial<CurrentCallState> = {}) => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (hangupFallbackTimerRef.current) {
        clearTimeout(hangupFallbackTimerRef.current);
        hangupFallbackTimerRef.current = null;
      }
      stopRingbackTone();
      stopHoldTone();
      stopInboundRingTone();
      stopDiagnosticsInterval();
      setDiagnosticsState((prev) => ({
        ...prev,
        live: null,
      }));
      stopSelfTest("call-reset");
      clearRemoteAudio();
      promotedSessionCleanupRef.current?.();
      promotedSessionCleanupRef.current = null;
      inputOperationGenerationRef.current += 1;
      releaseLocalInputStream();
      disposeNoiseSuppression();
      sessionRef.current = null;
      answeringSessionRef.current = null;
      localHoldFallbackRef.current = false;
      callMetaRef.current = null;
      setCurrentCall({
        ...initialCallState,
        ...overrides,
      });
    },
    [
      clearRemoteAudio,
      releaseLocalInputStream,
      stopDiagnosticsInterval,
      stopHoldTone,
      stopInboundRingTone,
      stopRingbackTone,
      stopSelfTest,
    ]
  );

  useEffect(() => {
    const terminalState = currentCall.state;
    if (terminalState !== CALL_STATES.ENDED && terminalState !== CALL_STATES.FAILED) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setCurrentCall((previous) =>
        previous.state === terminalState ? initialCallState : previous
      );
    }, TERMINAL_CALL_STATUS_DISPLAY_MS);

    return () => window.clearTimeout(timeoutId);
  }, [currentCall.state]);

  const setRegistrationEnabled = useCallback(
    (enabled: boolean) => {
      const liveSession = sessionRef.current;
      if (!enabled && liveSession && !liveSession.isEnded?.()) {
        updateLastError("End the active call before taking the webphone offline.");
        return;
      }

      latestRegistrationEnabledRef.current = enabled;
      registrationDesiredRef.current = enabled;
      setRegistrationEnabledState(enabled);

      const ua = uaRef.current;
      if (!ua) return;

      if (enabled) {
        try {
          setIsRegistering(true);
          ua.register();
        } catch (error: unknown) {
          setIsRegistering(false);
          updateLastError(formatCause(error) || "Registration failed");
        }
        return;
      }

      finishRegistrationRecovery();
      try {
        // Remove only this browser's Contact binding. Contact:* would also
        // deregister another device sharing the same SIP account.
        ua.unregister();
      } catch (error) {
        console.warn("[SIP] Unable to cancel registration while disabling webphone", error);
      }
      setIsRegistering(false);
      setIsRegistered(false);
      resetCall();
    },
    [finishRegistrationRecovery, resetCall, updateLastError]
  );

  useEffect(() => {
    refreshDevices();
    if (typeof navigator !== "undefined" && navigator.mediaDevices) {
      const listener = () => {
        refreshDevices();
      };
      navigator.mediaDevices.addEventListener?.("devicechange", listener);
      if ("ondevicechange" in navigator.mediaDevices) {
        navigator.mediaDevices.ondevicechange = listener;
      }
      return () => {
        navigator.mediaDevices.removeEventListener?.("devicechange", listener);
        if ("ondevicechange" in navigator.mediaDevices) {
          navigator.mediaDevices.ondevicechange = null;
        }
      };
    }
    return undefined;
  }, [refreshDevices]);

  useEffect(() => {
    persistValue(STORAGE_KEYS.input, selectedInputDeviceId);
  }, [selectedInputDeviceId]);

  useEffect(() => {
    persistValue(STORAGE_KEYS.output, selectedOutputDeviceId);
    if (sinkIdSupported) {
      void applyOutputDevice(selectedOutputDeviceId);
    }
  }, [applyOutputDevice, selectedOutputDeviceId, sinkIdSupported]);

  useEffect(() => {
    latestRegistrationEnabledRef.current = registrationEnabled;
  }, [registrationEnabled]);

  useEffect(() => {
    onCallSummaryRef.current = onCallSummary;
    onRegistrationFailedRef.current = onRegistrationFailed;
  }, [onCallSummary, onRegistrationFailed]);

  const attachStreamRef = useRef(attachStream);
  const addTrackRef = useRef(addTrackToStream);
  const resetCallRef = useRef(resetCall);

  useEffect(() => {
    attachStreamRef.current = attachStream;
  }, [attachStream]);

  useEffect(() => {
    addTrackRef.current = addTrackToStream;
  }, [addTrackToStream]);

  useEffect(() => {
    resetCallRef.current = resetCall;
  }, [resetCall]);

  const emitSessionCallSummary = useCallback(
    async (
      session: JsSIPSession,
      status: string,
      eventData?: unknown,
      failureKind: SipSessionEndFailureKind = null
    ) => {
      const handler = onCallSummaryRef.current;
      if (typeof handler !== "function") {
        callMetaRef.current = null;
        return;
      }

      const meta = callMetaRef.current || {};
      if (meta.emitted) return;
      meta.emitted = true;
      callMetaRef.current = meta;

      const metrics = await collectPeerConnectionDiagnostics(session.connection);
      const endedAtIso = new Date().toISOString();
      const startedAtIso = meta.acceptedAt || meta.progressedAt || meta.createdAt || null;
      const durationSeconds =
        typeof meta.startedAtMs === "number"
          ? Math.max(0, Math.round((Date.now() - meta.startedAtMs) / 1000))
          : null;
      const signalingDiagnostics: SipWebSocketDiagnostics | null =
        sipSocketRef.current?.getDiagnostics() ?? null;
      const sipDetails = {
        cause: formatCause((eventData as { cause?: unknown })?.cause),
        failureKind,
        statusCode:
          (eventData as { response?: SipResponseDetails })?.response?.status_code ??
          (eventData as { message?: SipResponseDetails })?.message?.status_code ??
          null,
        reason:
          (eventData as { response?: SipResponseDetails })?.response?.reason_phrase ??
          (eventData as { message?: SipResponseDetails })?.message?.reason_phrase ??
          null,
        reinviteCount: typeof meta.reinviteCount === "number" ? meta.reinviteCount : 0,
        lastReinvite: meta.lastReinvite || null,
      };
      const payload = {
        sessionId: session.id,
        callSid: sessionCallIdsRef.current.get(session) ?? null,
        direction: meta.direction || normalizeDirection(session.direction) || "out",
        status,
        startedAt: startedAtIso,
        endedAt: endedAtIso,
        durationSeconds,
        remoteIdentity: formatIdentity(session.remote_identity),
        localIdentity: formatIdentity(session.local_identity),
        sip: sipDetails,
        metrics,
        signaling: {
          current: signalingDiagnostics,
          transportDrops: Array.isArray(meta.transportDrops) ? meta.transportDrops : [],
        },
        iceConfig: meta.iceConfig || null,
        audioInput: meta.audioInput || null,
        localOfferCodecs: meta.localOfferCodecs || [],
        timeline: {
          createdAt: meta.createdAt || null,
          progressedAt: meta.progressedAt || null,
          acceptedAt: meta.acceptedAt || null,
          confirmedAt: meta.confirmedAt || null,
          mediaConnectedAt: meta.mediaConnectedAt || null,
          lastReinviteAt:
            (meta.lastReinvite as { receivedAt?: string } | undefined)?.receivedAt || null,
        },
        iceStates: meta.iceStates || [],
        speakerNeedsResume: speakerNeedsResumeRef.current || false,
        lastError: lastErrorRef.current,
      };

      sampleDiagnostics(session, {
        type: "summary",
        status,
        extra: { sip: sipDetails },
        metrics,
      }).catch(() => {});
      const sanitized = safeStructuredClone(payload);
      if (!sanitized) {
        if (callMetaRef.current === meta) callMetaRef.current = null;
        return;
      }

      try {
        await handler(sanitized);
      } catch (error) {
        console.error("[SIP] call summary handler failed", error);
      } finally {
        if (callMetaRef.current === meta) callMetaRef.current = null;
      }
    },
    [sampleDiagnostics]
  );

  const reportSessionActivationIssue = useCallback(
    (session: JsSIPSession, reason: string) => {
      if (sessionRef.current !== session) return;

      const warning = {
        reason,
        reportedAt: new Date().toISOString(),
        connectionState: session.connection?.connectionState || null,
        iceConnectionState: session.connection?.iceConnectionState || null,
      };
      console.warn("[SIP] Session activation warning", {
        sessionId: session.id,
        callId: sessionCallIdsRef.current.get(session) ?? null,
        ...warning,
      });
      if (callMetaRef.current) {
        callMetaRef.current.activationWarning = warning;
      }
      sampleDiagnostics(session, {
        status: currentCallStateRef.current,
        extra: { sip: { activationWarning: reason } },
      }).catch(() => {});
    },
    [sampleDiagnostics]
  );

  const bindSessionConnectivityHandlers = useCallback(
    (
      session: JsSIPSession,
      activationGate: SessionActivationGate,
      sessionCleanups: CleanupFn[]
    ) => {
      const ownsCurrentSession = () => sessionRef.current === session;
      let iceGatheringForced = false;
      let iceGatheringForceTimer: number | null = null;
      let latestIceGatheringReady: (() => void) | null = null;
      let boundConnection: RTCPeerConnection | null = null;
      let iceRestartTimer: number | null = null;
      let iceRestartAttempts = 0;
      let iceRestartReadinessRetries = 0;
      const latestIceServers = iceServersRef.current;
      const configuredIceServers =
        latestIceServers && latestIceServers.length > 0 ? latestIceServers : DEFAULT_ICE_SERVERS;
      const iceGatheringWatchdogMs = getIceGatheringWatchdogMs(configuredIceServers);

      const clearIceGatheringForceTimer = () => {
        if (iceGatheringForceTimer === null) return;
        window.clearTimeout(iceGatheringForceTimer);
        iceGatheringForceTimer = null;
      };
      const resetIceGatheringWatchdog = () => {
        clearIceGatheringForceTimer();
        latestIceGatheringReady = null;
        iceGatheringForced = false;
      };
      const clearIceRestartTimer = () => {
        if (iceRestartTimer === null) return;
        window.clearTimeout(iceRestartTimer);
        iceRestartTimer = null;
      };
      const scheduleIceRestart = (
        connection: RTCPeerConnection,
        delayMs = ICE_DISCONNECTED_RESTART_DELAY_MS
      ) => {
        if (iceRestartTimer !== null || iceRestartAttempts > 0) return;
        iceRestartTimer = window.setTimeout(() => {
          iceRestartTimer = null;
          const sessionEstablished = session.isEstablished?.() === true;
          const readyToReOffer = session.isReadyToReOffer?.() === true;
          const eligible = shouldAttemptIceRestart({
            iceState: connection.iceConnectionState,
            sessionEstablished,
            readyToReOffer,
            attempts: iceRestartAttempts,
          });
          if (!ownsCurrentSession()) return;
          if (!eligible) {
            if (
              shouldRetryIceRestartReadiness({
                iceState: connection.iceConnectionState,
                sessionEstablished,
                attempts: iceRestartAttempts,
                readinessRetries: iceRestartReadinessRetries,
              })
            ) {
              iceRestartReadinessRetries += 1;
              scheduleIceRestart(connection, ICE_RESTART_READINESS_RETRY_DELAY_MS);
            }
            return;
          }

          console.warn("[SIP] ICE remained disconnected; requesting one ICE restart", {
            sessionId: session.id,
            callId: sessionCallIdsRef.current.get(session) ?? null,
          });
          try {
            const started = session.renegotiate?.(
              { rtcOfferConstraints: { iceRestart: true } },
              () => {
                console.info("[SIP] ICE restart negotiation completed", {
                  sessionId: session.id,
                  callId: sessionCallIdsRef.current.get(session) ?? null,
                });
              }
            );
            if (started) {
              iceRestartAttempts += 1;
              iceRestartReadinessRetries = 0;
            } else {
              console.warn("[SIP] ICE restart could not start while the dialog was busy");
              if (
                shouldRetryIceRestartReadiness({
                  iceState: connection.iceConnectionState,
                  sessionEstablished: session.isEstablished?.() === true,
                  attempts: iceRestartAttempts,
                  readinessRetries: iceRestartReadinessRetries,
                })
              ) {
                iceRestartReadinessRetries += 1;
                scheduleIceRestart(connection, ICE_RESTART_READINESS_RETRY_DELAY_MS);
              }
            }
          } catch (error) {
            iceRestartAttempts += 1;
            console.warn("[SIP] ICE restart request failed", error);
          }
        }, delayMs);
      };

      sessionCleanups.push(resetIceGatheringWatchdog);
      sessionCleanups.push(clearIceRestartTimer);
      sessionCleanups.push(
        bindEmitterEvent(session, "icecandidate", (event?: { ready?: () => void }) => {
          if (iceGatheringForced || typeof event?.ready !== "function") return;
          latestIceGatheringReady = event.ready;
          if (iceGatheringForceTimer !== null) return;

          // JsSIP already completes naturally on the final null candidate. This
          // timer is only a safeguard for browsers/interfaces that never finish.
          iceGatheringForceTimer = window.setTimeout(() => {
            iceGatheringForceTimer = null;
            if (
              iceGatheringForced ||
              boundConnection?.iceGatheringState === "complete" ||
              !latestIceGatheringReady
            ) {
              return;
            }
            iceGatheringForced = true;
            console.warn("[SIP] ICE gathering watchdog expired; using candidates gathered so far");
            const forceReady = latestIceGatheringReady;
            latestIceGatheringReady = null;
            forceReady();
          }, iceGatheringWatchdogMs);
        })
      );
      sessionCleanups.push(
        bindEmitterEvent(
          session,
          "sdp",
          (event: { type?: string; originator?: string; sdp?: string }) => {
            if (event.originator !== "local" || !event.sdp) return;

            const originalSummary = summarizeSdpIceConnectivity(event.sdp);
            if (isLocalSdpCandidatePruningEnabled()) {
              const minimizedSdp = minimizeSdpCandidates(event.sdp);
              if (minimizedSdp !== event.sdp) {
                event.sdp = minimizedSdp;
                const minimizedSummary = summarizeSdpIceConnectivity(minimizedSdp);
                console.info("[SIP] Pruned local ICE candidates", {
                  type: event.type || null,
                  before: originalSummary.candidateCount,
                  after: minimizedSummary.candidateCount,
                  candidateTypes: minimizedSummary.candidateTypes,
                  protocols: minimizedSummary.protocols,
                });
              }
            } else {
              console.info("[SIP] Local ICE candidate pruning disabled", {
                type: event.type || null,
                candidates: originalSummary.candidateCount,
                candidateTypes: originalSummary.candidateTypes,
                protocols: originalSummary.protocols,
              });
            }

            if (event.type === "offer") {
              const codecs = summarizeAudioOfferCodecs(event.sdp);
              if (ownsCurrentSession() && callMetaRef.current) {
                callMetaRef.current.localOfferCodecs = codecs;
              }
              console.info("[SIP] Local audio offer codecs", codecs);
            }
          }
        )
      );

      sessionCleanups.push(
        bindEmitterEvent(session, "reinvite", (event?: SipReinviteEvent) => {
          if (!ownsCurrentSession() || !callMetaRef.current) return;

          const request = event?.request;
          const receivedAt = new Date().toISOString();
          const diagnostic = {
            receivedAt,
            cseq:
              typeof request?.cseq === "number" || typeof request?.cseq === "string"
                ? request.cseq
                : null,
            hasSdp: Boolean(request?.body),
            sessionExpires:
              typeof request?.session_expires === "number" ? request.session_expires : null,
            refresher:
              typeof request?.session_expires_refresher === "string"
                ? request.session_expires_refresher
                : null,
            from: String(request?.from?.uri ?? ""),
          };
          const previousCount =
            typeof callMetaRef.current.reinviteCount === "number"
              ? callMetaRef.current.reinviteCount
              : 0;
          callMetaRef.current.reinviteCount = previousCount + 1;
          callMetaRef.current.lastReinvite = diagnostic;
          console.info("[SIP] Incoming mid-call re-INVITE", {
            sessionId: session.id,
            callId: sessionCallIdsRef.current.get(session) ?? null,
            ...diagnostic,
          });
        })
      );

      const bindPeerConnection = (connection: RTCPeerConnection | null | undefined) => {
        if (!connection || boundConnection === connection) return;
        boundConnection = connection;
        sessionCleanups.push(bindIceNetworkAdvisories(connection, configuredIceServers));
        if (ownsCurrentSession() && callMetaRef.current) {
          callMetaRef.current.peerConnectionCreatedAt = new Date().toISOString();
        }
        sessionCleanups.push(
          bindTargetEvent(connection, "track", ((eventTrack: RTCTrackEvent) => {
            if (!ownsCurrentSession()) return;
            const firstStream = eventTrack.streams?.[0];
            if (firstStream) {
              attachStreamRef.current(firstStream);
              return;
            }
            const synthetic = addTrackRef.current(eventTrack.track);
            if (synthetic) attachStreamRef.current(synthetic);
          }) as EventListener)
        );
        sessionCleanups.push(
          bindTargetEvent(connection, "addstream", ((eventStream: { stream?: MediaStream }) => {
            if (ownsCurrentSession() && eventStream.stream) {
              attachStreamRef.current(eventStream.stream);
            }
          }) as EventListener)
        );
        sessionCleanups.push(
          bindTargetEvent(connection, "icecandidateerror", ((event: Event) => {
            const iceError = event as Partial<{
              url: string;
              errorCode: number;
              errorText: string;
            }>;
            console.warn("[SIP] ICE candidate error", {
              server: summarizeIceServerUrl(iceError.url),
              errorCode: iceError.errorCode,
              errorText: iceError.errorText,
            });
          }) as EventListener)
        );
        sessionCleanups.push(
          bindTargetEvent(connection, "icegatheringstatechange", (() => {
            if (connection.iceGatheringState === "gathering" && iceGatheringForced) {
              resetIceGatheringWatchdog();
            } else if (connection.iceGatheringState === "complete") {
              clearIceGatheringForceTimer();
              latestIceGatheringReady = null;
              iceGatheringForced = false;
            }
          }) as EventListener)
        );
        sessionCleanups.push(
          bindTargetEvent(connection, "connectionstatechange", (() => {
            activationGate.syncMedia(connection);
            if (
              ownsCurrentSession() &&
              connection.connectionState === "connected" &&
              callMetaRef.current
            ) {
              callMetaRef.current.peerConnectionConnectedAt ??= new Date().toISOString();
            }
          }) as EventListener)
        );
        sessionCleanups.push(
          bindTargetEvent(
            connection,
            "iceconnectionstatechange",
            (() => {
              const iceState = connection.iceConnectionState;
              if (ownsCurrentSession()) {
                setCurrentCall((previous) => ({
                  ...previous,
                  iceState,
                }));
              }
              activationGate.syncMedia(connection);
              if (ownsCurrentSession() && callMetaRef.current) {
                const current = callMetaRef.current as { iceStates?: unknown[] };
                current.iceStates = [
                  ...(current.iceStates ?? []),
                  { state: iceState, at: new Date().toISOString() },
                ];
              }
              if (iceState === "disconnected") {
                scheduleIceRestart(connection);
              } else {
                clearIceRestartTimer();
                iceRestartReadinessRetries = 0;
              }
              if (iceState === "failed") {
                console.error(
                  "[SIP] ICE failed — local connectivity summary",
                  summarizeSdpIceConnectivity(connection.localDescription?.sdp)
                );
                console.error(
                  "[SIP] ICE failed — remote connectivity summary",
                  summarizeSdpIceConnectivity(connection.remoteDescription?.sdp)
                );
              }
              if (
                (iceState === "connected" || iceState === "completed") &&
                confirmedAtPerfRef.current !== null
              ) {
                console.info("[SIP] Media established", {
                  sessionId: session.id,
                  callId: sessionCallIdsRef.current.get(session) ?? null,
                  confirmedToMediaMs: Math.round(performance.now() - confirmedAtPerfRef.current),
                });
                confirmedAtPerfRef.current = null;
              }
            }) as EventListener,
            // JsSIP registers its terminating failed-state listener before the
            // app sees the connection. Capture lets us record the final state
            // before that listener synchronously tears down session handlers.
            { capture: true }
          )
        );
        activationGate.syncMedia(connection);
      };

      sessionCleanups.push(
        bindEmitterEvent(session, "peerconnection", () => bindPeerConnection(session.connection))
      );
      bindPeerConnection(session.connection);
    },
    []
  );

  useEffect(() => {
    if (!wsUri || !uri || !password) {
      return undefined;
    }

    if (uaRebuildDeferredRef.current) {
      // A previous UA instance is still serving an active call (see the
      // deferred teardown below); the rebuild is triggered once it ends.
      return undefined;
    }

    const rawSocket = new JsSIP.WebSocketInterface(wsUri) as unknown as JsSipSocketLike;
    const socket = new SipKeepaliveSocket(rawSocket, {
      pongPolicy: "auto",
      onEvent: (event) => {
        if (event.type === "transport-failed") {
          console.warn("[SIP] WebSocket heartbeat declared the signaling flow unusable", {
            generation: event.generation,
            reason: event.reason ?? null,
          });
        }
      },
    });
    sipSocketRef.current = socket;
    const localUser = uri.replace(/^sip:/i, "").split("@")[0];
    const registrar = registrarServer || (downstreamDomain ? `sip:${downstreamDomain}` : undefined);

    const configuration = {
      sockets: [socket],
      uri,
      instance_id: getOrCreateSipInstanceId(uri),
      password,
      authorization_user: authorizationUser || localUser || undefined,
      display_name: sanitizeSipDisplayName(displayName),
      registrar_server: registrar,
      register: false,
      register_expires: SIP_REGISTER_EXPIRES_SECONDS,
      session_timers: true,
      session_timers_refresh_method: SESSION_TIMERS_REFRESH_METHOD,
      session_timers_force_refresher: SESSION_TIMERS_FORCE_REFRESHER,
      no_answer_timeout: NO_ANSWER_TIMEOUT_SECONDS,
      connection_recovery_max_interval: 30,
      connection_recovery_min_interval: 2,
    };

    const ua = new JsSIP.UA(configuration);
    console.info(
      `[SIP] Session timers: expires=${SIP_SESSION_TIMER_EXPIRES_SECONDS}s, ` +
        `refresh=${SESSION_TIMERS_REFRESH_METHOD}, ` +
        `refresher=${SESSION_TIMERS_FORCE_REFRESHER ? "client" : "peer (negotiated)"}`
    );
    uaRef.current = ua;
    registrationDesiredRef.current = latestRegistrationEnabledRef.current;
    const effectCleanups: CleanupFn[] = [];
    const trackEffectCleanup = (cleanup: CleanupFn) => {
      effectCleanups.push(cleanup);
      return cleanup;
    };

    trackEffectCleanup(
      bindEmitterEvent(ua, "connecting", () => {
        updateLastError(null);
        if (registrationRecoveryRef.current && registrationDesiredRef.current) {
          setIsRegistering(true);
        }
        console.info("[SIP] Connecting to", wsUri);
      })
    );

    trackEffectCleanup(
      bindEmitterEvent(ua, "connected", () => {
        setSignalingConnected(true);
        console.info("[SIP] WebSocket connected", {
          generation: socket.getDiagnostics().generation,
        });
        if (transportDropStartedAtRef.current !== null) {
          const droppedAt = transportDropStartedAtRef.current;
          const downtimeMs = Date.now() - droppedAt;
          transportDropStartedAtRef.current = null;
          recentTransportDropRef.current = {
            droppedAt,
            recoveredAt: Date.now(),
            downtimeMs,
          };
          console.info(`[SIP] WebSocket recovered after ${downtimeMs}ms`);
        }
        if (registrationDesiredRef.current) {
          try {
            setIsRegistering(true);
            ua.register();
          } catch (error) {
            setIsRegistering(false);
            updateLastError(formatCause(error) || "Registration failed");
          }
        }
      })
    );

    trackEffectCleanup(
      bindEmitterEvent(
        ua,
        "registered",
        (event?: {
          response?: {
            getHeader?: (name: string) => unknown;
            getHeaders?: (name: string) => unknown[];
          };
        }) => {
          if (!registrationDesiredRef.current) {
            // A REGISTER response can arrive after the agent switched the
            // webphone off. Immediately undo that late success instead of
            // letting it re-enable automatic registration on reconnect.
            try {
              ua.unregister();
            } catch (error) {
              console.warn("[SIP] Unable to undo late registration", error);
            }
            finishRegistrationRecovery();
            setIsRegistering(false);
            setIsRegistered(false);
            return;
          }

          const allRequireHeaders = event?.response?.getHeaders?.("Require") ?? [];
          const requireHeaders =
            allRequireHeaders.length > 0
              ? allRequireHeaders
              : [event?.response?.getHeader?.("Require")];
          const requiresOutbound = requireHeaders
            .filter((header) => header != null)
            .flatMap((header) => String(header).split(","))
            .some((token) => token.trim().toLowerCase() === "outbound");
          if (requiresOutbound) {
            // Keep auto mode observational until this exact WSS generation
            // returns an actual single-CRLF pong. A misconfigured registrar
            // must never make the browser tear down an otherwise live call.
            console.info(
              "[SIP] Registrar advertised RFC 5626 outbound; awaiting CRLF pong confirmation"
            );
          }
          finishRegistrationRecovery();
          setIsRegistering(false);
          setIsRegistered(true);
          updateLastError(null);
          firstConnectionRef.current = false;
          console.info("[SIP] Registered as", uri);
        }
      )
    );

    trackEffectCleanup(
      bindEmitterEvent(ua, "unregistered", () => {
        setIsRegistered(false);
        setIsRegistering(registrationRecoveryRef.current && registrationDesiredRef.current);
        console.info("[SIP] Unregistered");
      })
    );

    trackEffectCleanup(
      bindEmitterEvent(ua, "registrationFailed", (event: SipFailureEvent) => {
        const message = formatSipFailure(event, "Registration failed");
        const transientConnectionFailure =
          registrationDesiredRef.current &&
          (isTransientSipConnectionError(formatCause(event?.cause), message) ||
            shouldSuppressTransientSipRecovery());

        finishRegistrationRecovery();
        setIsRegistering(false);
        setIsRegistered(false);

        if (transientConnectionFailure) {
          updateLastError(null);
        } else {
          updateLastError(message);
          onRegistrationFailedRef.current?.(event?.cause);
        }
        console.warn("[SIP] Registration failed", event?.cause);
      })
    );

    trackEffectCleanup(
      bindEmitterEvent(
        ua,
        "disconnected",
        (eventData: { error?: boolean; code?: number; reason?: string }) => {
          setSignalingConnected(false);
          setIsRegistered(false);
          setIsRegistering(registrationRecoveryRef.current && registrationDesiredRef.current);
          if (currentCallStateRef.current === CALL_STATES.IDLE) {
            resetCallRef.current();
          }
          transportDropStartedAtRef.current = Date.now();
          const heartbeat = socket.getDiagnostics();
          if (callMetaRef.current) {
            const transportDrops = Array.isArray(callMetaRef.current.transportDrops)
              ? callMetaRef.current.transportDrops.slice(-(MAX_RECORDED_SIGNALING_DROPS - 1))
              : [];
            transportDrops.push({
              at: new Date().toISOString(),
              abrupt: Boolean(eventData?.error),
              closeCode: eventData?.code ?? null,
              closeReason: eventData?.reason?.trim() || null,
              heartbeat,
            });
            callMetaRef.current.transportDrops = transportDrops;
          }
          console.warn("[SIP] Disconnected from WebSocket", {
            abrupt: Boolean(eventData?.error),
            closeCode: eventData?.code ?? null,
            closeReason: eventData?.reason?.trim() || null,
            heartbeat,
          });
        }
      )
    );

    trackEffectCleanup(
      bindEmitterEvent(
        ua,
        "newRTCSession",
        (event: { session: JsSIPSession; request?: { call_id?: string } }) => {
          const session = event.session;
          sessionCallIdsRef.current.set(
            session,
            typeof event.request?.call_id === "string" ? event.request.call_id : null
          );
          const direction = session.direction;

          // Suppress new incoming SIP offers while local ACW is active. The PBX
          // remains responsible for retaining/re-routing the caller and issuing
          // a new INVITE once this agent becomes eligible again.
          const nowMs = Date.now();
          const wrapUpActive = wrapUpDeadlineRef.current > nowMs;
          if (!wrapUpActive && wrapUpRemainingSecondsRef.current > 0) stopWrapUp();
          let rejectedDuringWrapUp = false;
          try {
            rejectedDuringWrapUp = rejectIncomingDuringWrapUp({
              direction,
              enabled: WRAP_UP_REJECT_INCOMING,
              wrapUpDeadlineMs: wrapUpDeadlineRef.current,
              nowMs,
              primarySessionClear: !sessionRef.current || sessionRef.current.isEnded?.() === true,
              terminate: (options) => session.terminate(options),
            });
          } catch (error) {
            // If JsSIP cannot send the final response, continue through normal
            // incoming-call setup rather than leave an untracked INVITE alive.
            console.warn("[SIP] Failed to decline incoming call during wrap-up", error);
          }
          if (rejectedDuringWrapUp) {
            console.warn("[SIP] Declined incoming call during wrap-up", {
              sessionId: session.id,
              callId: sessionCallIdsRef.current.get(session) ?? null,
              wrapUpRemainingSeconds: wrapUpRemainingSecondsRef.current,
            });
            return;
          }

          stopSelfTest("call-started");
          stopTone(endingToneRef);
          stopTone(previewToneRef);
          const normalizedDirection = normalizeDirection(direction) || "out";
          const sessionCleanups: CleanupFn[] = [];
          // Per-call setup timing: "accepted" fires when the 200 OK is sent
          // (only after ICE gathering completes — JsSIP resolves the answer
          // SDP on gathering complete, RTCSession.js) and "confirmed" when
          // the PBX ACK arrives. The gaps bracket gathering and the ACK
          // round-trip, the two client-side components of setup delay.
          let acceptedAtPerf: number | null = null;
          const cleanupSessionHandlers = () => runCleanups(sessionCleanups);
          trackEffectCleanup(cleanupSessionHandlers);

          // Agent is already on a call: decline with 486 Busy Here (RFC 3261
          // §21.4.23 — a UAS that is engaged and cannot accept a new INVITE
          // returns 486). The PBX re-queues the caller or routes it to another
          // agent; queue members wait in the queue, so no call waiting is
          // needed. One call at a time is standard contact-center practice.
          const existingSession = sessionRef.current;
          const hasLiveSession =
            existingSession &&
            typeof existingSession.isEnded === "function" &&
            !existingSession.isEnded();
          if (direction === "incoming" && hasLiveSession) {
            console.warn("[SIP] Declined incoming call while on a call", {
              sessionId: session.id,
              callId: sessionCallIdsRef.current.get(session) ?? null,
              activeSessionId: existingSession?.id ?? null,
            });
            try {
              session.terminate({
                status_code: 486,
                reason_phrase: "Busy Here",
              });
            } catch (error) {
              console.warn("[SIP] Failed to decline incoming call while on a call", error);
            }
            return;
          }

          // ===== CALL WAITING DISABLED (INVITE handler: call-waiting park branch) — second calls are declined with 486 Busy Here. Kept for reference. =====
          //           // live (unreachable while the 486 gate above is active): park it
          //           // separately so the active call's state (and End button) stays intact.
          //           if (
          //             direction === "incoming" &&
          //             existingSession &&
          //             typeof existingSession.isEnded === "function" &&
          //             !existingSession.isEnded()
          //           ) {
          //             pendingIncomingSessionRef.current = session;
          //             setPendingIncomingCall({
          //               id: session.id,
          //               state: CALL_STATES.INCOMING,
          //               direction: "incoming",
          //               remote: formatIdentity(session.remote_identity),
          //               muted: false,
          //               onHold: false,
          //               duration: 0,
          //               startTime: null,
          //               iceState: null,
          //             });
          //             startInboundRingTone();
          //
          //             sessionCleanups.push(
          //               bindEmitterEvent(session, "ended", () => {
          //                 if (pendingIncomingSessionRef.current === session) {
          //                   pendingIncomingSessionRef.current = null;
          //                   setPendingIncomingCall(initialCallState);
          //                   stopInboundRingTone();
          //                 }
          //                 cleanupSessionHandlers();
          //               })
          //             );
          //
          //             sessionCleanups.push(
          //               bindEmitterEvent(session, "failed", (eventData?: unknown) => {
          //                 if (pendingIncomingSessionRef.current === session) {
          //                   const event = eventData as SipFailureEvent | null;
          //                   const response = getSipResponseDetails(eventData);
          //                   console.warn("[SIP] Parked incoming call failed before it was answered", {
          //                     sessionId: session.id,
          //                     cause: formatCause(event?.cause) ?? null,
          //                     statusCode: response?.status_code ?? null,
          //                     reasonPhrase: response?.reason_phrase?.trim() || null,
          //                   });
          //                   pendingIncomingSessionRef.current = null;
          //                   setPendingIncomingCall(initialCallState);
          //                   stopInboundRingTone();
          //                 }
          //                 cleanupSessionHandlers();
          //               })
          //             );
          //
          //             return; // Do not process as the primary call
          //           }
          // ===== END: CALL WAITING DISABLED =====

          sessionRef.current = session;

          callMetaRef.current = {
            sessionId: session.id,
            callSid: sessionCallIdsRef.current.get(session) ?? null,
            direction: normalizedDirection,
            createdAt: new Date().toISOString(),
            iceConfig: summarizeIceConfiguration(
              iceServersRef.current,
              iceTransportPolicyRef.current
            ),
            audioInput: audioInputDiagnosticsRef.current,
            iceStates: [],
            remoteIdentity: formatIdentity(session.remote_identity),
            localIdentity: formatIdentity(session.local_identity),
          };

          const updateCall = (changes: Partial<CurrentCallState>) => {
            // Keep the dialed displayName (set in makeCall) while the To-URI
            // carries no display name; progress events would otherwise blank it.
            const remoteIdentity = formatIdentity(session.remote_identity);
            const derivedRemote =
              remoteIdentity &&
              !remoteIdentity.displayName &&
              currentCallRef.current.remote?.displayName
                ? { ...remoteIdentity, displayName: currentCallRef.current.remote.displayName }
                : remoteIdentity;
            if (callMetaRef.current) {
              callMetaRef.current.remoteIdentity = derivedRemote;
              callMetaRef.current.localIdentity = formatIdentity(session.local_identity);
              callMetaRef.current.lastState = {
                state: changes.state ?? currentCallRef.current.state,
                at: new Date().toISOString(),
              };
            }

            setCurrentCall((prev) => {
              return {
                ...prev,
                id: session.id,
                direction,
                remote: derivedRemote,
                ...changes,
              };
            });
          };

          const startDurationTimer = () => {
            if (timerRef.current) {
              clearInterval(timerRef.current);
            }
            timerRef.current = setInterval(() => {
              setCurrentCall((prev) => ({
                ...prev,
                duration: prev.startTime
                  ? Math.floor((Date.now() - prev.startTime) / 1000)
                  : prev.duration,
              }));
            }, 1000);
          };

          const activationGate = createSessionActivationGate(
            () => {
              if (sessionRef.current !== session) return;
              const startedAt = Date.now();
              updateCall({
                state: CALL_STATES.ACTIVE,
                startTime: startedAt,
                duration: 0,
              });
              if (callMetaRef.current) {
                callMetaRef.current.mediaConnectedAt = new Date(startedAt).toISOString();
                callMetaRef.current.startedAtMs = startedAt;
              }
              startDurationTimer();
            },
            {
              activationTimeoutMs: SESSION_ACTIVATION_TIMEOUT_MS,
              onActivationTimeout: () =>
                reportSessionActivationIssue(session, SESSION_ACTIVATION_TIMEOUT_MESSAGE),
              onConnectivityFailure: () =>
                reportSessionActivationIssue(session, SESSION_CONNECTIVITY_FAILURE_MESSAGE),
            }
          );
          sessionActivationGateRef.current.set(session, activationGate);
          sessionCleanups.push(() => {
            if (sessionActivationGateRef.current.get(session) === activationGate) {
              sessionActivationGateRef.current.delete(session);
            }
            setupFailureReasonRef.current.delete(session);
          });
          sessionCleanups.push(activationGate.dispose);

          bindSessionConnectivityHandlers(session, activationGate, sessionCleanups);

          sessionCleanups.push(
            bindEmitterEvent(session, "progress", () => {
              updateCall({
                state: direction === "outgoing" ? CALL_STATES.RINGING : CALL_STATES.INCOMING,
              });
              if (callMetaRef.current && !callMetaRef.current.progressedAt) {
                callMetaRef.current.progressedAt = new Date().toISOString();
              }
              if (direction === "outgoing") {
                startRingbackTone();
              } else {
                startInboundRingTone();
              }
            })
          );

          sessionCleanups.push(
            bindEmitterEvent(session, "accepted", () => {
              if (answeringSessionRef.current === session) {
                answeringSessionRef.current = null;
              }
              const acceptedAt = performance.now();
              acceptedAtPerf = acceptedAt;
              if (direction === "incoming") {
                const answerRequestedAt = answerRequestedAtPerfRef.current;
                const answerToAcceptedMs =
                  typeof answerRequestedAt === "number"
                    ? Math.round(acceptedAt - answerRequestedAt)
                    : null;
                answerRequestedAtPerfRef.current = null;
                console.info("[SIP] Incoming session accepted", {
                  sessionId: session.id,
                  callId: sessionCallIdsRef.current.get(session) ?? null,
                  answerToAcceptedMs,
                });
              }
              updateCall({
                state: CALL_STATES.CONNECTING,
                startTime: null,
                duration: 0,
                muted: false,
                onHold: false,
              });
              if (callMetaRef.current) {
                callMetaRef.current.acceptedAt = new Date().toISOString();
              }
              activationGate.markAccepted(session.connection);
              stopRingbackTone();
              stopInboundRingTone();
              const connection = session.connection;
              if (connection) {
                const syncStreams = () => {
                  // The connection can close between "accepted" firing and this
                  // running (immediate hangup, or the 200ms retry below) —
                  // reading streams off a closed connection throws.
                  if (sessionRef.current !== session || connection.signalingState === "closed") {
                    return;
                  }
                  let remote: MediaStream | null = null;
                  try {
                    if (typeof connection.getReceivers === "function") {
                      const tracks = connection
                        .getReceivers()
                        .flatMap((receiver: RTCRtpReceiver) =>
                          receiver.track ? [receiver.track] : []
                        );
                      if (tracks.length) {
                        remote = new MediaStream();
                        tracks.forEach((track: MediaStreamTrack) => remote!.addTrack(track));
                      }
                    }
                    if (
                      (!remote || !remote.getTracks().length) &&
                      typeof connection.getRemoteStreams === "function"
                    ) {
                      const legacy = connection.getRemoteStreams();
                      if (legacy && legacy.length) {
                        remote = legacy[0];
                      }
                    }
                  } catch {
                    return;
                  }
                  if (remote && remote.getTracks().length) {
                    attachStreamRef.current(remote);
                  }
                };
                syncStreams();
                const streamSyncTimer = window.setTimeout(syncStreams, 200);
                sessionCleanups.push(() => window.clearTimeout(streamSyncTimer));
              }
              const speakerPreference =
                typeof speakerEnabledRef.current === "boolean" ? speakerEnabledRef.current : true;
              applySpeakerPreference(speakerPreference);
              startDiagnosticsInterval(session);
            })
          );

          sessionCleanups.push(
            bindEmitterEvent(session, "confirmed", () => {
              if (callMetaRef.current) {
                callMetaRef.current.confirmedAt = new Date().toISOString();
              }
              if (direction === "incoming") {
                console.info("[SIP] Incoming session confirmed", {
                  sessionId: session.id,
                  callId: sessionCallIdsRef.current.get(session) ?? null,
                  acceptedToConfirmedMs:
                    typeof acceptedAtPerf === "number"
                      ? Math.round(performance.now() - acceptedAtPerf)
                      : null,
                });
              } else if (direction === "outgoing") {
                confirmedAtPerfRef.current = performance.now();
                const dialRequestedAt = dialRequestedAtPerfRef.current;
                const dialToConfirmedMs =
                  typeof dialRequestedAt === "number"
                    ? Math.round(performance.now() - dialRequestedAt)
                    : null;
                dialRequestedAtPerfRef.current = null;
                console.info("[SIP] Outgoing session confirmed", {
                  sessionId: session.id,
                  callId: sessionCallIdsRef.current.get(session) ?? null,
                  dialToConfirmedMs,
                });
              }
              activationGate.markConfirmed(session.connection);
            })
          );

          sessionCleanups.push(
            bindEmitterEvent(session, "ended", (eventData?: unknown) => {
              if (answeringSessionRef.current === session) {
                answeringSessionRef.current = null;
              }
              const endedLocally = locallyTerminatedSessionRef.current === session;
              if (endedLocally) {
                locallyTerminatedSessionRef.current = null;
              }
              const suppressEndTone = suppressEndToneSessionRef.current === session;
              if (suppressEndTone) {
                suppressEndToneSessionRef.current = null;
              }
              const setupFailureReason = setupFailureReasonRef.current.get(session);
              setupFailureReasonRef.current.delete(session);
              if (sessionRef.current !== session) {
                cleanupSessionHandlers();
                return;
              }
              const response = getSipResponseDetails(eventData);
              const termination = classifySipSessionEnd({
                cause: formatCause((eventData as SipFailureEvent | null)?.cause),
                formattedFailure: formatSipFailure(eventData, "Call failed"),
                hadConnectedMedia: Boolean(callMetaRef.current?.mediaConnectedAt),
                endedLocally,
                reasonPhrase: response?.reason_phrase,
                setupFailureReason,
                statusCode: response?.status_code,
              });
              const terminalState = termination.failed ? CALL_STATES.FAILED : CALL_STATES.ENDED;
              logSessionTermination(
                "Call ended",
                session.id,
                eventData,
                termination,
                getTransportDropMsBefore(),
                getRecentTransportDropBefore()
              );
              if (callMetaRef.current?.mediaConnectedAt) {
                startWrapUp();
              }
              updateCall({ state: terminalState });
              if (termination.message) {
                updateLastError(termination.message);
              }
              stopRingbackTone();
              stopHoldTone();
              emitSessionCallSummary(
                session,
                termination.failed ? "failed" : "ended",
                eventData,
                termination.failureKind
              ).catch(() => {});
              resetCallRef.current({ state: terminalState });
              if (!suppressEndTone) {
                if (termination.failed) playCallFailedTone();
                else playCallEndedTone();
              }
              cleanupSessionHandlers();
            })
          );

          sessionCleanups.push(
            bindEmitterEvent(session, "failed", (eventData?: unknown) => {
              if (answeringSessionRef.current === session) {
                answeringSessionRef.current = null;
              }
              const failedLocally = locallyTerminatedSessionRef.current === session;
              if (failedLocally) {
                locallyTerminatedSessionRef.current = null;
              }
              const setupFailureReason = setupFailureReasonRef.current.get(session);
              setupFailureReasonRef.current.delete(session);
              if (sessionRef.current !== session) {
                cleanupSessionHandlers();
                return;
              }
              const response = getSipResponseDetails(eventData);
              const termination = classifySipSessionEnd({
                cause: formatCause((eventData as SipFailureEvent | null)?.cause),
                formattedFailure: formatSipFailure(eventData, "Call failed"),
                hadConnectedMedia: Boolean(callMetaRef.current?.mediaConnectedAt),
                endedLocally: failedLocally,
                reasonPhrase: response?.reason_phrase,
                setupFailureReason,
                statusCode: response?.status_code,
              });
              logSessionTermination(
                "Call failed",
                session.id,
                eventData,
                termination,
                getTransportDropMsBefore(),
                getRecentTransportDropBefore()
              );
              if (callMetaRef.current?.mediaConnectedAt) {
                startWrapUp();
              }
              updateCall({ state: CALL_STATES.FAILED });
              updateLastError(
                setupFailureReason ||
                  formatNoAnswerFailure(eventData, direction === "incoming", "Call failed")
              );
              stopRingbackTone();
              stopHoldTone();
              emitSessionCallSummary(session, "failed", eventData).catch(() => {});
              resetCallRef.current({ state: CALL_STATES.FAILED });
              if (!failedLocally) {
                playCallFailedTone();
              }
              cleanupSessionHandlers();
            })
          );

          sessionCleanups.push(
            bindEmitterEvent(session, "hold", () => {
              localHoldFallbackRef.current = false;
              updateCall({ onHold: true });
            })
          );

          sessionCleanups.push(
            bindEmitterEvent(session, "unhold", () => {
              localHoldFallbackRef.current = false;
              updateCall({ onHold: false });
            })
          );

          sessionCleanups.push(
            bindEmitterEvent(session, "muted", () => {
              updateCall({ muted: true });
            })
          );

          sessionCleanups.push(
            bindEmitterEvent(session, "unmuted", () => {
              updateCall({ muted: false });
            })
          );

          // PBX-initiated transfers: JsSIP auto-rejects in-dialog REFER and
          // Replaces when no handler is bound (403/486). Accepting the request
          // makes JsSIP fire a newRTCSession for the transferred leg, which is
          // handled by the incoming-call flow above (ring/park/answer).
          sessionCleanups.push(
            bindEmitterEvent(
              session,
              "refer",
              (event: { request?: { to?: unknown }; accept: () => void; reject: () => void }) => {
                console.info("[SIP] Received in-dialog REFER (PBX transfer)", {
                  sessionId: session.id,
                  target: String(event.request?.to ?? ""),
                });
                event.accept();
              }
            )
          );

          sessionCleanups.push(
            bindEmitterEvent(
              session,
              "replaces",
              (event: {
                request?: { call_id?: unknown };
                accept: () => void;
                reject: () => void;
              }) => {
                console.info("[SIP] Received Replaces INVITE (attended transfer takeover)", {
                  sessionId: session.id,
                  callId: String(event.request?.call_id ?? ""),
                });
                event.accept();
              }
            )
          );

          // Without a callback JsSIP auto-processes in-dialog UPDATEs (answers
          // the re-INVITE); bind only to log the event for diagnostics.
          sessionCleanups.push(
            bindEmitterEvent(session, "update", () => {
              console.info("[SIP] Received in-dialog UPDATE", { sessionId: session.id });
            })
          );

          if (direction === "incoming") {
            updateCall({ state: CALL_STATES.INCOMING });
            startInboundRingTone();
          } else {
            updateCall({ state: CALL_STATES.DIALING });
          }
        }
      )
    );

    ua.start();

    return () => {
      const liveSessions = [
        sessionRef.current,
        answeringSessionRef.current,
        pendingIncomingSessionRef.current,
      ].filter((session): session is JsSIPSession => Boolean(session && !session.isEnded?.()));

      if (liveSessions.length > 0) {
        // ua.stop() terminates any active session, so a settings change
        // (e.g. credential refresh) must not tear the UA down mid-call.
        // Keep the current UA alive until every live session has ended,
        // then stop it and trigger a rebuild via uaGeneration. These
        // listeners are bound to the sessions themselves and intentionally
        // survive any further effect re-runs while still deferred.
        uaRebuildDeferredRef.current = true;
        const finishDeferredTeardown = () => {
          if (!uaRebuildDeferredRef.current) return;
          const stillLive = [
            sessionRef.current,
            answeringSessionRef.current,
            // Intentionally read the latest ref during deferred cleanup; a snapshot
            // from effect setup could miss a replacement incoming session.
            // eslint-disable-next-line react-hooks/exhaustive-deps
            pendingIncomingSessionRef.current,
          ].some((session) => session && !session.isEnded?.());
          if (stillLive) return;

          uaRebuildDeferredRef.current = false;
          runCleanups(effectCleanups);
          finishRegistrationRecovery();
          ua.removeAllListeners();
          ua.stop();
          if (sipSocketRef.current === socket) sipSocketRef.current = null;
          uaRef.current = null;
          registrationDesiredRef.current = false;
          setSignalingConnected(false);
          setIsRegistered(false);
          setIsRegistering(false);
          setUaGeneration((generation) => generation + 1);
        };

        liveSessions.forEach((session) => {
          bindEmitterEvent(session, "ended", () => finishDeferredTeardown());
          bindEmitterEvent(session, "failed", () => finishDeferredTeardown());
        });

        // A session may terminate between the liveness check and listener binding.
        finishDeferredTeardown();
        return;
      }

      runCleanups(effectCleanups);
      finishRegistrationRecovery();
      ua.removeAllListeners();
      ua.stop();
      if (sipSocketRef.current === socket) sipSocketRef.current = null;
      uaRef.current = null;
      registrationDesiredRef.current = false;
      resetCallRef.current();
      setSignalingConnected(false);
      setIsRegistered(false);
      setIsRegistering(false);
    };
  }, [
    wsUri,
    uri,
    password,
    authorizationUser,
    displayName,
    SESSION_TIMERS_FORCE_REFRESHER,
    SESSION_TIMERS_REFRESH_METHOD,
    WRAP_UP_REJECT_INCOMING,
    emitSessionCallSummary,
    registrarServer,
    downstreamDomain,
    applySpeakerPreference,
    bindSessionConnectivityHandlers,
    sampleDiagnostics,
    playCallEndedTone,
    playCallFailedTone,
    startDiagnosticsInterval,
    startInboundRingTone,
    startRingbackTone,
    stopHoldTone,
    stopInboundRingTone,
    stopRingbackTone,
    stopTone,
    stopSelfTest,
    shouldSuppressTransientSipRecovery,
    finishRegistrationRecovery,
    reportSessionActivationIssue,
    startWrapUp,
    stopWrapUp,
    updateLastError,
    uaGeneration,
  ]);

  useEffect(() => {
    // Safety net for the deferred-teardown path: if this component unmounts
    // while a UA rebuild is deferred (active call), stop the lingering UA
    // instead of leaking its WebSocket connection.
    return () => {
      if (uaRebuildDeferredRef.current && uaRef.current) {
        uaRebuildDeferredRef.current = false;
        uaRef.current.removeAllListeners();
        uaRef.current.stop();
        sipSocketRef.current = null;
        uaRef.current = null;
      }
      uaRebuildDeferredRef.current = false;
    };
  }, []);

  useEffect(() => {
    const credentialsReady = Boolean(wsUri && uri && password);
    if (credentialsReady && !registrationCredentialsReadyRef.current) {
      setRegistrationEnabled(true);
    }
    registrationCredentialsReadyRef.current = credentialsReady;
  }, [password, setRegistrationEnabled, uri, wsUri]);

  const makeCall = useCallback(
    async (target: string | DialTargetInput) => {
      const ua = uaRef.current;
      if (!ua) {
        throw new Error("SIP client not initialised.");
      }
      stopWrapUp();
      if (!registrationEnabled) {
        throw new Error("Webphone is disabled. Enable it in Settings before placing a call.");
      }
      if (
        registrationRecoveryRef.current ||
        !isRegistered ||
        !ua.isConnected() ||
        !ua.isRegistered()
      ) {
        if (registrationRecoveryRef.current || !ua.isConnected()) {
          throw new Error("Webphone is reconnecting. Please wait until it is online.");
        }
        throw new Error("Webphone is not registered. Please connect before calling.");
      }
      if (sessionRef.current && !sessionRef.current.isEnded()) {
        throw new Error("A call is already in progress.");
      }

      const formattedTarget = DIAL_TARGET_FORMATTER(toDialTargetInput(target));
      const sipUri = ensureSipUri(formattedTarget, downstreamDomain);
      if (!sipUri) {
        throw new Error("Invalid target for outbound call.");
      }

      let streamPendingSession: MediaStream | null = null;
      try {
        const outboundCallOptions = await createCallOptionsWithAudio();
        streamPendingSession = outboundCallOptions.mediaStream;
        updateLastError(null);
        dialRequestedAtPerfRef.current = performance.now();
        const session = ua.call(sipUri, outboundCallOptions);
        streamPendingSession = null;
        sessionRef.current = session;
        sessionActivationGateRef.current.get(session)?.start();
        setCurrentCall({
          id: session.id,
          state: CALL_STATES.DIALING,
          direction: "outgoing",
          remote: { uri: sipUri, displayName: toDialTargetInput(target).number },
          muted: false,
          onHold: false,
          duration: 0,
          startTime: null,
          iceState: null,
        });
      } catch (error) {
        if (streamPendingSession) {
          if (localInputStreamRef.current === streamPendingSession) {
            releaseLocalInputStream();
          } else {
            stopStream(streamPendingSession);
          }
          disposeNoiseSuppression();
        }
        throw new Error(
          deviceError || formatCause(error) || "Microphone permission is required to place a call."
        );
      }
    },
    [
      DIAL_TARGET_FORMATTER,
      createCallOptionsWithAudio,
      deviceError,
      downstreamDomain,
      isRegistered,
      releaseLocalInputStream,
      registrationEnabled,
      stopWrapUp,
      updateLastError,
    ]
  );

  const endCall = useCallback(() => {
    const session = sessionRef.current;
    if (!session || session.isEnded()) {
      resetCall({ state: CALL_STATES.ENDED });
      return;
    }

    locallyTerminatedSessionRef.current = session;
    try {
      // JsSIP's terminate() picks the correct signal itself (CANCEL for early
      // dialogs, a non-2xx response for unanswered incoming calls, BYE for
      // established calls). There is no bye()/cancel() in the public API.
      session.terminate();
    } catch {
      try {
        session.terminate();
      } catch {
        // Fall through to fallback cleanup below.
      }
    }

    if (hangupFallbackTimerRef.current) {
      clearTimeout(hangupFallbackTimerRef.current);
    }
    // If ended/failed event doesn't arrive, fail-safe local cleanup.
    hangupFallbackTimerRef.current = setTimeout(() => {
      const activeSession = sessionRef.current;
      if (activeSession && !activeSession.isEnded()) {
        try {
          activeSession.terminate();
        } catch {
          // Ignore and reset local call state to prevent stuck UI.
        }
      }
      resetCall({ state: CALL_STATES.ENDED });
      if (locallyTerminatedSessionRef.current === session) {
        locallyTerminatedSessionRef.current = null;
      }
    }, 5000);
  }, [resetCall]);

  const answerCall = useCallback(async () => {
    if (answeringSessionRef.current) return;

    // ===== CALL WAITING DISABLED (answerCall: pending (secondary) incoming answer path) — second calls are declined with 486 Busy Here. Kept for reference. =====
    //
    //     // Answering the secondary incoming call: end the active call first, then answer.
    //     if (pendingSession && !pendingSession.isEnded?.()) {
    //       answeringSessionRef.current = pendingSession;
    //
    //       let answerOptions: Awaited<ReturnType<typeof createCallOptionsWithAudio>>;
    //       try {
    //         answerOptions = await createCallOptionsWithAudio(false);
    //       } catch (error) {
    //         if (answeringSessionRef.current === pendingSession) {
    //           answeringSessionRef.current = null;
    //         }
    //         if (
    //           pendingIncomingSessionRef.current === pendingSession &&
    //           pendingSession.isInProgress?.()
    //         ) {
    //           startInboundRingTone();
    //         }
    //         console.warn("[SIP] Failed to prepare secondary incoming session", error);
    //         updateLastError(formatCause(error));
    //         return;
    //       }
    //
    //       if (pendingIncomingSessionRef.current !== pendingSession || pendingSession.isEnded?.()) {
    //         stopStream(answerOptions.mediaStream);
    //         if (answeringSessionRef.current === pendingSession) {
    //           answeringSessionRef.current = null;
    //         }
    //         return;
    //       }
    //
    //       const activeSession = sessionRef.current;
    //       let activeTerminationFailed = false;
    //       if (activeSession && !activeSession.isEnded?.()) {
    //         locallyTerminatedSessionRef.current = activeSession;
    //         // Switching calls, not hanging up — don't play the drop tone for this end.
    //         suppressEndToneSessionRef.current = activeSession;
    //         try {
    //           activeSession.terminate();
    //         } catch {
    //           activeTerminationFailed = true;
    //         }
    //       }
    //
    //       if (activeTerminationFailed) {
    //         if (locallyTerminatedSessionRef.current === activeSession) {
    //           locallyTerminatedSessionRef.current = null;
    //         }
    //         if (suppressEndToneSessionRef.current === activeSession) {
    //           suppressEndToneSessionRef.current = null;
    //         }
    //         stopStream(answerOptions.mediaStream);
    //         if (answeringSessionRef.current === pendingSession) {
    //           answeringSessionRef.current = null;
    //         }
    //         if (
    //           pendingIncomingSessionRef.current === pendingSession &&
    //           pendingSession.isInProgress?.()
    //         ) {
    //           startInboundRingTone();
    //         }
    //         updateLastError("Unable to end the current call. The incoming call was not answered.");
    //         return;
    //       }
    //
    //       if (pendingIncomingSessionRef.current !== pendingSession || pendingSession.isEnded?.()) {
    //         stopStream(answerOptions.mediaStream);
    //         if (answeringSessionRef.current === pendingSession) {
    //           answeringSessionRef.current = null;
    //         }
    //         return;
    //       }
    //
    //       // Promote only after the old call has released its owned microphone. If
    //       // its ended event arrives later, the session identity guard prevents it
    //       // from resetting this new stream.
    //       pendingIncomingSessionRef.current = null;
    //       sessionRef.current = pendingSession;
    //       answeringSessionRef.current = pendingSession;
    //       releaseLocalInputStream(answerOptions.mediaStream);
    //       callMetaRef.current = {
    //         sessionId: pendingSession.id,
    //         callSid: sessionCallIdsRef.current.get(pendingSession) ?? null,
    //         direction: "in",
    //         createdAt: new Date().toISOString(),
    //         iceConfig: summarizeIceConfiguration(iceServers, iceTransportPolicy),
    //         audioInput: audioInputDiagnosticsRef.current,
    //         iceStates: [],
    //         remoteIdentity: formatIdentity(pendingSession.remote_identity),
    //         localIdentity: formatIdentity(pendingSession.local_identity),
    //       };
    //       setPendingIncomingCall(initialCallState);
    //       stopInboundRingTone();
    //
    //       // Register primary event handlers on the promoted session.
    //       promotedSessionCleanupRef.current?.();
    //       const promotedSessionCleanups: CleanupFn[] = [];
    //       let promotedSessionCleanedUp = false;
    //       const cleanupPromotedSessionHandlers = () => {
    //         if (promotedSessionCleanedUp) return;
    //         promotedSessionCleanedUp = true;
    //         if (promotedSessionCleanupRef.current === cleanupPromotedSessionHandlers) {
    //           promotedSessionCleanupRef.current = null;
    //         }
    //         runCleanups(promotedSessionCleanups);
    //       };
    //       promotedSessionCleanupRef.current = cleanupPromotedSessionHandlers;
    //
    //       const promotedActivationGate = createSessionActivationGate(
    //         () => {
    //           if (sessionRef.current !== pendingSession) return;
    //           const startedAt = Date.now();
    //           setCurrentCall((previous) => ({
    //             ...previous,
    //             id: pendingSession.id,
    //             state: CALL_STATES.ACTIVE,
    //             startTime: startedAt,
    //             duration: 0,
    //           }));
    //           if (callMetaRef.current) {
    //             callMetaRef.current.mediaConnectedAt = new Date(startedAt).toISOString();
    //             callMetaRef.current.startedAtMs = startedAt;
    //           }
    //           if (timerRef.current) clearInterval(timerRef.current);
    //           timerRef.current = setInterval(() => {
    //             setCurrentCall((previous) => ({
    //               ...previous,
    //               duration: previous.startTime
    //                 ? Math.floor((Date.now() - previous.startTime) / 1000)
    //                 : previous.duration,
    //             }));
    //           }, 1000);
    //         },
    //         {
    //           activationTimeoutMs: SESSION_ACTIVATION_TIMEOUT_MS,
    //           onActivationTimeout: () =>
    //             reportSessionActivationIssue(pendingSession, SESSION_ACTIVATION_TIMEOUT_MESSAGE),
    //           onConnectivityFailure: () =>
    //             reportSessionActivationIssue(pendingSession, SESSION_CONNECTIVITY_FAILURE_MESSAGE),
    //         }
    //       );
    //       sessionActivationGateRef.current.set(pendingSession, promotedActivationGate);
    //       promotedSessionCleanups.push(() => {
    //         if (sessionActivationGateRef.current.get(pendingSession) === promotedActivationGate) {
    //           sessionActivationGateRef.current.delete(pendingSession);
    //         }
    //         setupFailureReasonRef.current.delete(pendingSession);
    //       });
    //       promotedSessionCleanups.push(promotedActivationGate.dispose);
    //
    //       bindSessionConnectivityHandlers(
    //         pendingSession,
    //         promotedActivationGate,
    //         promotedSessionCleanups
    //       );
    //
    //       promotedSessionCleanups.push(
    //         bindEmitterEvent(pendingSession, "accepted", () => {
    //           if (answeringSessionRef.current === pendingSession) {
    //             answeringSessionRef.current = null;
    //           }
    //           console.info("[SIP] Incoming session accepted", {
    //             sessionId: pendingSession.id,
    //             callId: sessionCallIdsRef.current.get(pendingSession) ?? null,
    //           });
    //           if (sessionRef.current !== pendingSession) return;
    //           setCurrentCall((previous) => ({
    //             ...previous,
    //             id: pendingSession.id,
    //             state: CALL_STATES.CONNECTING,
    //             startTime: null,
    //             duration: 0,
    //             muted: false,
    //             onHold: false,
    //           }));
    //           if (callMetaRef.current) {
    //             callMetaRef.current.acceptedAt = new Date().toISOString();
    //           }
    //           promotedActivationGate.markAccepted(pendingSession.connection);
    //           stopRingbackTone();
    //           stopInboundRingTone();
    //           const connection = pendingSession.connection;
    //           if (connection) {
    //             const syncStreams = () => {
    //               // The connection can close between "accepted" firing and this
    //               // running (immediate hangup, or the 200ms retry below) —
    //               // reading streams off a closed connection throws.
    //               if (sessionRef.current !== pendingSession || connection.signalingState === "closed") {
    //                 return;
    //               }
    //               let remote: MediaStream | null = null;
    //               try {
    //                 if (typeof connection.getReceivers === "function") {
    //                   const tracks = connection
    //                     .getReceivers()
    //                     .flatMap((r: RTCRtpReceiver) => (r.track ? [r.track] : []));
    //                   if (tracks.length) {
    //                     remote = new MediaStream();
    //                     tracks.forEach((t: MediaStreamTrack) => remote!.addTrack(t));
    //                   }
    //                 }
    //                 if (
    //                   (!remote || !remote.getTracks().length) &&
    //                   typeof connection.getRemoteStreams === "function"
    //                 ) {
    //                   const legacy = connection.getRemoteStreams();
    //                   if (legacy?.length) remote = legacy[0];
    //                 }
    //               } catch {
    //                 return;
    //               }
    //               if (remote?.getTracks().length) attachStreamRef.current(remote);
    //             };
    //             syncStreams();
    //             const streamSyncTimer = window.setTimeout(syncStreams, 200);
    //             promotedSessionCleanups.push(() => window.clearTimeout(streamSyncTimer));
    //           }
    //           applySpeakerPreference(speakerEnabledRef.current ?? true);
    //           startDiagnosticsInterval(pendingSession);
    //         })
    //       );
    //
    //       promotedSessionCleanups.push(
    //         bindEmitterEvent(pendingSession, "confirmed", () => {
    //           console.info("[SIP] Incoming session confirmed", {
    //             sessionId: pendingSession.id,
    //             callId: sessionCallIdsRef.current.get(pendingSession) ?? null,
    //           });
    //           if (callMetaRef.current) {
    //             callMetaRef.current.confirmedAt = new Date().toISOString();
    //           }
    //           promotedActivationGate.markConfirmed(pendingSession.connection);
    //         })
    //       );
    //
    //       promotedSessionCleanups.push(
    //         bindEmitterEvent(pendingSession, "ended", (eventData?: unknown) => {
    //           if (answeringSessionRef.current === pendingSession) {
    //             answeringSessionRef.current = null;
    //           }
    //           const endedLocally = locallyTerminatedSessionRef.current === pendingSession;
    //           if (endedLocally) {
    //             locallyTerminatedSessionRef.current = null;
    //           }
    //           const suppressEndTone = suppressEndToneSessionRef.current === pendingSession;
    //           if (suppressEndTone) {
    //             suppressEndToneSessionRef.current = null;
    //           }
    //           const setupFailureReason = setupFailureReasonRef.current.get(pendingSession);
    //           setupFailureReasonRef.current.delete(pendingSession);
    //           if (sessionRef.current === pendingSession) {
    //             const response = getSipResponseDetails(eventData);
    //             const termination = classifySipSessionEnd({
    //               cause: formatCause((eventData as SipFailureEvent | null)?.cause),
    //               formattedFailure: formatSipFailure(eventData, "Call failed"),
    //               hadConnectedMedia: Boolean(callMetaRef.current?.mediaConnectedAt),
    //               endedLocally,
    //               reasonPhrase: response?.reason_phrase,
    //               setupFailureReason,
    //               statusCode: response?.status_code,
    //             });
    //             const terminalState = termination.failed ? CALL_STATES.FAILED : CALL_STATES.ENDED;
    //             logSessionTermination(
    //               "Call ended",
    //               pendingSession.id,
    //               eventData,
    //               termination,
    //               getTransportDropMsBefore()
    //             );
    //             if (callMetaRef.current?.mediaConnectedAt) {
    //               startWrapUp();
    //             }
    //             if (termination.message) {
    //               updateLastError(termination.message);
    //             }
    //             emitSessionCallSummary(
    //               pendingSession,
    //               termination.failed ? "failed" : "ended",
    //               eventData,
    //               termination.failureKind
    //             ).catch(() => {});
    //             resetCallRef.current({ state: terminalState });
    //             if (!suppressEndTone) {
    //               if (termination.failed) playCallFailedTone();
    //               else playCallEndedTone();
    //             }
    //           }
    //           cleanupPromotedSessionHandlers();
    //         })
    //       );
    //
    //       promotedSessionCleanups.push(
    //         bindEmitterEvent(pendingSession, "failed", (eventData?: unknown) => {
    //           if (answeringSessionRef.current === pendingSession) {
    //             answeringSessionRef.current = null;
    //           }
    //           const failedLocally = locallyTerminatedSessionRef.current === pendingSession;
    //           if (failedLocally) {
    //             locallyTerminatedSessionRef.current = null;
    //           }
    //           const setupFailureReason = setupFailureReasonRef.current.get(pendingSession);
    //           setupFailureReasonRef.current.delete(pendingSession);
    //           if (sessionRef.current === pendingSession) {
    //             const response = getSipResponseDetails(eventData);
    //             const termination = classifySipSessionEnd({
    //               cause: formatCause((eventData as SipFailureEvent | null)?.cause),
    //               formattedFailure: formatSipFailure(eventData, "Call failed"),
    //               hadConnectedMedia: Boolean(callMetaRef.current?.mediaConnectedAt),
    //               endedLocally: failedLocally,
    //               reasonPhrase: response?.reason_phrase,
    //               setupFailureReason,
    //               statusCode: response?.status_code,
    //             });
    //             logSessionTermination(
    //               "Call failed",
    //               pendingSession.id,
    //               eventData,
    //               termination,
    //               getTransportDropMsBefore()
    //             );
    //             if (callMetaRef.current?.mediaConnectedAt) {
    //               startWrapUp();
    //             }
    //             updateLastError(
    //               setupFailureReason || formatNoAnswerFailure(eventData, true, "Call failed")
    //             );
    //             emitSessionCallSummary(pendingSession, "failed", eventData).catch(() => {});
    //             resetCallRef.current({ state: CALL_STATES.FAILED });
    //             if (!failedLocally) {
    //               playCallFailedTone();
    //             }
    //           }
    //           cleanupPromotedSessionHandlers();
    //         })
    //       );
    //
    //       promotedSessionCleanups.push(
    //         bindEmitterEvent(pendingSession, "hold", () =>
    //           setCurrentCall((prev) => ({ ...prev, onHold: true }))
    //         )
    //       );
    //       promotedSessionCleanups.push(
    //         bindEmitterEvent(pendingSession, "unhold", () =>
    //           setCurrentCall((prev) => ({ ...prev, onHold: false }))
    //         )
    //       );
    //       promotedSessionCleanups.push(
    //         bindEmitterEvent(pendingSession, "muted", () =>
    //           setCurrentCall((prev) => ({ ...prev, muted: true }))
    //         )
    //       );
    //       promotedSessionCleanups.push(
    //         bindEmitterEvent(pendingSession, "unmuted", () =>
    //           setCurrentCall((prev) => ({ ...prev, muted: false }))
    //         )
    //       );
    //
    //       setCurrentCall({
    //         id: pendingSession.id,
    //         state: CALL_STATES.CONNECTING,
    //         direction: "incoming",
    //         remote: formatIdentity(pendingSession.remote_identity),
    //         muted: false,
    //         onHold: false,
    //         duration: 0,
    //         startTime: null,
    //         iceState: null,
    //       });
    //
    //       try {
    //         console.info("[SIP] Answering incoming session", {
    //           sessionId: pendingSession.id,
    //           callId: sessionCallIdsRef.current.get(pendingSession) ?? null,
    //         });
    //         pendingSession.answer(answerOptions);
    //         promotedActivationGate.start();
    //         // The terminated call's ended handler starts a wrap-up window; the
    //         // agent just accepted new work, so cancel it.
    //         stopWrapUp();
    //       } catch (error) {
    //         if (answeringSessionRef.current === pendingSession) {
    //           answeringSessionRef.current = null;
    //         }
    //         if (localInputStreamRef.current === answerOptions.mediaStream) {
    //           releaseLocalInputStream();
    //         }
    //         if (sessionRef.current === pendingSession && pendingSession.isInProgress?.()) {
    //           setCurrentCall((previous) => ({ ...previous, state: CALL_STATES.INCOMING }));
    //           startInboundRingTone();
    //         }
    //         console.warn("[SIP] Failed to answer incoming session", error);
    //         updateLastError(formatCause(error));
    //       }
    //       return;
    //     }
    // ===== END: CALL WAITING DISABLED =====

    // Original path: answer the primary incoming call.
    const session = sessionRef.current;
    if (session?.direction === "incoming" && session.isInProgress?.()) {
      stopWrapUp();
      answeringSessionRef.current = session;
      stopInboundRingTone();
      setCurrentCall((previous) =>
        sessionRef.current === session
          ? { ...previous, state: CALL_STATES.CONNECTING, startTime: null, duration: 0 }
          : previous
      );
      let answerOptions: Awaited<ReturnType<typeof createCallOptionsWithAudio>> | null = null;
      try {
        answerOptions = await createCallOptionsWithAudio();
        if (sessionRef.current !== session || session.isEnded?.()) {
          if (answeringSessionRef.current === session) {
            answeringSessionRef.current = null;
          }
          if (localInputStreamRef.current === answerOptions.mediaStream) {
            releaseLocalInputStream();
          }
          return;
        }
        answerRequestedAtPerfRef.current = performance.now();
        console.info("[SIP] Answering incoming session", {
          sessionId: session.id,
          callId: sessionCallIdsRef.current.get(session) ?? null,
        });
        session.answer(answerOptions);
        sessionActivationGateRef.current.get(session)?.start();
      } catch (error) {
        if (answeringSessionRef.current === session) {
          answeringSessionRef.current = null;
        }
        if (answerOptions && localInputStreamRef.current === answerOptions.mediaStream) {
          releaseLocalInputStream();
        }
        if (sessionRef.current === session && session.isInProgress?.()) {
          setCurrentCall((previous) => ({ ...previous, state: CALL_STATES.INCOMING }));
          startInboundRingTone();
        }
        console.warn("[SIP] Failed to answer incoming session", error);
        updateLastError(formatCause(error));
      }
    }
  }, [
    createCallOptionsWithAudio,
    releaseLocalInputStream,
    startInboundRingTone,
    stopInboundRingTone,
    stopWrapUp,
    updateLastError,
  ]);

  const rejectCall = useCallback(() => {
    // ===== CALL WAITING DISABLED (rejectCall: pending (secondary) incoming reject path) — second calls are declined with 486 Busy Here. Kept for reference. =====
    //     const pendingSession = pendingIncomingSessionRef.current;
    //     if (pendingSession && !pendingSession.isEnded?.()) {
    //       if (answeringSessionRef.current === pendingSession) {
    //         answeringSessionRef.current = null;
    //       }
    //       pendingIncomingSessionRef.current = null;
    //       setPendingIncomingCall(initialCallState);
    //       stopInboundRingTone();
    //       try {
    //         pendingSession.terminate({ status_code: 486, reason_phrase: "Busy Here" });
    //       } catch {
    //         /* ignore */
    //       }
    //       return;
    //     }
    // ===== END: CALL WAITING DISABLED =====

    // Original path: reject the primary incoming call.
    const session = sessionRef.current;
    if (session && currentCall.state === CALL_STATES.INCOMING) {
      locallyTerminatedSessionRef.current = session;
      session.terminate({ status_code: 486, reason_phrase: "Busy Here" });
      resetCall({ state: CALL_STATES.ENDED });
    }
  }, [currentCall.state, resetCall]);

  const sendDtmf = useCallback(
    (tones: string) => {
      const session = sessionRef.current;
      if (!session || session.isEnded()) {
        throw new Error("No active call available to send DTMF.");
      }

      // JsSIP's sendDTMF() throws INVALID_STATE_ERROR unless the session is
      // in 1XX_RECEIVED, WAITING_FOR_ACK or CONFIRMED, so pre-gate the keypad
      // on the UI state and avoid surfacing raw JsSIP state errors.
      const state = currentCallStateRef.current;
      const dtmfAllowed =
        state === CALL_STATES.RINGING ||
        state === CALL_STATES.CONNECTING ||
        state === CALL_STATES.ACTIVE;
      if (!dtmfAllowed) {
        throw new Error("The keypad is available once the call is ringing or in progress.");
      }

      const normalized = (tones || "").trim();
      if (!normalized) {
        return;
      }

      try {
        if (canSendRtpDtmf(session.connection)) {
          // RFC 4733/2833 tones travel with RTP, so a short WSS outage does
          // not make an otherwise healthy media call lose keypad control.
          session.sendDTMF(normalized, { transportType: "RFC2833" });
        } else {
          if (!uaRef.current?.isConnected()) {
            throw new Error(
              "Call control is reconnecting and this call does not support RTP keypad tones."
            );
          }
          session.sendDTMF(normalized);
        }
      } catch (error) {
        const message = formatCause(error) || "Unable to send DTMF.";
        updateLastError(message);
        throw new Error(message);
      }
    },
    [updateLastError]
  );

  const toggleMute = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    try {
      if (session.isMuted().audio) {
        session.unmute({ audio: true });
      } else {
        session.mute({ audio: true });
      }
    } catch (error: unknown) {
      updateLastError(formatCause(error) || "Unable to toggle mute.");
    }
  }, [updateLastError]);

  const toggleHold = useCallback(() => {
    const session = sessionRef.current;
    if (!session || session.isEnded()) return;
    const sipHeld = Boolean(session.isOnHold().local);

    const applyLocalHold = (held: boolean, reason: unknown) => {
      const changedTracks = setOutgoingAudioEnabled(session.connection, !held);
      if (changedTracks === 0) {
        const message = formatCause(reason) || "Unable to toggle hold.";
        updateLastError(message);
        console.error("[SIP] Local hold fallback failed", reason);
        return false;
      }

      localHoldFallbackRef.current = held;
      setCurrentCall((previous) => ({ ...previous, onHold: held }));
      console.warn("[SIP] Using local media pause while SIP call control is unavailable", {
        held,
        reason: formatCause(reason) || null,
      });
      return true;
    };

    // A previous signaling outage may have put the call into a local-only
    // pause. Always let the agent resume that media without waiting for WSS.
    if (localHoldFallbackRef.current) {
      applyLocalHold(false, new Error("Resuming local media pause"));
      return;
    }

    if (!uaRef.current?.isConnected()) {
      if (sipHeld) {
        updateLastError("Call control is reconnecting. Resume the held call once it is restored.");
        return;
      }
      applyLocalHold(true, new Error("SIP signaling is reconnecting"));
      return;
    }

    try {
      const holdChanged = sipHeld
        ? session.unhold({ useUpdate: false })
        : session.hold({ useUpdate: false });
      // JsSIP's hold()/unhold() return false (instead of throwing) when the
      // renegotiation is not possible at this time.
      if (holdChanged === false) {
        if (sipHeld) {
          updateLastError("The call is not ready to resume yet. Please try again.");
        } else {
          applyLocalHold(
            true,
            new Error("SIP hold was not ready; preserving the call with a local media pause")
          );
        }
      }
    } catch (error) {
      if (sipHeld) {
        updateLastError(formatCause(error) || "Unable to resume the held call.");
      } else {
        applyLocalHold(true, error);
      }
    }
  }, [setCurrentCall, updateLastError]);

  const transferCall = useCallback(
    async (target: string) => {
      const session = sessionRef.current;
      if (!session || session.isEnded()) {
        throw new Error("No active call available for transfer.");
      }
      if (!uaRef.current?.isConnected()) {
        throw new Error("Call control is reconnecting. Try the transfer again in a moment.");
      }

      const sipUri = ensureSipUri(target, downstreamDomain);
      if (!sipUri) {
        throw new Error("Invalid transfer target.");
      }

      try {
        const transfer = session.refer(sipUri, {
          eventHandlers: {
            requestSucceeded: () => {
              console.info("[SIP] Transfer request accepted", {
                target: sipUri,
              });
            },
            requestFailed: (event?: unknown) => {
              const message =
                formatCause((event as { cause?: unknown } | null)?.cause) ||
                "The transfer request was rejected.";
              console.warn("[SIP] Transfer request rejected", event);
              updateLastError(message);
            },
            failed: (event?: unknown) => {
              const message =
                formatCause((event as { cause?: unknown } | null)?.cause) ||
                "Unable to transfer call.";
              console.warn("[SIP] Transfer request failed", event);
              updateLastError(message);
            },
          },
        });
        if (transfer === false) {
          throw new Error("The call is not ready to transfer yet. Please try again.");
        }
      } catch (error) {
        const message = formatCause(error) || "Unable to transfer call.";
        updateLastError(message);
        throw new Error(message);
      }
    },
    [downstreamDomain, updateLastError]
  );

  const reconnect = useCallback(() => {
    const ua = uaRef.current;
    if (!ua) return;
    if (!registrationDesiredRef.current) {
      updateLastError("Enable the webphone before reconnecting.");
      return;
    }

    updateLastError(null);
    if (!ua.isConnected()) {
      // JsSIP owns the reconnect loop. Stopping/restarting it here would
      // replace the transport and can terminate an active RTCSession.
      setSignalingConnected(false);
      setIsRegistered(false);
      setIsRegistering(registrationDesiredRef.current);
      return;
    }

    try {
      setIsRegistering(true);
      ua.register();
    } catch (error: unknown) {
      setIsRegistering(false);
      updateLastError(formatCause(error) || "Unable to reconnect.");
    }
  }, [updateLastError]);

  const registerAudioElement = useCallback(
    (element: HTMLAudioElement | null) => {
      const previousElement = audioElementRef.current;
      if (!element) {
        detachRemoteAudioElement(previousElement);
        audioElementRef.current = null;
        return;
      }
      if (previousElement && previousElement !== element) {
        detachRemoteAudioElement(previousElement);
      }
      audioElementRef.current = element;
      element.muted = shouldMuteRemoteAudio(
        speakerEnabledRef.current,
        currentCallRef.current.onHold
      );
      const stream = remoteStreamRef.current;
      if (stream) {
        try {
          element.srcObject = stream;
          const playPromise = element.play();
          if (playPromise && typeof playPromise.then === "function") {
            void playPromise
              .then(() => setAudioReady(true))
              .catch((error) => {
                if (error?.name === "NotAllowedError") {
                  setSpeakerNeedsResume(true);
                }
              });
          }
        } catch {
          /* noop */
        }
      }
      if (sinkIdSupported) {
        void applyOutputDevice(selectedOutputDeviceIdRef.current);
      }
    },
    [applyOutputDevice, sinkIdSupported]
  );

  const selectInputDevice = useCallback(
    async (deviceId: string | null) => {
      const targetDeviceId = deviceId || null;
      const operationToken = ++inputOperationGenerationRef.current;
      setDeviceError(null);
      try {
        const { stream, resolvedDeviceId, fellBackToDefault } =
          await acquireInputStream(targetDeviceId);

        if (inputOperationGenerationRef.current !== operationToken) {
          stopStream(stream);
          return;
        }

        const activeSession = sessionRef.current;
        if (activeSession && !activeSession.isEnded?.()) {
          const replaced = await replaceSessionInputTrack(stream);
          if (!replaced) {
            stopStream(stream);
            throw new Error("Unable to switch the active call to the selected microphone.");
          }
        } else {
          stopStream(stream);
        }

        if (inputOperationGenerationRef.current !== operationToken) return;
        if (fellBackToDefault && targetDeviceId) {
          commitSelectedInputDeviceId(null);
        } else {
          commitSelectedInputDeviceId(resolvedDeviceId);
        }

        await refreshDevices();
      } catch (error: unknown) {
        setDeviceError(formatCause(error) || "Unable to use the selected microphone.");
        throw error;
      }
    },
    [acquireInputStream, commitSelectedInputDeviceId, refreshDevices, replaceSessionInputTrack]
  );

  const selectOutputDevice = useCallback(
    async (deviceId: string | null) => {
      const targetDeviceId = deviceId || null;
      beginOutputDeviceSelection();
      setDeviceError(null);
      try {
        const permittedDeviceId =
          targetDeviceId && sinkIdSupported
            ? await requestAudioOutputPermission(targetDeviceId)
            : null;
        const effectiveDeviceId = permittedDeviceId || targetDeviceId;
        commitSelectedOutputDeviceId(effectiveDeviceId);
        await applyOutputDevice(effectiveDeviceId);
      } finally {
        settleOutputDeviceSelection();
      }
    },
    [
      applyOutputDevice,
      beginOutputDeviceSelection,
      commitSelectedOutputDeviceId,
      settleOutputDeviceSelection,
      sinkIdSupported,
    ]
  );

  useEffect(() => {
    applySpeakerPreference(speakerEnabled);
    persistValue(STORAGE_KEYS.speaker, String(speakerEnabled));
  }, [applySpeakerPreference, speakerEnabled]);

  const toggleSpeaker = useCallback(() => {
    setSpeakerEnabled((previous) => {
      const enabled = !previous;
      speakerEnabledRef.current = enabled;
      return enabled;
    });
  }, []);

  const resumeSpeaker = useCallback(() => {
    const audioElement = audioElementRef.current;
    if (!audioElement) return;
    audioElement
      .play()
      .then(() => {
        audioElement.muted = shouldMuteRemoteAudio(speakerEnabled, currentCallRef.current.onHold);
        setSpeakerNeedsResume(false);
      })
      .catch((error) => {
        console.warn("[SIP] manual speaker resume failed", error);
        if (error?.name === "NotAllowedError") {
          setSpeakerNeedsResume(true);
        } else {
          updateLastError(formatCause(error));
        }
      });
  }, [speakerEnabled, updateLastError]);

  useEffect(() => {
    if (!speakerNeedsResume) return undefined;
    const handleUnlock = () => {
      resumeSpeaker();
    };
    const events = ["pointerdown", "touchstart", "keydown"];
    events.forEach((event) =>
      document.addEventListener(event, handleUnlock, { once: true, passive: true })
    );
    return () => {
      events.forEach((event) => document.removeEventListener(event, handleUnlock));
    };
  }, [resumeSpeaker, speakerNeedsResume]);

  // When the active call ends and a pending incoming call exists, promote it to primary.
  // ===== CALL WAITING DISABLED (Promotion effect: parked call promoted when the active call ends) — second calls are declined with 486 Busy Here. Kept for reference. =====
  //     if (
  //       (currentCall.state === CALL_STATES.ENDED || currentCall.state === CALL_STATES.IDLE) &&
  //       pendingIncomingCall.state === CALL_STATES.INCOMING &&
  //       pendingIncomingSessionRef.current
  //     ) {
  //       const pendingSession = pendingIncomingSessionRef.current;
  //       pendingIncomingSessionRef.current = null;
  //       sessionRef.current = pendingSession;
  //       setCurrentCall(pendingIncomingCall);
  //       setPendingIncomingCall(initialCallState);
  //     }
  //   }, [currentCall.state, pendingIncomingCall]);
  // ===== END: CALL WAITING DISABLED =====

  useEffect(() => {
    if (currentCall.onHold) {
      startHoldTone();
      if (audioElementRef.current) {
        audioElementRef.current.muted = true;
      }
    } else {
      stopHoldTone();
      applySpeakerPreference(speakerEnabled);
    }
  }, [applySpeakerPreference, currentCall.onHold, speakerEnabled, startHoldTone, stopHoldTone]);

  useEffect(() => {
    const sendTransportKeepalive = () => {
      const socket = sipSocketRef.current;
      const session = sessionRef.current;
      const hasLiveSession = Boolean(session && !session.isEnded?.());
      if (!registrationDesiredRef.current && !hasLiveSession) return;
      socket?.sendKeepalive();
    };

    let worker: Worker | null = null;
    let fallbackTimeout: number | null = null;
    let stopped = false;

    const scheduleFallback = () => {
      if (stopped || fallbackTimeout !== null) return;
      const spread =
        SIP_KEEPALIVE_FALLBACK_MAX_INTERVAL_MS - SIP_KEEPALIVE_FALLBACK_MIN_INTERVAL_MS;
      const delay =
        SIP_KEEPALIVE_FALLBACK_MIN_INTERVAL_MS + Math.floor(Math.random() * (spread + 1));
      fallbackTimeout = window.setTimeout(() => {
        fallbackTimeout = null;
        sendTransportKeepalive();
        scheduleFallback();
      }, delay);
    };

    if (typeof Worker !== "undefined") {
      try {
        worker = new Worker("/sipKeepalive.worker.js?v=3");
        worker.onmessage = (event: SipKeepaliveMessageEvent) => {
          if (
            event.data === SIP_KEEPALIVE_MESSAGE_TYPE ||
            (typeof event.data === "object" && event.data?.type === SIP_KEEPALIVE_MESSAGE_TYPE)
          ) {
            sendTransportKeepalive();
          }
        };
        worker.onerror = (error) => {
          console.warn("[SIP] transport keepalive worker failed; using timer fallback", error);
          worker?.terminate();
          worker = null;
          scheduleFallback();
        };
      } catch (error) {
        console.warn("[SIP] transport keepalive worker unavailable; using timer fallback", error);
      }
    }

    if (!worker) scheduleFallback();

    return () => {
      stopped = true;
      worker?.terminate();
      if (fallbackTimeout !== null) window.clearTimeout(fallbackTimeout);
    };
  }, []);

  // On foreground return, verify registration without replacing a healthy
  // WebSocket. JsSIP owns transport recovery and its own REGISTER refresh.
  useEffect(() => {
    if (!registrationEnabled) return undefined;
    const verifyRegistrationOnReturn = () => {
      if (document.visibilityState !== "visible") return;
      if (shouldSuppressTransientSipRecovery()) return;
      const ua = uaRef.current;
      if (!ua) return;

      const now = Date.now();
      if (
        registrationRecoveryRef.current ||
        now - lastRegistrationRecoveryAtRef.current < SIP_REGISTRATION_RECOVERY_DEBOUNCE_MS
      ) {
        return;
      }
      lastRegistrationRecoveryAtRef.current = now;

      if (!ua.isConnected()) {
        // JsSIP is already running its bounded 2-30 second recovery loop. A
        // stop/start here would discard that state and create another WSS.
        setIsRegistered(false);
        setIsRegistering(registrationDesiredRef.current);
        return;
      }

      if (ua.isRegistered()) {
        finishRegistrationRecovery();
        setIsRegistered(true);
        setIsRegistering(false);
        return;
      }

      // The WSS is healthy but the registrar state is not. Refresh only the
      // registration; never tear down a live transport for this condition.
      beginRegistrationRecovery(ua);
      setIsRegistered(false);
      setIsRegistering(true);
      try {
        ua.register();
      } catch (error) {
        finishRegistrationRecovery();
        setIsRegistering(false);
        updateLastError(formatCause(error) || "Unable to verify registration.");
      }
    };
    document.addEventListener("visibilitychange", verifyRegistrationOnReturn);
    window.addEventListener("focus", verifyRegistrationOnReturn);
    return () => {
      document.removeEventListener("visibilitychange", verifyRegistrationOnReturn);
      window.removeEventListener("focus", verifyRegistrationOnReturn);
    };
  }, [
    registrationEnabled,
    beginRegistrationRecovery,
    finishRegistrationRecovery,
    shouldSuppressTransientSipRecovery,
    updateLastError,
  ]);

  useEffect(() => {
    unmountMediaCleanupRef.current = () => {
      stopRingbackTone();
      stopHoldTone();
      stopInboundRingTone();
      stopTone(endingToneRef);
      stopTone(previewToneRef);
      if (toneContextRef.current?.close) {
        toneContextRef.current.close().catch(() => {});
      }
      toneContextRef.current = null;
      stopDiagnosticsInterval();
      stopSelfTest("unmounted");
      clearRemoteAudio();
      inputOperationGenerationRef.current += 1;
      releaseLocalInputStream();
      disposeNoiseSuppression();
    };
  }, [
    clearRemoteAudio,
    releaseLocalInputStream,
    stopDiagnosticsInterval,
    stopHoldTone,
    stopInboundRingTone,
    stopRingbackTone,
    stopTone,
    stopSelfTest,
  ]);

  useEffect(
    () => () => {
      unmountMediaCleanupRef.current();
    },
    []
  );

  return {
    isRegistered,
    isRegistering,
    signalingConnected,
    registrationEnabled,
    audioReady,
    currentCall,
    pendingIncomingCall,
    lastError,
    availableDevices,
    selectedInputDeviceId,
    selectedOutputDeviceId,
    speakerEnabled,
    deviceError,
    sinkIdSupported,
    speakerNeedsResume,
    soundPreferences,
    setRegistrationEnabled,
    refreshDevices,
    selectInputDevice,
    selectOutputDevice,
    makeCall,
    endCall,
    answerCall,
    rejectCall,
    sendDtmf,
    toggleMute,
    toggleHold,
    transferCall,
    toggleSpeaker,
    resumeSpeaker,
    resumeCallTones,
    setIncomingRingtone,
    previewIncomingRingtone,
    testSpeaker,
    reconnect,
    registerAudioElement,
    diagnostics: diagnosticsState,
    selfTestState,
    startSelfTest,
    stopSelfTest,
    wrapUpRemainingSeconds,
    wrapUpTotalSeconds,
    wrapUpExtensionsLeft,
    skipWrapUp,
    extendWrapUp,
    noiseSuppressionEnabled,
    noiseSuppressionAvailable: CUSTOM_NOISE_SUPPRESSION_ALLOWED && isNoiseSuppressionSupported(),
    setNoiseSuppression,
  };
}
