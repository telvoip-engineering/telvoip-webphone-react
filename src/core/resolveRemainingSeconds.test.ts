import { describe, expect, test } from "bun:test";
import { resolveRemainingSeconds } from "./resolveRemainingSeconds";

describe("resolveRemainingSeconds — balance_minutes path (new ledger)", () => {
  test("34 minutes → 2040 seconds", () => {
    expect(resolveRemainingSeconds({ balance_minutes: 34 })).toBe(2040);
  });

  test("34.5 minutes → floor(34.5 * 60) = 2070 seconds", () => {
    expect(resolveRemainingSeconds({ balance_minutes: 34.5 })).toBe(2070);
  });

  test("0 minutes → 0 (depleted wallet, must not be negative)", () => {
    expect(resolveRemainingSeconds({ balance_minutes: 0 })).toBe(0);
  });

  test("negative balance_minutes → 0 (never negative)", () => {
    expect(resolveRemainingSeconds({ balance_minutes: -5 })).toBe(0);
  });

  test("very large balance (10000 min) → 600000 seconds", () => {
    expect(resolveRemainingSeconds({ balance_minutes: 10000 })).toBe(600000);
  });

  test("string '34' coerces to 2040 seconds", () => {
    expect(resolveRemainingSeconds({ balance_minutes: "34" })).toBe(2040);
  });

  test("balance_minutes takes priority over seconds_remaining when both present", () => {
    expect(resolveRemainingSeconds({ balance_minutes: 10, seconds_remaining: 999 })).toBe(600);
  });

  test("balance_minutes takes priority over purchased/used when both present", () => {
    expect(
      resolveRemainingSeconds({ balance_minutes: 5, seconds_purchased: 3600, seconds_used: 0 })
    ).toBe(300);
  });
});

describe("resolveRemainingSeconds — direct seconds fields (legacy socket)", () => {
  test("seconds_remaining = 1800 → 1800", () => {
    expect(resolveRemainingSeconds({ seconds_remaining: 1800 })).toBe(1800);
  });

  test("remaining_seconds = 600 → 600", () => {
    expect(resolveRemainingSeconds({ remaining_seconds: 600 })).toBe(600);
  });

  test("remaining = 300 → 300", () => {
    expect(resolveRemainingSeconds({ remaining: 300 })).toBe(300);
  });

  test("available_seconds = 120 → 120", () => {
    expect(resolveRemainingSeconds({ available_seconds: 120 })).toBe(120);
  });

  test("balance = 60 → 60", () => {
    expect(resolveRemainingSeconds({ balance: 60 })).toBe(60);
  });

  test("direct seconds value = 0 → 0", () => {
    expect(resolveRemainingSeconds({ seconds_remaining: 0 })).toBe(0);
  });

  test("fractional seconds are floored", () => {
    expect(resolveRemainingSeconds({ seconds_remaining: 300.9 })).toBe(300);
  });

  test("seconds_remaining = -100 → 0 (clamp negative)", () => {
    expect(resolveRemainingSeconds({ seconds_remaining: -100 })).toBe(0);
  });

  test("seconds_remaining priority over remaining when both present", () => {
    expect(resolveRemainingSeconds({ seconds_remaining: 100, remaining: 999 })).toBe(100);
  });
});

describe("resolveRemainingSeconds — null / missing payload", () => {
  test("empty payload → null", () => {
    expect(resolveRemainingSeconds({})).toBeNull();
  });

  test("balance_minutes = null (JS null) → falls through to other fields", () => {
    expect(resolveRemainingSeconds({ balance_minutes: null, seconds_remaining: 120 })).toBe(120);
  });

  test("balance_minutes = undefined → falls through", () => {
    expect(resolveRemainingSeconds({ balance_minutes: undefined, remaining: 60 })).toBe(60);
  });

  test("balance_minutes = NaN → falls through (NaN is not finite)", () => {
    expect(resolveRemainingSeconds({ balance_minutes: NaN, seconds_remaining: 90 })).toBe(90);
  });

  test("balance_minutes = Infinity → falls through", () => {
    expect(resolveRemainingSeconds({ balance_minutes: Infinity, balance: 45 })).toBe(45);
  });

  test("all fields absent → null", () => {
    expect(resolveRemainingSeconds({ some_other_field: 999 })).toBeNull();
  });

  test("only one of purchased/used present → null (can't compute diff)", () => {
    expect(resolveRemainingSeconds({ seconds_purchased: 3600 })).toBeNull();
    expect(resolveRemainingSeconds({ seconds_used: 300 })).toBeNull();
  });
});
