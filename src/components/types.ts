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

/** A caller ID/DID the current agent is allowed to use for outbound calls. */
export interface OutboundDid {
  /** Stable ID understood by the consumer's backend. */
  id: string | number;
  /** Number shown to the agent and used as the outbound caller ID. */
  number: string;
  /** Optional friendly name, provider, or team label. */
  label?: string;
  /** Marks the DID currently selected as the default. */
  selected?: boolean;
}

export interface DialerProps {
  /** Set to false for a fixed-corner pill instead of a draggable one. Default true. */
  draggable?: boolean;
  corner?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  /** Override any subset of the UI's default (English) strings. */
  labels?: Partial<import("./labels").DialerLabels>;
  /**
   * Optional directory search for the transfer pad - see TransferPad's
   * matching props. Omit for a plain numeric transfer pad.
   */
  onTransferSearch?: (query: string) => void;
  transferCandidates?: TransferTarget[];
  transferCandidatesLoading?: boolean;
  /** DIDs the signed-in agent may select as their default outbound caller ID. */
  outboundDids?: OutboundDid[];
  /** Persist an outbound DID selection in the consumer's backend. */
  onOutboundDidSelect?: (did: OutboundDid) => void | Promise<void>;
  outboundDidSelecting?: boolean;
  className?: string;
}
