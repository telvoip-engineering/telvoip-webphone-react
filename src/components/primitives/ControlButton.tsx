"use client";

import { type ReactNode, type MouseEvent as ReactMouseEvent } from "react";
import type { ControlButtonAppearance } from "../types";

const CONTROL_BUTTON_PALETTE: Record<ControlButtonAppearance, { base: string; active: string }> = {
  default: {
    base: "border-slate-200 bg-white/90 text-slate-600 hover:border-primary/30 hover:text-primary",
    active: "border-primary/40 bg-slate-100 text-primary",
  },
  positive: {
    base: "border-emerald-300 bg-emerald-500 text-white hover:bg-emerald-600 hover:border-emerald-300",
    active: "bg-emerald-600 text-white border-emerald-300",
  },
  destructive: {
    base: "border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 hover:text-rose-700",
    active: "bg-rose-500 text-white border-rose-200 hover:bg-rose-600",
  },
};

export interface ControlButtonProps {
  active?: boolean;
  appearance?: ControlButtonAppearance;
  children: ReactNode;
  disabled?: boolean;
  onClick?: (e?: ReactMouseEvent<HTMLButtonElement>) => void;
  title?: string;
}

const ControlButton = ({
  active = false,
  appearance = "default",
  children,
  disabled = false,
  onClick,
  title,
}: ControlButtonProps) => {
  const variant = CONTROL_BUTTON_PALETTE[appearance] || CONTROL_BUTTON_PALETTE.default;
  const base =
    "flex h-8 w-8 items-center justify-center rounded-full border text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";
  const hover = disabled ? "" : "hover:-translate-y-px";
  const state = disabled ? "cursor-not-allowed opacity-50" : "";

  return (
    <button
      type="button"
      title={title}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`${base} ${hover} ${state} ${variant.base} ${active ? variant.active : ""}`}
    >
      {children}
    </button>
  );
};

export default ControlButton;
