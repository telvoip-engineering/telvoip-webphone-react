"use client";

import { createPortal } from "react-dom";
import { type DialerLabels, resolveLabels } from "../labels";
import type { TransferTarget } from "../types";
import { CloseIcon, SearchIcon, TransferIcon } from "./icons";

export interface TransferPadProps {
  transferInput: string;
  transferLoading: boolean;
  selectedTransferTarget: string;
  onInputChange: (value: string) => void;
  onClearInput: () => void;
  onDigit: (digit: string) => void;
  onTransfer: () => void;
  onClose: () => void;
  labels?: Partial<DialerLabels>;
  /**
   * Optional directory search - this package has no concept of a contact/
   * agent directory (that's app-specific data), so this whole section only
   * renders when a consumer wires it. Pass `candidates` (the current search
   * results) and `onSearch` (called as `transferInput` changes); omit both
   * for a plain numeric transfer pad.
   */
  candidates?: TransferTarget[];
  candidatesLoading?: boolean;
  onSearch?: (query: string) => void;
  onSelectCandidate?: (target: string) => void;
}

const TRANSFER_DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#", "+"];

export default function TransferPad({
  transferInput,
  transferLoading,
  selectedTransferTarget,
  onInputChange,
  onClearInput,
  onDigit,
  onTransfer,
  onClose,
  labels: labelsOverride,
  candidates,
  candidatesLoading = false,
  onSearch,
  onSelectCandidate,
}: TransferPadProps) {
  const labels = resolveLabels(labelsOverride);
  const showDirectory = Boolean(onSearch && onSelectCandidate);

  return createPortal(
    <div
      data-webphone-popup="transfer"
      className="twp-root pointer-events-auto fixed inset-0 z-[22000] flex items-center justify-center bg-black/30 p-4"
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_24px_60px_rgba(15,23,42,0.25)]">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">{labels.transfer}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
          >
            {labels.transferCancel}
          </button>
        </div>

        <div className="mb-2 rounded-xl bg-white p-2 shadow-[inset_0_0_0_1px_rgba(226,232,240,0.9)]">
          <div className="flex items-center gap-2">
            {showDirectory ? <SearchIcon size={16} className="text-slate-400" /> : null}
            <input
              type="text"
              aria-label={labels.transferPlaceholder}
              value={transferInput}
              onChange={(event) => {
                const next = event.target.value.slice(0, 64);
                onInputChange(next);
                onSearch?.(next);
              }}
              placeholder={labels.transferPlaceholder}
              className="w-full border-0 bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
            />
            <button
              type="button"
              onClick={onClearInput}
              className={`flex h-7 w-7 items-center justify-center bg-white text-slate-500 transition hover:text-slate-700 ${transferInput ? "" : "invisible"}`}
              aria-label={labels.clear}
            >
              <CloseIcon size={16} />
            </button>
          </div>
        </div>

        {showDirectory ? (
          <div className="mb-3 h-32 overflow-y-auto rounded-xl bg-white p-2 shadow-[inset_0_0_0_1px_rgba(226,232,240,0.9)]">
            {candidatesLoading ? (
              <p className="px-2 py-2 text-[11px] text-slate-500">…</p>
            ) : candidates && candidates.length ? (
              <div className="space-y-1">
                {candidates.map((candidate) => {
                  const label = candidate.label || candidate.target;
                  const selected = selectedTransferTarget === candidate.target;
                  return (
                    <button
                      key={candidate.target}
                      type="button"
                      onClick={() => onSelectCandidate?.(candidate.target)}
                      className={`group flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs transition ${
                        selected
                          ? "bg-white text-primary"
                          : "bg-white text-slate-800 hover:bg-slate-50"
                      }`}
                    >
                      <span className="min-w-0">
                        <span
                          className={`block truncate font-medium ${selected ? "text-primary" : "text-slate-800"}`}
                        >
                          {label}
                        </span>
                        {candidate.label ? (
                          <span
                            className={`block truncate text-[10px] ${selected ? "text-primary/70" : "text-slate-500"}`}
                          >
                            {candidate.target}
                          </span>
                        ) : null}
                      </span>
                      <TransferIcon
                        size={14}
                        className={selected ? "text-primary" : "text-slate-400"}
                      />
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="px-2 py-3 text-xs text-slate-500">—</p>
            )}
          </div>
        ) : null}

        <div className="grid grid-cols-3 gap-2">
          {TRANSFER_DIGITS.map((digit) => (
            <button
              key={digit}
              type="button"
              onClick={() => onDigit(digit)}
              className="flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-base font-semibold text-slate-700 transition hover:border-primary hover:text-primary"
            >
              {digit}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onTransfer}
          disabled={transferLoading || !(selectedTransferTarget || transferInput.trim())}
          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <TransferIcon size={16} />
          {transferLoading ? `${labels.transfer}…` : labels.transferSubmit}
        </button>
      </div>
    </div>,
    document.body
  );
}
