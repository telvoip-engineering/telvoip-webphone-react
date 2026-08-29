import { describe, expect, test } from "bun:test";
import {
  DEFAULT_ICE_GATHERING_WATCHDOG_MS,
  getIceGatheringWatchdogMs,
  MAX_ICE_RESTART_ATTEMPTS,
  MAX_ICE_RESTART_READINESS_RETRIES,
  RELAY_ICE_GATHERING_WATCHDOG_MS,
  shouldAttemptIceRestart,
  shouldRetryIceRestartReadiness,
  summarizeIceServerUrl,
  summarizeSdpIceConnectivity,
} from "./iceRecovery";

describe("getIceGatheringWatchdogMs", () => {
  test("preserves the prior ten-second floor for STUN-only calls", () => {
    expect(getIceGatheringWatchdogMs([{ urls: "stun:turn.telvoip.io:3478" }])).toBe(
      DEFAULT_ICE_GATHERING_WATCHDOG_MS
    );
    expect(DEFAULT_ICE_GATHERING_WATCHDOG_MS).toBe(10_000);
  });

  test("keeps the conservative floor when a TURN relay is configured", () => {
    expect(
      getIceGatheringWatchdogMs([
        { urls: "stun:turn.telvoip.io:3478" },
        { urls: ["turn:turn.telvoip.io:3478?transport=udp", "turns:turn.telvoip.io:5349"] },
      ])
    ).toBe(RELAY_ICE_GATHERING_WATCHDOG_MS);
  });
});

describe("shouldAttemptIceRestart", () => {
  const eligible = {
    iceState: "disconnected" as RTCIceConnectionState,
    sessionEstablished: true,
    readyToReOffer: true,
    attempts: 0,
  };

  test("permits one restart for an established disconnected call", () => {
    expect(shouldAttemptIceRestart(eligible)).toBe(true);
  });

  test("does not restart during setup, while another offer is active, or after the limit", () => {
    expect(shouldAttemptIceRestart({ ...eligible, sessionEstablished: false })).toBe(false);
    expect(shouldAttemptIceRestart({ ...eligible, readyToReOffer: false })).toBe(false);
    expect(shouldAttemptIceRestart({ ...eligible, attempts: MAX_ICE_RESTART_ATTEMPTS })).toBe(
      false
    );
    expect(shouldAttemptIceRestart({ ...eligible, iceState: "failed" })).toBe(false);
  });
});

describe("shouldRetryIceRestartReadiness", () => {
  const retryable = {
    iceState: "disconnected" as RTCIceConnectionState,
    sessionEstablished: true,
    attempts: 0,
    readinessRetries: 0,
  };

  test("waits for a busy established dialog to become ready", () => {
    expect(shouldRetryIceRestartReadiness(retryable)).toBe(true);
  });

  test("stops after recovery, session end, an actual attempt, or the retry limit", () => {
    expect(shouldRetryIceRestartReadiness({ ...retryable, iceState: "connected" })).toBe(false);
    expect(shouldRetryIceRestartReadiness({ ...retryable, sessionEstablished: false })).toBe(false);
    expect(
      shouldRetryIceRestartReadiness({ ...retryable, attempts: MAX_ICE_RESTART_ATTEMPTS })
    ).toBe(false);
    expect(
      shouldRetryIceRestartReadiness({
        ...retryable,
        readinessRetries: MAX_ICE_RESTART_READINESS_RETRIES,
      })
    ).toBe(false);
  });
});

describe("summarizeSdpIceConnectivity", () => {
  test("retains ICE shape without exposing candidate addresses or ports", () => {
    const sdp = [
      "v=0",
      "c=IN IP4 203.0.113.10",
      "a=candidate:1 1 UDP 2122260223 203.0.113.10 54321 typ host",
      "a=candidate:2 1 TCP 1677734911 198.51.100.20 443 typ relay tcptype passive",
      "",
    ].join("\r\n");

    const summary = summarizeSdpIceConnectivity(sdp);

    expect(summary).toEqual({
      connectionLineCount: 1,
      candidateCount: 2,
      candidateTypes: { host: 1, relay: 1 },
      protocols: { udp: 1, tcp: 1 },
    });
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("203.0.113.10");
    expect(serialized).not.toContain("198.51.100.20");
    expect(serialized).not.toContain("54321");
  });
});

describe("summarizeIceServerUrl", () => {
  test("retains only scheme and transport", () => {
    const summary = summarizeIceServerUrl("turns:turn.internal.example:5349?transport=tcp");

    expect(summary).toEqual({ scheme: "turns", transport: "tcp" });
    expect(JSON.stringify(summary)).not.toContain("turn.internal.example");
    expect(JSON.stringify(summary)).not.toContain("5349");
  });
});
