export type SipSessionTimerRefreshMethod = "invite" | "update";

export const parseSessionTimersRefreshMethod = (value: unknown): SipSessionTimerRefreshMethod =>
  typeof value === "string" && value.trim().toLowerCase() === "invite" ? "invite" : "update";

/**
 * Keep JsSIP's RFC 4028 negotiation default unless a deployment explicitly
 * opts in. Forcing the browser as refresher changes the initial INVITE's
 * Session-Expires header and is not accepted by every SIP intermediary.
 */
export const parseSessionTimersForceRefresher = (value: unknown): boolean =>
  typeof value === "string" && ["1", "true"].includes(value.trim().toLowerCase());
