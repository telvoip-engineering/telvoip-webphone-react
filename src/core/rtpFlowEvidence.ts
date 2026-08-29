export type AudioRtpFlowEvidence = {
  inboundPackets: number | null;
  outboundPackets: number | null;
  sawInboundProgress: boolean;
  sawOutboundProgress: boolean;
  bidirectionalFlowing: boolean;
};

type AudioRtpPacketSample = {
  packetsReceived?: unknown;
  packetsSent?: unknown;
};

const toPacketCounter = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

export const updateAudioRtpFlowEvidence = (
  previous: AudioRtpFlowEvidence | undefined,
  sample: AudioRtpPacketSample
): { evidence: AudioRtpFlowEvidence; becameBidirectional: boolean } => {
  const baseline: AudioRtpFlowEvidence = previous ?? {
    inboundPackets: null,
    outboundPackets: null,
    sawInboundProgress: false,
    sawOutboundProgress: false,
    bidirectionalFlowing: false,
  };
  const inboundPackets = toPacketCounter(sample.packetsReceived);
  const outboundPackets = toPacketCounter(sample.packetsSent);
  const sawInboundProgress =
    baseline.sawInboundProgress ||
    (baseline.inboundPackets !== null &&
      inboundPackets !== null &&
      inboundPackets > baseline.inboundPackets);
  const sawOutboundProgress =
    baseline.sawOutboundProgress ||
    (baseline.outboundPackets !== null &&
      outboundPackets !== null &&
      outboundPackets > baseline.outboundPackets);
  const bidirectionalFlowing =
    baseline.bidirectionalFlowing || (sawInboundProgress && sawOutboundProgress);

  return {
    evidence: {
      inboundPackets: inboundPackets ?? baseline.inboundPackets,
      outboundPackets: outboundPackets ?? baseline.outboundPackets,
      sawInboundProgress,
      sawOutboundProgress,
      bidirectionalFlowing,
    },
    becameBidirectional: !baseline.bidirectionalFlowing && bidirectionalFlowing,
  };
};
