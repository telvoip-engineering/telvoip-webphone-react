export type WebphoneRingtoneId =
  | "classic"
  | "northAmerica"
  | "ukDouble"
  | "europe"
  | "deskBell"
  | "callCenter"
  | "pulse"
  | "urgent"
  | "soft";

export type WebphoneSoundEvent = "incoming" | "ringback" | "hold" | "ended" | "failed";

export interface SoundStep {
  frequency?: number;
  frequencies?: number[];
  durationMs: number;
  gapMs?: number;
  volume?: number;
  type?: OscillatorType;
}

export interface SoundPattern {
  steps: SoundStep[];
  cycleGapMs?: number;
  volume?: number;
}

export interface IncomingRingtonePreset {
  id: WebphoneRingtoneId;
  /** Display name; the UI's own default (a consumer may still relabel via props). */
  name: string;
  /**
   * Iconify icon name from the source this was ported from - kept as
   * metadata for consumers who have their own icon system, but unused by
   * this package's own UI (which ships a small dependency-free icon set
   * instead of an Iconify dependency).
   */
  icon: string;
  accentClass: string;
  pattern: SoundPattern;
}

export interface WebphoneSoundPreferences {
  incomingRingtoneId: WebphoneRingtoneId;
}

export const DEFAULT_WEBPHONE_SOUND_PREFERENCES: WebphoneSoundPreferences = {
  incomingRingtoneId: "classic",
};

export const WEBPHONE_SOUND_PREF_STORAGE_KEY = "telvoip:webphone:soundPreferences";

export const INCOMING_RINGTONE_PRESETS: IncomingRingtonePreset[] = [
  {
    id: "classic",
    name: "Classic",
    icon: "mdi:bell-ring-outline",
    accentClass: "from-orange-500 to-amber-400",
    pattern: {
      volume: 0.16,
      cycleGapMs: 4000,
      steps: [{ frequency: 480, durationMs: 2000 }],
    },
  },
  {
    id: "northAmerica",
    name: "North America",
    icon: "mdi:phone-classic",
    accentClass: "from-blue-500 to-cyan-400",
    pattern: {
      volume: 0.13,
      cycleGapMs: 4000,
      steps: [{ frequencies: [440, 480], durationMs: 2000 }],
    },
  },
  {
    id: "ukDouble",
    name: "UK Double Ring",
    icon: "mdi:record-circle-outline",
    accentClass: "from-violet-500 to-fuchsia-400",
    pattern: {
      volume: 0.15,
      cycleGapMs: 2000,
      steps: [
        { frequencies: [400, 450], durationMs: 400, gapMs: 200 },
        { frequencies: [400, 450], durationMs: 400 },
      ],
    },
  },
  {
    id: "europe",
    name: "Europe",
    icon: "mdi:deskphone",
    accentClass: "from-emerald-500 to-teal-400",
    pattern: {
      volume: 0.15,
      cycleGapMs: 3000,
      steps: [{ frequency: 425, durationMs: 1000 }],
    },
  },
  {
    id: "deskBell",
    name: "Desk Bell",
    icon: "mdi:bell-alert-outline",
    accentClass: "from-yellow-500 to-orange-400",
    pattern: {
      volume: 0.15,
      cycleGapMs: 1500,
      steps: [
        { frequencies: [480, 620], durationMs: 320, gapMs: 110, type: "square" },
        { frequencies: [480, 620], durationMs: 320, gapMs: 110, type: "square" },
        { frequencies: [480, 620], durationMs: 320, type: "square" },
      ],
    },
  },
  {
    id: "callCenter",
    name: "Call Center",
    icon: "mdi:headset",
    accentClass: "from-orange-600 to-red-500",
    pattern: {
      volume: 0.14,
      cycleGapMs: 1100,
      steps: [
        { frequencies: [620, 760], durationMs: 180, gapMs: 90, type: "triangle" },
        { frequencies: [620, 760], durationMs: 180, gapMs: 90, type: "triangle" },
        { frequencies: [620, 760], durationMs: 260, type: "triangle" },
      ],
    },
  },
  {
    id: "pulse",
    name: "Pulse",
    icon: "solar:pulse-2-linear",
    accentClass: "from-sky-500 to-blue-400",
    pattern: {
      volume: 0.13,
      cycleGapMs: 900,
      steps: [
        { frequency: 740, durationMs: 120, gapMs: 80, type: "triangle" },
        { frequency: 980, durationMs: 120, gapMs: 80, type: "triangle" },
        { frequency: 740, durationMs: 180, type: "triangle" },
      ],
    },
  },
  {
    id: "urgent",
    name: "Urgent",
    icon: "mdi:alarm-light-outline",
    accentClass: "from-rose-500 to-orange-400",
    pattern: {
      volume: 0.15,
      cycleGapMs: 850,
      steps: [
        { frequencies: [880, 1040], durationMs: 180, gapMs: 90 },
        { frequencies: [880, 1040], durationMs: 180, gapMs: 90 },
        { frequencies: [880, 1040], durationMs: 220 },
      ],
    },
  },
  {
    id: "soft",
    name: "Soft",
    icon: "solar:bell-bing-linear",
    accentClass: "from-slate-500 to-sky-400",
    pattern: {
      volume: 0.11,
      cycleGapMs: 1800,
      steps: [
        { frequency: 660, durationMs: 240, gapMs: 90 },
        { frequency: 880, durationMs: 280, gapMs: 90 },
        { frequency: 660, durationMs: 240 },
      ],
    },
  },
];

// Ringback heard while an outbound call rings. ITU/ETSI convention for the
// Kenya region: 425 Hz, 1s on / 4s off (vs the North American 440+480 Hz dual
// tone at 2s on / 4s off).
export const RINGBACK_TONE_PATTERN: SoundPattern = {
  volume: 0.12,
  cycleGapMs: 4000,
  steps: [{ frequency: 425, durationMs: 1000 }],
};

export const HOLD_TONE_PATTERN: SoundPattern = {
  volume: 0.08,
  cycleGapMs: 400,
  steps: [{ frequency: 330, durationMs: 800 }],
};

// Disconnect / call-ended cue. Real telephony has no invented jingle here — the
// disconnect tone is "a few cycles of a standard call-progress tone". Kenya sits
// in the ITU/ETSI 425 Hz single-frequency region (unlike the North American
// 480+620 Hz dual-tone plan), so we use the ITU convention — which is also the
// exact iPhone "call ended" cue: three 425 Hz bursts of ~0.2s. Standard-correct
// AND the sound agents already recognise, so it lands even mid-conversation.
export const CALL_ENDED_TONE_PATTERN: SoundPattern = {
  volume: 0.18,
  steps: [
    { frequency: 425, durationMs: 200, gapMs: 160 },
    { frequency: 425, durationMs: 200, gapMs: 160 },
    { frequency: 425, durationMs: 200 },
  ],
};

// Call-failed cue = the ITU reorder/congestion tone ("the call could not be
// completed"): 425 Hz at the fast 0.25s on / 0.25s off cadence. The faster,
// more insistent rhythm distinguishes a failure from a normal disconnect above.
export const CALL_FAILED_TONE_PATTERN: SoundPattern = {
  volume: 0.18,
  steps: [
    { frequency: 425, durationMs: 250, gapMs: 250 },
    { frequency: 425, durationMs: 250, gapMs: 250 },
    { frequency: 425, durationMs: 250, gapMs: 250 },
    { frequency: 425, durationMs: 250 },
  ],
};

export const SPEAKER_TEST_PATTERN: SoundPattern = {
  volume: 0.08,
  steps: [{ frequency: 740, durationMs: 700 }],
};

export const getIncomingRingtonePreset = (id?: string | null): IncomingRingtonePreset => {
  return (
    INCOMING_RINGTONE_PRESETS.find((preset) => preset.id === id) || INCOMING_RINGTONE_PRESETS[0]
  );
};

export const getSoundPatternDurationMs = (pattern: SoundPattern): number => {
  return pattern.steps.reduce((total, step) => total + step.durationMs + (step.gapMs || 0), 0);
};

export const readWebphoneSoundPreferences = (): WebphoneSoundPreferences => {
  if (typeof window === "undefined") return DEFAULT_WEBPHONE_SOUND_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(WEBPHONE_SOUND_PREF_STORAGE_KEY);
    if (!raw) return DEFAULT_WEBPHONE_SOUND_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<WebphoneSoundPreferences> | null;
    const incomingRingtoneId = getIncomingRingtonePreset(parsed?.incomingRingtoneId).id;
    return { incomingRingtoneId };
  } catch {
    return DEFAULT_WEBPHONE_SOUND_PREFERENCES;
  }
};

export const writeWebphoneSoundPreferences = (preferences: WebphoneSoundPreferences): void => {
  if (typeof window === "undefined") return;
  const normalized: WebphoneSoundPreferences = {
    incomingRingtoneId: getIncomingRingtonePreset(preferences.incomingRingtoneId).id,
  };
  try {
    window.localStorage.setItem(WEBPHONE_SOUND_PREF_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Keep the preference in memory for the current session.
  }
};
