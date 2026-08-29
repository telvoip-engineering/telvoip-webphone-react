"use client";

import { type DialerLabels, resolveLabels } from "../labels";
import type { WrapUpCallSummary } from "../types";
import { CloseIcon, PhoneIcon, PhoneHangupIcon } from "./icons";

export interface WrapUpCardProps {
  remainingSeconds: number;
  totalSeconds: number;
  extensionsLeft: number;
  onSkip: () => void;
  onExtend: () => void;
  /** Optional snapshot of the call that just ended - purely cosmetic. */
  callSummary?: WrapUpCallSummary | null;
  labels?: Partial<DialerLabels>;
}

const formatDuration = (seconds: number): string => {
  const total = Math.max(0, Math.round(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

export default function WrapUpCard({
  remainingSeconds,
  totalSeconds,
  extensionsLeft,
  onSkip,
  onExtend,
  callSummary,
  labels: labelsOverride,
}: WrapUpCardProps) {
  const labels = resolveLabels(labelsOverride);
  const progress = totalSeconds > 0 ? Math.min(1, Math.max(0, remainingSeconds / totalSeconds)) : 0;
  const DirectionIcon = callSummary?.direction === "incoming" ? PhoneIcon : PhoneHangupIcon;

  return (
    <div
      role="dialog"
      aria-label={labels.wrapUpTitle}
      className="twp-root flex w-[calc(100vw-32px)] max-w-[380px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_18px_44px_rgba(15,23,42,0.22)]"
    >
      <div className="flex items-center gap-2 px-3.5 py-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
          <DirectionIcon size={13} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-bold text-slate-900">
            {callSummary?.displayName || callSummary?.identifier || labels.wrapUpEndedCall}
          </p>
          {typeof callSummary?.durationSeconds === "number" ? (
            <p className="truncate text-[11px] text-slate-500">
              {formatDuration(callSummary.durationSeconds)}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onSkip}
          aria-label={labels.wrapUpSkip}
          className="shrink-0 rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
        >
          <CloseIcon size={15} />
        </button>
      </div>

      <div className="px-3.5 pb-3.5">
        <div className="mb-2 flex items-center justify-between text-[11px] font-semibold text-slate-600">
          <span>{labels.wrapUpTitle}</span>
          <span className="tabular-nums">{formatDuration(remainingSeconds)}</span>
        </div>
        <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-1000 ease-linear"
            style={{ width: `${progress * 100}%` }}
          />
        </div>

        <div className="flex items-center justify-end gap-2">
          {extensionsLeft > 0 ? (
            <button
              type="button"
              onClick={onExtend}
              className="rounded-lg px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600 transition hover:bg-slate-100"
            >
              {labels.wrapUpExtend}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onSkip}
            className="rounded-lg bg-primary px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary-contrast transition hover:opacity-90"
          >
            {labels.wrapUpSkip}
          </button>
        </div>
      </div>
    </div>
  );
}
