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
  //
  // Deferred one frame: this measures the element's own rendered size
  // (offsetWidth/offsetHeight) to compute where "the corner" actually is,
  // and that measurement is only correct once the stylesheet defining this
  // element's real layout (flex/padding/etc., all scoped under .twp-root)
  // has actually been applied. A synchronous effect can in some setups run
  // before an async-injected <style> tag takes effect, measuring the
  // pre-CSS (e.g. full-width block) layout instead - producing a bogus
  // "corner" position. requestAnimationFrame pushes the measurement past
  // that window without a magic timeout.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const fraction = (draggable && readStoredFraction()) || CORNER_DEFAULTS[corner];
      applyFraction(fraction);
    });
    return () => cancelAnimationFrame(frame);
  }, [draggable, corner, applyFraction]);

  // Re-clamp whenever the *viewport* resizes, so the pill can never end up
  // stranded off-screen if the window shrinks below where it currently sits.
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

  // Re-clamp whenever *this element's own* rendered size changes - a
  // right/bottom-anchored pill is positioned via a fixed left/top pixel
  // offset, which doesn't automatically track content growth. Expanding
  // the collapsed pill (adding buttons/text) grows it to the right; without
  // this, a pill anchored near the right edge would render partially
  // off-screen the moment it expanded, since "grow right" has nowhere to
  // go there. ResizeObserver catches every size-changing cause (expand/
  // collapse, a popup adding height, font-loading reflow), not just window
  // resize.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => {
      setPosition((prev) =>
        prev ? clampToViewport(prev, { width: el.offsetWidth, height: el.offsetHeight }) : prev
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
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
    // Tailwind's `important: ".twp-root"` config generates a *descendant*
    // selector (`.twp-root .fixed { ... !important }`) - it requires
    // .twp-root to be an ancestor, not co-located on the same element as
    // the utility classes it's scoping. This outer div exists purely to be
    // that ancestor for the actual positioned/draggable div below (and for
    // this component's own `className` prop, which may reference themed
    // utility classes too).
    <div className="twp-root">
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
    </div>
  );
}
