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
    <div className="flex items-center gap-3 rounded-full border border-emerald-200 bg-white py-2 pl-4 pr-2 shadow-[0_18px_44px_rgba(15,23,42,0.22)]">
      <span className="flex h-8 w-8 shrink-0 animate-pulse items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
        <PhoneIcon size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-bold text-slate-900">{labels.incomingCall}</p>
        <p className="truncate text-[11px] text-slate-500">{callerLabel}</p>
      </div>
      <button
        type="button"
        onClick={onReject}
        aria-label={labels.reject}
        title={labels.reject}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-rose-200 bg-rose-50 text-rose-600 transition hover:bg-rose-100"
      >
        <PhoneHangupIcon size={16} />
      </button>
      <button
        type="button"
        onClick={onAnswer}
        aria-label={labels.answer}
        title={labels.answer}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-emerald-300 bg-emerald-500 text-white transition hover:bg-emerald-600"
      >
        <PhoneIcon size={16} />
      </button>
    </div>
  );
}
