import { describe, expect, test } from "bun:test";
import { updateAudioRtpFlowEvidence, type AudioRtpFlowEvidence } from "./rtpFlowEvidence";

const update = (
  previous: AudioRtpFlowEvidence | undefined,
  packetsReceived: unknown,
  packetsSent: unknown
) => updateAudioRtpFlowEvidence(previous, { packetsReceived, packetsSent });

describe("updateAudioRtpFlowEvidence", () => {
  test("uses the first sample only as a baseline", () => {
    const result = update(undefined, 120, 130);

    expect(result.becameBidirectional).toBe(false);
    expect(result.evidence.bidirectionalFlowing).toBe(false);
  });

  test("detects increasing inbound and outbound audio packets", () => {
    const baseline = update(undefined, 120, 130).evidence;
    const result = update(baseline, 150, 165);

    expect(result.becameBidirectional).toBe(true);
    expect(result.evidence.bidirectionalFlowing).toBe(true);
  });

  test("does not treat one-way packet progress as connected media", () => {
    const baseline = update(undefined, 120, 130).evidence;
    const inboundOnly = update(baseline, 150, 130);

    expect(inboundOnly.evidence.bidirectionalFlowing).toBe(false);

    const bothDirections = update(inboundOnly.evidence, 150, 165);
    expect(bothDirections.becameBidirectional).toBe(true);
  });

  test("ignores invalid counters without losing prior evidence", () => {
    const baseline = update(undefined, 120, 130).evidence;
    const invalid = update(baseline, undefined, Number.NaN);

    expect(invalid.evidence.inboundPackets).toBe(120);
    expect(invalid.evidence.outboundPackets).toBe(130);
    expect(invalid.becameBidirectional).toBe(false);
  });
});
