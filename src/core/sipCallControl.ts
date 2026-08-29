interface AudioTrackLike {
  kind: string;
  enabled: boolean;
}

interface DtmfSenderLike {
  canInsertDTMF: boolean;
}

interface AudioSenderLike {
  track?: AudioTrackLike | null;
  dtmf?: DtmfSenderLike | null;
}

export interface SenderConnectionLike {
  getSenders?: () => AudioSenderLike[];
}

const getAudioSenders = (
  connection: SenderConnectionLike | null | undefined
): AudioSenderLike[] => {
  try {
    return (connection?.getSenders?.() ?? []).filter((sender) => sender.track?.kind === "audio");
  } catch {
    return [];
  }
};

/** True when DTMF can travel in the RTP audio stream without SIP INFO/WSS. */
export const canSendRtpDtmf = (connection: SenderConnectionLike | null | undefined): boolean =>
  getAudioSenders(connection)[0]?.dtmf?.canInsertDTMF === true;

/**
 * Toggle every outbound audio track and return how many tracks were changed.
 * This is the non-signaling fallback used to preserve a call when SIP hold is
 * unsafe because the WebSocket flow is temporarily unavailable.
 */
export const setOutgoingAudioEnabled = (
  connection: SenderConnectionLike | null | undefined,
  enabled: boolean
): number => {
  const senders = getAudioSenders(connection);
  for (const sender of senders) {
    if (sender.track) sender.track.enabled = enabled;
  }
  return senders.length;
};
