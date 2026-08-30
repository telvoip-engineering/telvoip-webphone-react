import { afterAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// See DraggablePill.test.tsx for why this is registered per-file rather
// than globally.
GlobalRegistrator.register();

const { render, cleanup } = await import("@testing-library/react");
const { default: DialPad } = await import("./DialPad");

describe("DialPad - portal renders with a .twp-root ancestor", () => {
  afterAll(() => {
    cleanup();
    void GlobalRegistrator.unregister();
  });

  test("createPortal content has .twp-root as a genuine ancestor of the positioned popup, not co-located on it", () => {
    // DialPad portals straight to document.body, escaping whatever DOM
    // tree it was called from - it can't rely on an ancestor elsewhere on
    // the page supplying .twp-root, so it must carry its own. Regression
    // test for the same bug class DraggablePill.test.tsx covers: this is
    // the "settings/dial pad dropdown renders off-screen at the far left"
    // symptom a real user hit, traced to `fixed` never actually applying.
    render(
      <DialPad
        top={100}
        left={100}
        dialInput=""
        inCallMode={false}
        onInputChange={() => {}}
        onClearInput={() => {}}
        onBackspace={() => {}}
        onDigit={() => {}}
        onCall={() => {}}
        onClose={() => {}}
      />
    );

    const popup = document.body.querySelector('[data-webphone-popup="dialpad"]');
    expect(popup).not.toBeNull();
    expect(popup?.classList.contains("fixed")).toBe(true);
    expect(popup?.classList.contains("twp-root")).toBe(false);

    const twpRootAncestor = popup?.closest(".twp-root");
    expect(twpRootAncestor).not.toBeNull();
    expect(twpRootAncestor).not.toBe(popup);

    cleanup();
  });
});
