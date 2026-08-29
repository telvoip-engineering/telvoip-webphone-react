import JsSIP from "jssip";

export type SipSessionEndFailureKind =
  "setup-signaling" | "mid-call-signaling" | "session-signaling-timeout" | "media" | null;

export interface SipSessionEndClassification {
  failed: boolean;
  failureKind: SipSessionEndFailureKind;
  message: string | null;
}

interface ClassifySipSessionEndOptions {
  cause: string | null;
  formattedFailure: string;
  hadConnectedMedia: boolean;
  endedLocally: boolean;
  reasonPhrase?: string | null;
  setupFailureReason?: string | null;
  statusCode?: number | null;
}

const normalize = (value: string | null | undefined): string => value?.trim().toLowerCase() || "";

export const classifySipSessionEnd = ({
  cause,
  formattedFailure,
  hadConnectedMedia,
  endedLocally,
  reasonPhrase,
  setupFailureReason,
  statusCode,
}: ClassifySipSessionEndOptions): SipSessionEndClassification => {
  if (endedLocally) {
    return { failed: false, failureKind: null, message: null };
  }

  if (setupFailureReason) {
    return {
      failed: true,
      failureKind: "setup-signaling",
      message: setupFailureReason,
    };
  }

  const normalizedCause = normalize(cause);
  const normalizedReason = normalize(reasonPhrase);
  const causes = JsSIP.C.causes;

  if (cause === causes.NO_ACK) {
    return hadConnectedMedia
      ? {
          failed: true,
          failureKind: "mid-call-signaling",
          message:
            "Call ended during a mid-call SIP update because the browser did not receive the PBX ACK (No ACK).",
        }
      : {
          failed: true,
          failureKind: "setup-signaling",
          message: "Call setup failed because the browser did not receive the PBX ACK (No ACK).",
        };
  }

  const sessionSignalingTimedOut =
    cause === causes.REQUEST_TIMEOUT ||
    normalizedReason.includes("session timer expired") ||
    (hadConnectedMedia && statusCode === 408);
  if (sessionSignalingTimedOut) {
    return {
      failed: true,
      failureKind: "session-signaling-timeout",
      message: hadConnectedMedia
        ? "The active call ended because a SIP session update timed out."
        : formattedFailure,
    };
  }

  const mediaFailed =
    cause === causes.RTP_TIMEOUT ||
    cause === causes.WEBRTC_ERROR ||
    normalizedCause.includes("ice failed");
  if (mediaFailed) {
    return {
      failed: true,
      failureKind: "media",
      message: formattedFailure,
    };
  }

  return { failed: false, failureKind: null, message: null };
};
