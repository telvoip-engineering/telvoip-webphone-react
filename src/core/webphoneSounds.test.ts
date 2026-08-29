import { describe, expect, test } from "bun:test";
import {
  getIncomingRingtonePreset,
  getSoundPatternDurationMs,
  INCOMING_RINGTONE_PRESETS,
} from "./webphoneSounds";

describe("webphone sound presets", () => {
  test("exposes multiple incoming ringtone choices", () => {
    expect(INCOMING_RINGTONE_PRESETS.length >= 5).toBe(true);
    expect(new Set(INCOMING_RINGTONE_PRESETS.map((preset) => preset.id)).size).toBe(
      INCOMING_RINGTONE_PRESETS.length
    );
  });

  test("falls back to the default ringtone for unknown ids", () => {
    expect(getIncomingRingtonePreset("missing").id).toBe("classic");
  });

  test("calculates finite preview duration", () => {
    const preset = getIncomingRingtonePreset("pulse");
    const duration = getSoundPatternDurationMs(preset.pattern);
    expect(Number.isFinite(duration)).toBe(true);
    expect(duration > 0).toBe(true);
  });
});
