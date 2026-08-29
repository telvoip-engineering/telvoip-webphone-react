import { describe, expect, test } from "bun:test";
import {
  DEFAULT_WRAP_UP_DURATION_SECONDS,
  DEFAULT_WRAP_UP_REJECT_INCOMING,
  parseWrapUpDurationSeconds,
  parseWrapUpMaxExtensions,
  parseWrapUpRejectIncoming,
  rejectIncomingDuringWrapUp,
  shouldRejectIncomingDuringWrapUp,
  shouldClearWrapUpDialogInfo,
  shouldRenderWrapUpDialog,
  shouldRenderWrapUpTimer,
} from "./wrapUpConfig";

describe("wrap-up configuration", () => {
  test("keeps the visible ACW timer enabled by default", () => {
    const remainingSeconds = parseWrapUpDurationSeconds(undefined);
    expect(remainingSeconds).toBe(DEFAULT_WRAP_UP_DURATION_SECONDS);
    expect(parseWrapUpDurationSeconds("")).toBe(45);
    expect(shouldRenderWrapUpTimer(remainingSeconds, false)).toBe(true);
  });

  test("supports explicitly disabling or bounding the timer", () => {
    expect(parseWrapUpDurationSeconds("0")).toBe(0);
    expect(parseWrapUpDurationSeconds("-10")).toBe(0);
    expect(parseWrapUpDurationSeconds("45.9")).toBe(45);
    expect(parseWrapUpDurationSeconds("900")).toBe(300);
    expect(parseWrapUpDurationSeconds("invalid")).toBe(45);
  });

  test("enables incoming-call rejection by default with an explicit opt-out", () => {
    expect(parseWrapUpRejectIncoming(undefined)).toBe(DEFAULT_WRAP_UP_REJECT_INCOMING);
    expect(parseWrapUpRejectIncoming("")).toBe(true);
    expect(parseWrapUpRejectIncoming("0")).toBe(false);
    expect(parseWrapUpRejectIncoming(" FALSE ")).toBe(false);
    expect(parseWrapUpRejectIncoming("1")).toBe(true);
    expect(parseWrapUpRejectIncoming(" TRUE ")).toBe(true);
  });

  test("rejects only incoming offers before the active wrap-up deadline", () => {
    const activeWrapUp = {
      direction: "incoming",
      enabled: true,
      wrapUpDeadlineMs: 45_000,
      nowMs: 44_999,
    };

    expect(shouldRejectIncomingDuringWrapUp(activeWrapUp)).toBe(true);
    expect(shouldRejectIncomingDuringWrapUp({ ...activeWrapUp, direction: "outgoing" })).toBe(
      false
    );
    expect(shouldRejectIncomingDuringWrapUp({ ...activeWrapUp, enabled: false })).toBe(false);
    expect(shouldRejectIncomingDuringWrapUp({ ...activeWrapUp, nowMs: 45_000 })).toBe(false);
    expect(shouldRejectIncomingDuringWrapUp({ ...activeWrapUp, nowMs: 45_001 })).toBe(false);
  });

  test("sends one 486 response without consuming offers at or after expiry", () => {
    const responses: Array<{ status_code: number; reason_phrase: string }> = [];
    const offer = {
      direction: "incoming",
      enabled: true,
      wrapUpDeadlineMs: 45_000,
      nowMs: 44_999,
      primarySessionClear: true,
      terminate: (response: { status_code: number; reason_phrase: string }) => {
        responses.push(response);
      },
    };

    expect(rejectIncomingDuringWrapUp(offer)).toBe(true);
    expect(responses).toEqual([{ status_code: 486, reason_phrase: "Busy Here" }]);

    expect(rejectIncomingDuringWrapUp({ ...offer, nowMs: 45_000 })).toBe(false);
    expect(rejectIncomingDuringWrapUp({ ...offer, primarySessionClear: false })).toBe(false);
    expect(responses).toHaveLength(1);
  });

  test("bounds the number of timer extensions", () => {
    expect(parseWrapUpMaxExtensions(undefined)).toBe(2);
    expect(parseWrapUpMaxExtensions("-1")).toBe(0);
    expect(parseWrapUpMaxExtensions("8")).toBe(5);
  });

  test("hides the timer only when it expires or another call is active", () => {
    expect(shouldRenderWrapUpTimer(0, false)).toBe(false);
    expect(shouldRenderWrapUpTimer(45, true)).toBe(false);
    expect(shouldRenderWrapUpTimer(45, false)).toBe(true);
  });

  test("keeps dialog visibility separate from the active wrap-up timer", () => {
    expect(shouldRenderWrapUpDialog(45, true)).toBe(true);
    expect(shouldRenderWrapUpDialog(45, false)).toBe(false);
    expect(shouldRenderWrapUpDialog(0, true)).toBe(false);
    expect(shouldRenderWrapUpDialog(-1, true)).toBe(false);
  });

  test("clears late dialog data whenever no wrap-up window remains", () => {
    expect(shouldClearWrapUpDialogInfo(0, true)).toBe(true);
    expect(shouldClearWrapUpDialogInfo(-1, true)).toBe(true);
    expect(shouldClearWrapUpDialogInfo(45, true)).toBe(false);
    expect(shouldClearWrapUpDialogInfo(0, false)).toBe(false);
  });
});
