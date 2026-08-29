import { describe, expect, test } from "bun:test";
import {
  buildSpeechAudioConstraints,
  isCustomNoiseSuppressionAllowed,
  parseStoredNoiseSuppressionPreference,
  resolveNoiseSuppressionEnabled,
  shouldApplyCustomNoiseSuppression,
} from "./noiseSuppressionConfig";

describe("noise suppression configuration", () => {
  test("allows custom suppression by default when the feature is shipped", () => {
    expect(isCustomNoiseSuppressionAllowed(true, undefined)).toBe(true);
    expect(isCustomNoiseSuppressionAllowed(true, "")).toBe(true);
    expect(isCustomNoiseSuppressionAllowed(true, "1")).toBe(true);
    expect(isCustomNoiseSuppressionAllowed(true, "true")).toBe(true);
  });

  test("honors feature and environment opt-outs", () => {
    expect(isCustomNoiseSuppressionAllowed(false, "1")).toBe(false);
    expect(isCustomNoiseSuppressionAllowed(true, "0")).toBe(false);
    expect(isCustomNoiseSuppressionAllowed(true, " FALSE ")).toBe(false);
  });

  test("parses only strict stored boolean preferences", () => {
    expect(parseStoredNoiseSuppressionPreference("true")).toBe(true);
    expect(parseStoredNoiseSuppressionPreference(" FALSE ")).toBe(false);
    expect(parseStoredNoiseSuppressionPreference(null)).toBeNull();
    expect(parseStoredNoiseSuppressionPreference("corrupt")).toBeNull();
  });

  test("defaults new users on while preserving an explicit saved choice", () => {
    expect(resolveNoiseSuppressionEnabled({ allowed: true, storedValue: null })).toBe(true);
    expect(resolveNoiseSuppressionEnabled({ allowed: true, storedValue: "corrupt" })).toBe(true);
    expect(resolveNoiseSuppressionEnabled({ allowed: true, storedValue: "true" })).toBe(true);
    expect(resolveNoiseSuppressionEnabled({ allowed: true, storedValue: "false" })).toBe(false);
    expect(resolveNoiseSuppressionEnabled({ allowed: false, storedValue: "true" })).toBe(false);
  });

  test("uses exactly one suppression layer in microphone constraints", () => {
    expect(buildSpeechAudioConstraints("mic-1", true)).toEqual({
      deviceId: { exact: "mic-1" },
      echoCancellation: { ideal: true },
      autoGainControl: { ideal: true },
      channelCount: { ideal: 1 },
      noiseSuppression: { exact: false },
    });
    expect(buildSpeechAudioConstraints(null, false)).toEqual({
      echoCancellation: { ideal: true },
      autoGainControl: { ideal: true },
      channelCount: { ideal: 1 },
      noiseSuppression: { ideal: true },
    });
  });

  test("does not layer RNNoise over active browser suppression", () => {
    expect(shouldApplyCustomNoiseSuppression(true, false)).toBe(true);
    expect(shouldApplyCustomNoiseSuppression(true, undefined)).toBe(true);
    expect(shouldApplyCustomNoiseSuppression(true, true)).toBe(false);
    expect(shouldApplyCustomNoiseSuppression(false, false)).toBe(false);
  });
});
