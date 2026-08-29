// Public entry point.
//
// Two ways to use this package:
// - Headless: useSIPClient / SipProvider+useSip()+useSipActions() drives
//   telephony with zero UI opinion - build your own on top.
// - Batteries-included: mount <WebphoneProvider> once, then <Dialer />
//   anywhere inside it for a drop-in, draggable softphone widget. The
//   individual UI primitives it's built from are also exported separately
//   for partial reuse.

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
export type {
  IncomingRingtonePreset,
  WebphoneRingtoneId,
  WebphoneSoundPreferences,
} from "./core/webphoneSounds";

export {
  resolveNoiseSuppressionAssetBaseUrl,
  isNoiseSuppressionSupported,
} from "./noise-suppression/noiseSuppression";

// --- Batteries-included: composition root + drop-in Dialer ---
export { default as WebphoneProvider } from "./components/WebphoneProvider";
export type { WebphoneProviderProps } from "./components/WebphoneProvider";

export { default as Dialer } from "./components/Dialer/Dialer";

export { default as DraggablePill } from "./components/Dialer/DraggablePill";
export type { DraggablePillProps } from "./components/Dialer/DraggablePill";

export { default as IncomingCallBanner } from "./components/Dialer/IncomingCallBanner";
export type { IncomingCallBannerProps } from "./components/Dialer/IncomingCallBanner";

export { useWebphonePip, WebphonePipCard } from "./components/WebphonePip";
export type { WebphonePipCardProps } from "./components/WebphonePip";

// --- Batteries-included: individual UI primitives, for partial reuse ---
export { default as ControlButton } from "./components/primitives/ControlButton";
export type { ControlButtonProps } from "./components/primitives/ControlButton";

export { default as DevicePicker } from "./components/primitives/DevicePicker";
export type { DevicePickerProps } from "./components/primitives/DevicePicker";

export { default as DialPad } from "./components/primitives/DialPad";
export type { DialPadProps } from "./components/primitives/DialPad";

export { default as TransferPad } from "./components/primitives/TransferPad";
export type { TransferPadProps } from "./components/primitives/TransferPad";

export { default as AudioSettingsPanel } from "./components/primitives/AudioSettingsPanel";
export type { AudioSettingsPanelProps } from "./components/primitives/AudioSettingsPanel";

export { default as WrapUpCard } from "./components/primitives/WrapUpCard";
export type { WrapUpCardProps } from "./components/primitives/WrapUpCard";

export * from "./components/primitives/icons";

// --- Batteries-included: shared types and labels ---
export type {
  ControlButtonAppearance,
  DialerProps,
  TransferTarget,
  WrapUpCallSummary,
} from "./components/types";

export { DEFAULT_DIALER_LABELS, resolveLabels } from "./components/labels";
export type { DialerLabels } from "./components/labels";
