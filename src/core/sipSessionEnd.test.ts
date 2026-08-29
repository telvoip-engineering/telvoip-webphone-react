import { describe, expect, test } from "bun:test";
import { classifySipSessionEnd } from "./sipSessionEnd";

const classify = (overrides: Partial<Parameters<typeof classifySipSessionEnd>[0]> = {}) =>
  classifySipSessionEnd({
    cause: "Terminated",
    formattedFailure: "Terminated",
    hadConnectedMedia: false,
    endedLocally: false,
    ...overrides,
  });

describe("classifySipSessionEnd", () => {
  test("classifies an initial missing ACK as a setup-signaling failure", () => {
    const result = classify({ cause: "No ACK", formattedFailure: "No ACK" });

    expect(result.failed).toBe(true);
    expect(result.failureKind).toBe("setup-signaling");
    expect(result.message).toContain("Call setup failed");
  });

  test("classifies a missing ACK after media connected as a mid-call signaling failure", () => {
    const result = classify({
      cause: "No ACK",
      formattedFailure: "No ACK",
      hadConnectedMedia: true,
    });

    expect(result.failed).toBe(true);
    expect(result.failureKind).toBe("mid-call-signaling");
    expect(result.message).toContain("mid-call SIP update");
  });

  test("classifies an active-session request timeout as an abnormal signaling failure", () => {
    const result = classify({
      cause: "Request Timeout",
      formattedFailure: "Request Timeout",
      hadConnectedMedia: true,
      statusCode: 408,
      reasonPhrase: "Session Timer Expired",
    });

    expect(result.failed).toBe(true);
    expect(result.failureKind).toBe("session-signaling-timeout");
    expect(result.message).toContain("SIP session update timed out");
  });

  test("preserves a locally ended call as a normal end", () => {
    expect(
      classify({
        cause: "No ACK",
        formattedFailure: "No ACK",
        hadConnectedMedia: true,
        endedLocally: true,
      })
    ).toEqual({ failed: false, failureKind: null, message: null });
  });

  test("preserves a normal remote BYE as a normal end", () => {
    expect(classify()).toEqual({ failed: false, failureKind: null, message: null });
  });

  test("keeps terminal ICE failures in the media category", () => {
    expect(
      classify({ cause: "ICE failed", formattedFailure: "ICE failed", hadConnectedMedia: true })
    ).toEqual({ failed: true, failureKind: "media", message: "ICE failed" });
  });
});
