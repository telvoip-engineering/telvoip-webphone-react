export type ControlButtonAppearance = "default" | "positive" | "destructive";

/**
 * A blind-transfer target. Unlike the source app's CRM-shaped TransferAgent
 * (extension/sip_user/msisdn/tags/... pulled from a directory lookup), this
 * package has no concept of a contact/agent directory - a consumer who wants
 * one wires it themselves (e.g. via TransferPad's onSearch prop) and maps
 * results into this shape.
 */
export interface TransferTarget {
  /** The literal string passed to transferCall() - an extension, number, or SIP URI. */
  target: string;
  /** Optional display label; falls back to `target` when omitted. */
  label?: string;
}

/**
 * A snapshot of the call that just ended, for display in WrapUpCard.
 * Deliberately minimal - this package has no call-log/CRM backend to
 * enrich it with (the source app's version resolves a full call-log row
 * to attach disposition tags and notes; that's app-specific persistence
 * out of scope here). Capture your own richer summary via useSIPClient's
 * onCallSummary option if you need one.
 */
export interface WrapUpCallSummary {
  displayName?: string | null;
  identifier?: string | null;
  direction?: "incoming" | "outgoing" | null;
  durationSeconds?: number;
}
