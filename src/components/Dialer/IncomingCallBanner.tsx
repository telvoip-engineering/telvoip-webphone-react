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
      className="flex w-80 flex-col gap-4 rounded-2xl border border-white/10 bg-[#202831] p-4"
    >
      <div className="flex items-center gap-3">
        <div className="relative shrink-0">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-700 text-base font-bold text-white">
            {initial ?? <PhoneIcon size={18} />}
          </div>
          <span
            aria-hidden="true"
            className="absolute -left-1 -top-1 flex h-5 w-5 animate-pulse items-center justify-center rounded-full bg-blue-500 text-white"
          >
            <BellIcon size={11} />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-bold text-white">{callerLabel}</p>
          <p className="truncate text-[12px] text-slate-400">{labels.incomingCallStatus}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <button type="button" onClick={onAnswer} className="rounded-xl bg-teal-500 py-3 text-[13px] font-semibold text-white transition hover:bg-teal-400">{labels.answer}</button>
        <button type="button" onClick={onReject} className="rounded-xl bg-[#ef5144] py-3 text-[13px] font-semibold text-white transition hover:bg-[#f16155]">{labels.reject}</button>
      </div>
    </div>
  );
}
