import { describe, expect, test } from "bun:test";
import {
  parseSessionTimersForceRefresher,
  parseSessionTimersRefreshMethod,
} from "./sipSessionTimerConfig";

describe("parseSessionTimersRefreshMethod", () => {
  test("uses JsSIP's UPDATE default unless INVITE is explicitly selected", () => {
    expect(parseSessionTimersRefreshMethod(undefined)).toBe("update");
    expect(parseSessionTimersRefreshMethod("update")).toBe("update");
    expect(parseSessionTimersRefreshMethod(" INVITE ")).toBe("invite");
    expect(parseSessionTimersRefreshMethod("invalid")).toBe("update");
  });
});

describe("parseSessionTimersForceRefresher", () => {
  test("preserves the negotiated JsSIP default when unset or disabled", () => {
    expect(parseSessionTimersForceRefresher(undefined)).toBe(false);
    expect(parseSessionTimersForceRefresher(null)).toBe(false);
    expect(parseSessionTimersForceRefresher("0")).toBe(false);
    expect(parseSessionTimersForceRefresher("false")).toBe(false);
    expect(parseSessionTimersForceRefresher("invalid")).toBe(false);
  });

  test("forces the browser refresher only through an explicit opt-in", () => {
    expect(parseSessionTimersForceRefresher("1")).toBe(true);
    expect(parseSessionTimersForceRefresher(" true ")).toBe(true);
  });
});
