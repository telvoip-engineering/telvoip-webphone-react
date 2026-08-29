// Public entry point.
//
// Primitive/headless exports (this file, so far): the JsSIP engine hook and
// the Context/Provider layer built on it - enough to drive telephony
// entirely from your own UI. `<WebphoneProvider>` / `<Dialer />` and the
// individually-exported UI primitives (drop-in, batteries-included path)
// land in a later phase; see the README roadmap for current status.

export { default as useSIPClient } from "./core/useSIPClient";
export type {
  AvailableDevice,
  AvailableDevices,
  CurrentCallState,
  DiagnosticsState,
  SelfTestState,
  SipCallStateValue,
  SipClientConfig,
  SipRemoteIdentity,
  UseSIPClientOptions,
  UseSIPClientReturn,
} from "./core/useSIPClient";

export { SipProvider, useSip, useSipActions, normalizeCredentials } from "./context/SipContext";
export type {
  NormalizedSipCredentials,
  SipActions,
  SipCallStatus,
  SipContextValue,
  SipCredentialsInput,
  SipProviderProps,
  SipRemoteIdentity as SipContextRemoteIdentity,
  SipState,
} from "./context/SipContext";

export {
  getIncomingRingtonePreset,
  getSoundPatternDurationMs,
  INCOMING_RINGTONE_PRESETS,
  readWebphoneSoundPreferences,
  writeWebphoneSoundPreferences,
} from "./core/webphoneSounds";
export type { WebphoneRingtoneId, WebphoneSoundPreferences } from "./core/webphoneSounds";
