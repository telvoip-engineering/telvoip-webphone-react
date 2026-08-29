const readBoundedInteger = (
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number => {
  const normalized = typeof value === "string" ? value.trim() : "";
  const parsed = normalized ? Number(normalized) : fallback;
  const finite = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(finite)));
};

export const DEFAULT_WRAP_UP_DURATION_SECONDS = 45;
export const DEFAULT_WRAP_UP_REJECT_INCOMING = true;

export const parseWrapUpDurationSeconds = (value: unknown): number =>
  readBoundedInteger(value, DEFAULT_WRAP_UP_DURATION_SECONDS, 0, 300);

export const parseWrapUpMaxExtensions = (value: unknown): number =>
  readBoundedInteger(value, 2, 0, 5);

export const shouldRenderWrapUpTimer = (
  remainingSeconds: number | null | undefined,
  callActive: boolean
): boolean =>
  typeof remainingSeconds === "number" &&
  Number.isFinite(remainingSeconds) &&
  remainingSeconds > 0 &&
  !callActive;

export const shouldRenderWrapUpDialog = (
  remainingSeconds: number | null | undefined,
  hasCallInfo: boolean
): boolean =>
  hasCallInfo &&
  typeof remainingSeconds === "number" &&
  Number.isFinite(remainingSeconds) &&
  remainingSeconds > 0;

export const shouldClearWrapUpDialogInfo = (
  remainingSeconds: number | null | undefined,
  hasCallInfo: boolean
): boolean =>
  hasCallInfo &&
  typeof remainingSeconds === "number" &&
  Number.isFinite(remainingSeconds) &&
  remainingSeconds <= 0;

/**
 * Local ACW protection is enabled by default. Set the public environment value
 * to 0/false to disable it for deployments where the PBX must receive every
 * direct inbound offer during ACW.
 */
export const parseWrapUpRejectIncoming = (value: unknown): boolean => {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (["0", "false"].includes(normalized)) return false;
  if (["1", "true"].includes(normalized)) return true;
  return DEFAULT_WRAP_UP_REJECT_INCOMING;
};

export const shouldRejectIncomingDuringWrapUp = ({
  direction,
  enabled,
  wrapUpDeadlineMs,
  nowMs,
}: {
  direction: string;
  enabled: boolean;
  wrapUpDeadlineMs: number;
  nowMs: number;
}): boolean =>
  enabled &&
  direction === "incoming" &&
  Number.isFinite(wrapUpDeadlineMs) &&
  Number.isFinite(nowMs) &&
  wrapUpDeadlineMs > nowMs;

export const rejectIncomingDuringWrapUp = ({
  direction,
  enabled,
  wrapUpDeadlineMs,
  nowMs,
  primarySessionClear,
  terminate,
}: {
  direction: string;
  enabled: boolean;
  wrapUpDeadlineMs: number;
  nowMs: number;
  primarySessionClear: boolean;
  terminate: (options: { status_code: number; reason_phrase: string }) => void;
}): boolean => {
  if (
    !primarySessionClear ||
    !shouldRejectIncomingDuringWrapUp({
      direction,
      enabled,
      wrapUpDeadlineMs,
      nowMs,
    })
  ) {
    return false;
  }

  terminate({ status_code: 486, reason_phrase: "Busy Here" });
  return true;
};
