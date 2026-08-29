import { describe, expect, test } from "bun:test";
import { calculateCallQuality } from "./callQuality";

const buildDiagnostics = (metrics: Record<string, unknown>) => ({ metrics });

describe("calculateCallQuality", () => {
  test("returns unknown without metrics", () => {
    expect(calculateCallQuality().quality).toBe("unknown");
  });

  test("rates clean audio metrics as good", () => {
    const result = calculateCallQuality(
      buildDiagnostics({
        inboundAudio: { jitter: 0.01, packetsLost: 0, packetsReceived: 1000 },
        candidatePair: { currentRoundTripTime: 0.08 },
        iceConnectionState: "connected",
      })
    );

    expect(result.quality).toBe("good");
    expect(result.issues).toHaveLength(0);
  });

  test("flags warning quality for moderate jitter/loss/latency", () => {
    const result = calculateCallQuality(
      buildDiagnostics({
        inboundAudio: { jitter: 0.026, packetsLost: 15, packetsReceived: 985 },
        candidatePair: { currentRoundTripTime: 0.24 },
        iceConnectionState: "connected",
      })
    );

    expect(result.quality).toBe("fair");
    expect(result.issues.map((issue) => issue.id)).toEqual(["jitter", "packetLoss", "rtt"]);
  });

  test("flags poor quality when thresholds exceed hard limits", () => {
    const result = calculateCallQuality(
      buildDiagnostics({
        inboundAudio: { jitter: 0.052, packetsLost: 40, packetsReceived: 960 },
        candidatePair: { currentRoundTripTime: 0.45 },
        iceConnectionState: "connected",
      })
    );

    expect(result.quality).toBe("poor");
    expect(result.issues.every((issue) => issue.severity === "poor")).toBe(true);
  });

  test("prefers interval loss and concealment over lifetime counters", () => {
    const result = calculateCallQuality(
      buildDiagnostics({
        inboundAudio: { jitter: 0.01, packetsLost: 100, packetsReceived: 900 },
        adaptive: {
          smoothedJitterMs: 10,
          intervalPacketLossPct: 0,
          concealmentPct: 6,
          jitterBufferDelayMs: 28,
          smoothedRttMs: 80,
        },
        iceConnectionState: "connected",
      })
    );

    expect(result.quality).toBe("poor");
    expect(result.metrics.packetLossPct).toBe(0);
    expect(result.metrics.downlinkPacketLossPct).toBe(10);
    expect(result.metrics.uplinkPacketLossPct).toBeNull();
    expect(result.metrics.concealmentPct).toBe(6);
    expect(result.issues).toEqual([{ id: "concealment", severity: "poor", value: "6.0%" }]);
  });

  test("scores remote-inbound loss as uplink call quality", () => {
    const result = calculateCallQuality(
      buildDiagnostics({
        inboundAudio: { jitter: 0.01, packetsLost: 0, packetsReceived: 1_000 },
        outboundAudio: { packetsSent: 1_000 },
        remoteInbound: { packetsLost: 50, packetsReceived: 950 },
        iceConnectionState: "connected",
      })
    );

    expect(result.quality).toBe("poor");
    expect(result.metrics.packetLossPct).toBe(5);
    expect(result.metrics.downlinkPacketLossPct).toBe(0);
    expect(result.metrics.uplinkPacketLossPct).toBe(5);
    expect(result.issues).toContainEqual({ id: "packetLoss", severity: "poor", value: "5.0%" });
  });

  test("converts the RTCP fixed-point fractionLost value to a percentage", () => {
    const result = calculateCallQuality(
      buildDiagnostics({
        outboundAudio: { packetsSent: 1_000 },
        remoteInbound: { fractionLost: 13 },
        iceConnectionState: "connected",
      })
    );

    expect(result.metrics.uplinkPacketLossPct).toBe(5.078125);
    expect(result.metrics.packetLossPct).toBe(5.078125);
  });

  test("exposes both directional interval loss values and scores the worse direction", () => {
    const result = calculateCallQuality(
      buildDiagnostics({
        adaptive: {
          intervalPacketLossPct: 4,
          intervalDownlinkPacketLossPct: 0.5,
          intervalUplinkPacketLossPct: 4,
        },
        iceConnectionState: "connected",
      })
    );

    expect(result.quality).toBe("poor");
    expect(result.metrics.packetLossPct).toBe(4);
    expect(result.metrics.downlinkPacketLossPct).toBe(0.5);
    expect(result.metrics.uplinkPacketLossPct).toBe(4);
  });

  test("treats ICE failure as poor even without RTP metrics", () => {
    const result = calculateCallQuality(
      buildDiagnostics({
        iceConnectionState: "failed",
      })
    );

    expect(result.quality).toBe("poor");
    expect(result.issues).toEqual([{ id: "ice", severity: "poor", value: "failed" }]);
  });
});
