/**
 * Every user-facing string in the Dialer UI, with sensible English defaults.
 * This package has no i18n dependency (next-intl, the source app's choice,
 * isn't portable) - a consumer who needs another language passes a
 * `labels` prop overriding whichever keys they need; everything else falls
 * back to these defaults. Built up incrementally as each component is
 * ported/built, not a fixed contract decided upfront.
 */
export interface DialerLabels {
  dialPlaceholder: string;
  dtmfPlaceholder: string;
  clear: string;
  backspace: string;
  call: string;
  closeDtmf: string;
  mute: string;
  unmute: string;
  hold: string;
  unhold: string;
  hangup: string;
  answer: string;
  reject: string;
  transfer: string;
  keypad: string;
  settings: string;
  speaker: string;
  speakerMuted: string;
  incomingCall: string;
  unknownCaller: string;
  callConnecting: string;
  callRinging: string;
  registering: string;
  registered: string;
  unregistered: string;
  reconnecting: string;
  transferPlaceholder: string;
  transferSubmit: string;
  transferCancel: string;
  transferSent: string;
  micDevice: string;
  speakerDevice: string;
  noiseSuppression: string;
  wrapUpTitle: string;
  wrapUpSkip: string;
  wrapUpExtend: string;
  wrapUpTimeRemaining: string;
  pictureInPicture: string;
  audioSetupTitle: string;
  audioSetupDescription: string;
  audioMicLevel: string;
  audioRingtones: string;
  audioRingtonePreview: string;
  audioNoiseSuppressionTitle: string;
  audioNoiseSuppressionDescription: string;
  audioOutputFollowsSystem: string;
  audioOutputUnsupported: string;
  audioTestSpeaker: string;
  audioTestingSpeaker: string;
  wrapUpEndedCall: string;
}

export const DEFAULT_DIALER_LABELS: DialerLabels = {
  dialPlaceholder: "Enter a number",
  dtmfPlaceholder: "Enter digits",
  clear: "Clear",
  backspace: "Backspace",
  call: "Call",
  closeDtmf: "Close keypad",
  mute: "Mute",
  unmute: "Unmute",
  hold: "Hold",
  unhold: "Resume",
  hangup: "Hang up",
  answer: "Answer",
  reject: "Decline",
  transfer: "Transfer",
  keypad: "Keypad",
  settings: "Settings",
  speaker: "Speaker",
  speakerMuted: "Speaker muted",
  incomingCall: "Incoming call",
  unknownCaller: "Unknown caller",
  callConnecting: "Connecting…",
  callRinging: "Ringing…",
  registering: "Connecting to server…",
  registered: "Ready",
  unregistered: "Offline",
  reconnecting: "Reconnecting…",
  transferPlaceholder: "Transfer to…",
  transferSubmit: "Transfer",
  transferCancel: "Cancel",
  transferSent: "Transferred",
  micDevice: "Microphone",
  speakerDevice: "Speaker",
  noiseSuppression: "Noise suppression",
  wrapUpTitle: "Wrapping up",
  wrapUpSkip: "I'm ready",
  wrapUpExtend: "+30s",
  wrapUpTimeRemaining: "Time remaining",
  pictureInPicture: "Pop out",
  audioSetupTitle: "Audio settings",
  audioSetupDescription: "Choose your microphone, speaker, and ringtone.",
  audioMicLevel: "Mic level",
  audioRingtones: "Ringtone",
  audioRingtonePreview: "Preview ringtone",
  audioNoiseSuppressionTitle: "Noise suppression",
  audioNoiseSuppressionDescription: "Reduce background noise on your microphone.",
  audioOutputFollowsSystem: "Follows your system's default output device.",
  audioOutputUnsupported: "Your browser doesn't support choosing an output device.",
  audioTestSpeaker: "Test speaker",
  audioTestingSpeaker: "Playing…",
  wrapUpEndedCall: "Call ended",
};

export const resolveLabels = (overrides?: Partial<DialerLabels>): DialerLabels =>
  overrides ? { ...DEFAULT_DIALER_LABELS, ...overrides } : DEFAULT_DIALER_LABELS;
