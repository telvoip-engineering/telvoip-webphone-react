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
    // Outer .twp-root is the required ancestor for the important-selector
    // scoping (see DraggablePill.tsx's comment) - portaled content escapes
    // whatever DOM tree it was called from, so it can't rely on an ancestor
    // higher up the page providing this.
    <div className="twp-root">
      <div
        data-webphone-popup="dialpad"
        className="pointer-events-auto fixed z-[22000] w-72 rounded-2xl border border-white/10 bg-[#202831] p-3 text-white"
        style={{ top, left }}
      >
        {inCallMode ? (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-medium text-slate-100">
          <span className="truncate">{dialInput || labels.dtmfPlaceholder}</span>
          {dialInput ? (
            <button
              type="button"
              onClick={onBackspace}
              className="ml-auto text-slate-400 hover:text-white"
              aria-label={labels.backspace}
            >
              <BackspaceIcon size={16} />
            </button>
          ) : null}
        </div>
      ) : (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] p-2">
          <input
            type="text"
            aria-label={labels.dialPlaceholder}
            value={dialInput}
            onChange={(event) => onInputChange(event.target.value.slice(0, 64))}
            placeholder={labels.dialPlaceholder}
            className="w-full border-0 bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
          />
          <button
            type="button"
            onClick={onClearInput}
            className={`flex h-7 w-7 items-center justify-center text-slate-400 transition hover:text-white ${dialInput ? "" : "invisible"}`}
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
              className="flex h-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-base font-medium text-slate-100 transition hover:bg-white/[0.09]"
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
          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-white/[0.1]"
        >
          <CloseIcon size={16} />
          {labels.closeDtmf}
        </button>
      ) : (
        <button
          type="button"
          onClick={onCall}
          disabled={!dialInput}
          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-teal-500 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <PhoneIcon size={16} />
          {labels.call}
        </button>
        )}
      </div>
    </div>,
    document.body
  );
}
