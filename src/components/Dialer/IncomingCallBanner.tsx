"use client";

import { type DialerLabels, resolveLabels } from "../labels";
import { PhoneHangupIcon, PhoneIcon } from "../primitives/icons";

export interface IncomingCallBannerProps {
  callerLabel: string;
  onAnswer: () => void;
  onReject: () => void;
  labels?: Partial<DialerLabels>;
}

export default function IncomingCallBanner({
  callerLabel,
  onAnswer,
  onReject,
  labels: labelsOverride,
}: IncomingCallBannerProps) {
  const labels = resolveLabels(labelsOverride);

  return (
    <div className="flex w-72 items-center gap-2.5 rounded-2xl bg-slate-900 py-2 pl-2.5 pr-2 shadow-[0_18px_44px_rgba(15,23,42,0.35)]">
      <span className="flex h-9 w-9 shrink-0 animate-pulse items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
        <PhoneIcon size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-bold text-white">{labels.incomingCall}</p>
        <p className="truncate text-[11px] text-slate-400">{callerLabel}</p>
      </div>
      <button
        type="button"
        onClick={onReject}
        aria-label={labels.reject}
        title={labels.reject}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-500 text-white transition hover:bg-rose-600"
      >
        <PhoneHangupIcon size={16} />
      </button>
      <button
        type="button"
        onClick={onAnswer}
        aria-label={labels.answer}
        title={labels.answer}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white transition hover:bg-emerald-600"
      >
        <PhoneIcon size={16} />
      </button>
    </div>
  );
}
