export const isCustomNoiseSuppressionAllowed = (
  featureEnabled: boolean,
  configuredValue: unknown
): boolean => {
  if (!featureEnabled) return false;
  const normalized =
    typeof configuredValue === "string" ? configuredValue.trim().toLowerCase() : "";
  return !["0", "false"].includes(normalized);
};

export const parseStoredNoiseSuppressionPreference = (value: unknown): boolean | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return null;
};

export const resolveNoiseSuppressionEnabled = ({
  allowed,
  storedValue,
}: {
  allowed: boolean;
  storedValue: unknown;
}): boolean => allowed && (parseStoredNoiseSuppressionPreference(storedValue) ?? true);

const DEFAULT_SPEECH_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  autoGainControl: { ideal: true },
  channelCount: { ideal: 1 },
  echoCancellation: { ideal: true },
  noiseSuppression: { ideal: true },
};

export const buildSpeechAudioConstraints = (
  deviceId: string | null,
  customNoiseSuppression: boolean
): MediaTrackConstraints => ({
  ...DEFAULT_SPEECH_AUDIO_CONSTRAINTS,
  // RNNoise replaces native suppression; combining both can distort speech.
  noiseSuppression: customNoiseSuppression ? { exact: false } : { ideal: true },
  ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
});

export const shouldApplyCustomNoiseSuppression = (
  requested: boolean,
  nativeNoiseSuppressionSetting: boolean | undefined
): boolean => requested && nativeNoiseSuppressionSetting !== true;
