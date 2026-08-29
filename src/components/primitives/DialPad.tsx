"use client";

import { createPortal } from "react-dom";
import { type DialerLabels, resolveLabels } from "../labels";
import { BackspaceIcon, CloseIcon, PhoneIcon } from "./icons";

const DIGITS_IN_CALL = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];
const DIGITS_DIALING = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "*",
  "0",
  "#",
  "+",
  "spacer",
  "backspace",
];

export interface DialPadProps {
  top: number;
  left: number;
  dialInput: string;
  /** True when this is the in-call DTMF keypad rather than the pre-call dialer. */
  inCallMode: boolean;
  onInputChange: (value: string) => void;
  onClearInput: () => void;
  onBackspace: () => void;
  onDigit: (digit: string) => void;
  onCall: () => void;
  onClose: () => void;
  labels?: Partial<DialerLabels>;
}

export default function DialPad({
  top,
  left,
  dialInput,
  inCallMode,
  onInputChange,
  onClearInput,
  onBackspace,
  onDigit,
  onCall,
  onClose,
  labels: labelsOverride,
}: DialPadProps) {
  const labels = resolveLabels(labelsOverride);

  return createPortal(
    <div
      data-webphone-popup="dialpad"
      className="twp-root pointer-events-auto fixed z-[22000] w-72 rounded-2xl border border-slate-200 bg-white p-3 text-slate-800 shadow-[0_24px_60px_rgba(15,23,42,0.25)] ring-1 ring-slate-100"
      style={{ top, left }}
    >
      {inCallMode ? (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
          <span className="truncate">{dialInput || labels.dtmfPlaceholder}</span>
          {dialInput ? (
            <button
              type="button"
              onClick={onBackspace}
              className="ml-auto text-slate-500 hover:text-primary"
              aria-label={labels.backspace}
            >
              <BackspaceIcon size={16} />
            </button>
          ) : null}
        </div>
      ) : (
        <div className="mb-3 flex items-center gap-2 rounded-xl bg-white p-2 shadow-[inset_0_0_0_1px_rgba(226,232,240,0.9)]">
          <input
            type="text"
            aria-label={labels.dialPlaceholder}
            value={dialInput}
            onChange={(event) => onInputChange(event.target.value.slice(0, 64))}
            placeholder={labels.dialPlaceholder}
            className="w-full border-0 bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
          />
          <button
            type="button"
            onClick={onClearInput}
            className={`flex h-7 w-7 items-center justify-center bg-white text-slate-500 transition hover:text-slate-700 ${dialInput ? "" : "invisible"}`}
            aria-label={labels.clear}
          >
            <CloseIcon size={16} />
          </button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        {(inCallMode ? DIGITS_IN_CALL : DIGITS_DIALING).map((digit) => {
          if (digit === "spacer") {
            return <div key="spacer" className="h-10" aria-hidden="true" />;
          }

          return (
            <button
              key={digit}
              type="button"
              onClick={() => {
                if (digit === "backspace") {
                  onBackspace();
                  return;
                }
                onDigit(digit);
              }}
              aria-label={digit === "backspace" ? labels.backspace : undefined}
              className="flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-base font-semibold text-slate-700 transition hover:border-primary hover:text-primary"
            >
              {digit === "backspace" ? <BackspaceIcon size={18} /> : digit}
            </button>
          );
        })}
      </div>

      {inCallMode ? (
        <button
          type="button"
          onClick={onClose}
          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
        >
          <CloseIcon size={16} />
          {labels.closeDtmf}
        </button>
      ) : (
        <button
          type="button"
          onClick={onCall}
          disabled={!dialInput}
          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <PhoneIcon size={16} />
          {labels.call}
        </button>
      )}
    </div>,
    document.body
  );
}
