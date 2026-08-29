import { describe, expect, test } from "bun:test";
import { canSendRtpDtmf, setOutgoingAudioEnabled } from "./sipCallControl";

describe("SIP call-control media fallbacks", () => {
  test("detects RTP DTMF only when an audio sender can insert tones", () => {
    expect(
      canSendRtpDtmf({
        getSenders: () => [
          { track: { kind: "video", enabled: true }, dtmf: { canInsertDTMF: true } },
          { track: { kind: "audio", enabled: true }, dtmf: { canInsertDTMF: false } },
        ],
      })
    ).toBe(false);

    expect(
      canSendRtpDtmf({
        getSenders: () => [
          { track: { kind: "audio", enabled: true }, dtmf: { canInsertDTMF: true } },
        ],
      })
    ).toBe(true);
  });

  test("matches JsSIP by checking the first audio sender", () => {
    expect(
      canSendRtpDtmf({
        getSenders: () => [
          { track: { kind: "audio", enabled: true }, dtmf: { canInsertDTMF: false } },
          { track: { kind: "audio", enabled: true }, dtmf: { canInsertDTMF: true } },
        ],
      })
    ).toBe(false);
  });

  test("pauses and restores every outbound audio track without touching video", () => {
    const audioOne = { kind: "audio", enabled: true };
    const audioTwo = { kind: "audio", enabled: true };
    const video = { kind: "video", enabled: true };
    const connection = {
      getSenders: () => [{ track: audioOne }, { track: video }, { track: audioTwo }],
    };

    expect(setOutgoingAudioEnabled(connection, false)).toBe(2);
    expect(audioOne.enabled).toBe(false);
    expect(audioTwo.enabled).toBe(false);
    expect(video.enabled).toBe(true);

    expect(setOutgoingAudioEnabled(connection, true)).toBe(2);
    expect(audioOne.enabled).toBe(true);
    expect(audioTwo.enabled).toBe(true);
  });

  test("fails closed when getSenders is unavailable or throws", () => {
    expect(setOutgoingAudioEnabled(null, false)).toBe(0);
    expect(
      canSendRtpDtmf({
        getSenders: () => {
          throw new Error("closed peer connection");
        },
      })
    ).toBe(false);
  });
});
