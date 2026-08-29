import { describe, expect, test } from "bun:test";
import { detachRemoteAudioElement, shouldMuteRemoteAudio } from "./remoteAudio";

describe("remote audio lifecycle", () => {
  test("mutes playback when the speaker is disabled or the call is on hold", () => {
    expect(shouldMuteRemoteAudio(true, false)).toBe(false);
    expect(shouldMuteRemoteAudio(false, false)).toBe(true);
    expect(shouldMuteRemoteAudio(true, true)).toBe(true);
    expect(shouldMuteRemoteAudio(false, true)).toBe(true);
  });

  test("pauses and detaches the media stream", () => {
    let pauseCalls = 0;
    const element = {
      muted: false,
      pause: () => {
        pauseCalls += 1;
      },
      srcObject: {} as MediaProvider,
    };

    detachRemoteAudioElement(element);

    expect(pauseCalls).toBe(1);
    expect(element.srcObject).toBeNull();
  });

  test("continues detaching when pause throws", () => {
    const element = {
      muted: false,
      pause: () => {
        throw new Error("already removed");
      },
      srcObject: {} as MediaProvider,
    };

    expect(() => detachRemoteAudioElement(element)).not.toThrow();
    expect(element.srcObject).toBeNull();
  });
});
