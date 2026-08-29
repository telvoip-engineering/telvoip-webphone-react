"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

const STORAGE_KEY = "telvoip-webphone:pill-position";
const DRAG_THRESHOLD_PX = 5;
const EDGE_MARGIN_PX = 16;

type Position = { x: number; y: number };
type FractionalPosition = { fx: number; fy: number };

const clampToViewport = (pos: Position, size: { width: number; height: number }): Position => ({
  x: Math.min(Math.max(pos.x, EDGE_MARGIN_PX), Math.max(EDGE_MARGIN_PX, window.innerWidth - size.width - EDGE_MARGIN_PX)),
  y: Math.min(Math.max(pos.y, EDGE_MARGIN_PX), Math.max(EDGE_MARGIN_PX, window.innerHeight - size.height - EDGE_MARGIN_PX)),
});

const readStoredFraction = (): FractionalPosition | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FractionalPosition>;
    if (typeof parsed.fx !== "number" || typeof parsed.fy !== "number") return null;
    return { fx: parsed.fx, fy: parsed.fy };
  } catch {
    return null;
  }
};

const writeStoredFraction = (fraction: FractionalPosition): void => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fraction));
  } catch {
    // ignore storage errors (private mode, quota, ...)
  }
};

export interface DraggablePillProps {
  children: ReactNode;
  /** Set to false for a fixed-corner pill instead of a draggable one. Default true. */
  draggable?: boolean;
  /** Corner used when draggable=false, or as the initial position otherwise. Default "bottom-right". */
  corner?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  className?: string;
}

const CORNER_DEFAULTS: Record<NonNullable<DraggablePillProps["corner"]>, FractionalPosition> = {
  "top-left": { fx: 0, fy: 0 },
  "top-right": { fx: 1, fy: 0 },
  "bottom-left": { fx: 0, fy: 1 },
  "bottom-right": { fx: 1, fy: 1 },
};

/**
 * A free-floating, draggable container so the Dialer never permanently
 * covers the host app's own UI. Hand-rolled on the Pointer Events API
 * rather than a drag library - the need here (one element, no drop zones,
 * no reordering) doesn't justify the dependency weight.
 */
export default function DraggablePill({
  children,
  draggable = true,
  corner = "bottom-right",
  className,
}: DraggablePillProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startPos: Position;
    dragging: boolean;
  } | null>(null);

  const applyFraction = useCallback((fraction: FractionalPosition) => {
    const el = containerRef.current;
    if (!el) return;
    const size = { width: el.offsetWidth, height: el.offsetHeight };
    const raw: Position = {
      x: fraction.fx * (window.innerWidth - size.width),
      y: fraction.fy * (window.innerHeight - size.height),
    };
    setPosition(clampToViewport(raw, size));
  }, []);

  // Initial placement: stored position if draggable and one exists, else the
  // requested corner. Re-runs if `draggable`/`corner` change at runtime.
  useEffect(() => {
    const fraction = (draggable && readStoredFraction()) || CORNER_DEFAULTS[corner];
    applyFraction(fraction);
  }, [draggable, corner, applyFraction]);

  // Re-clamp on resize so the pill can never end up stranded off-screen.
  useEffect(() => {
    const onResize = () => {
      const el = containerRef.current;
      if (!el || !position) return;
      setPosition((prev) =>
        prev ? clampToViewport(prev, { width: el.offsetWidth, height: el.offsetHeight }) : prev
      );
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-clamps against latest `position` via the functional updater, doesn't need it as a dep
  }, []);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!draggable || !position) return;
      // Ignore secondary buttons / multi-touch.
      if (event.button !== 0) return;
      dragStateRef.current = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startPos: position,
        dragging: false,
      };
    },
    [draggable, position]
  );

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    const el = containerRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !el) return;

    const dx = event.clientX - drag.startClientX;
    const dy = event.clientY - drag.startClientY;

    if (!drag.dragging) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      drag.dragging = true;
      el.setPointerCapture(event.pointerId);
    }

    const next = clampToViewport(
      { x: drag.startPos.x + dx, y: drag.startPos.y + dy },
      { width: el.offsetWidth, height: el.offsetHeight }
    );
    setPosition(next);
  }, []);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    const el = containerRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (drag.dragging && el) {
      try {
        el.releasePointerCapture(event.pointerId);
      } catch {
        // already released
      }
      const size = { width: el.offsetWidth, height: el.offsetHeight };
      const denomX = Math.max(1, window.innerWidth - size.width);
      const denomY = Math.max(1, window.innerHeight - size.height);
      const rect = el.getBoundingClientRect();
      writeStoredFraction({ fx: rect.left / denomX, fy: rect.top / denomY });

      // A completed drag still dispatches a trailing click on whatever
      // child element is under the pointer (e.g. the expand/collapse
      // toggle) - swallow exactly that one click so dragging the pill
      // never also toggles it.
      const swallowNextClick = (clickEvent: MouseEvent) => {
        clickEvent.stopPropagation();
        clickEvent.preventDefault();
      };
      el.addEventListener("click", swallowNextClick, { capture: true, once: true });
    }
    dragStateRef.current = null;
  }, []);

  return (
    <div
      ref={containerRef}
      className={`fixed z-[21999] ${draggable ? "touch-none select-none" : ""} ${className ?? ""}`}
      style={{
        left: position?.x ?? 0,
        top: position?.y ?? 0,
        visibility: position ? "visible" : "hidden",
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {children}
    </div>
  );
}
