"use client";

import { type DialerLabels, resolveLabels } from "../labels";
import { BellIcon, PhoneIcon } from "../primitives/icons";

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
  const initial = /^[a-z]/i.test(callerLabel.trim()) ? callerLabel.trim()[0]!.toUpperCase() : null;

  return (
    <div
      role="alert"
      aria-label={labels.incomingCall}
      className="flex w-72 flex-col gap-3 rounded-2xl bg-slate-900 p-4 shadow-[0_18px_44px_rgba(15,23,42,0.35)]"
    >
      <div className="flex items-center gap-3">
        <div className="relative shrink-0">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-slate-600 to-slate-700 text-base font-bold text-white">
            {initial ?? <PhoneIcon size={18} />}
          </div>
          <span
            aria-hidden="true"
            className="absolute -left-1 -top-1 flex h-5 w-5 animate-pulse items-center justify-center rounded-full bg-blue-500 text-white ring-2 ring-slate-900"
          >
            <BellIcon size={11} />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-bold text-white">{callerLabel}</p>
          <p className="truncate text-[12px] text-slate-400">{labels.incomingCallStatus}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onAnswer}
        className="w-full rounded-xl bg-teal-500 py-2.5 text-[13px] font-bold text-white transition hover:bg-teal-600"
      >
        {labels.answer}
      </button>
      <button
        type="button"
        onClick={onReject}
        className="w-full rounded-xl bg-[#f0604a] py-2.5 text-[13px] font-bold text-white transition hover:bg-[#dd4f3a]"
      >
        {labels.reject}
      </button>
    </div>
  );
}
