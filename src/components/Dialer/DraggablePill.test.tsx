import { afterAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// This file needs a real DOM (createPortal, getBoundingClientRect,
// pointer events) - registered only for this file, not globally, since
// several other test files install their own hand-rolled fake
// window/document via Object.defineProperty and a competing real DOM
// would fight with that.
GlobalRegistrator.register();

const { render, cleanup } = await import("@testing-library/react");
const { default: DraggablePill } = await import("./DraggablePill");

describe("DraggablePill - .twp-root ancestor scoping", () => {
  afterAll(() => {
    cleanup();
    void GlobalRegistrator.unregister();
  });

  test("the positioned/draggable element is a *descendant* of the .twp-root marker, never the same element", () => {
    // Tailwind's `important: ".twp-root"` config generates a descendant
    // selector (`.twp-root .fixed { ... !important }`). If "twp-root" and
    // "fixed" ever end up as classes on the *same* element again, that
    // selector silently never matches and position:fixed never applies -
    // exactly the bug a real user hit (the pill rendered in normal
    // document flow instead of floating, undraggable, at the top-left of
    // the page instead of the requested corner).
    const { container } = render(
      <DraggablePill draggable corner="bottom-right">
        <div data-testid="pill-content">content</div>
      </DraggablePill>
    );

    const twpRootEl = container.querySelector(".twp-root");
    expect(twpRootEl).not.toBeNull();

    const fixedEl = container.querySelector(".fixed");
    expect(fixedEl).not.toBeNull();

    // Must be two different elements ...
    expect(fixedEl).not.toBe(twpRootEl);
    // ... with twp-root as a genuine ancestor of the fixed element.
    expect(twpRootEl?.contains(fixedEl!)).toBe(true);
    expect(fixedEl?.classList.contains("twp-root")).toBe(false);

    cleanup();
  });

  test("draggable=false still nests correctly (fixed-corner fallback path)", () => {
    const { container } = render(
      <DraggablePill draggable={false} corner="top-left">
        <div>content</div>
      </DraggablePill>
    );

    const twpRootEl = container.querySelector(".twp-root");
    const fixedEl = container.querySelector(".fixed");
    expect(twpRootEl).not.toBeNull();
    expect(fixedEl).not.toBeNull();
    expect(twpRootEl?.contains(fixedEl!)).toBe(true);

    cleanup();
  });
});
