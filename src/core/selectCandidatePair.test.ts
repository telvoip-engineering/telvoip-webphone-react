import { describe, expect, test } from "bun:test";
import { selectCandidatePairReport } from "./selectCandidatePair";

describe("selectCandidatePairReport", () => {
  test("uses the pair selected by the transport even when another succeeded pair is present", () => {
    const reports = [
      { type: "candidate-pair", id: "not-selected", state: "succeeded", priority: 999 },
      { type: "candidate-pair", id: "selected", state: "succeeded", priority: 1 },
      { type: "transport", id: "transport", selectedCandidatePairId: "selected" },
    ];

    expect(selectCandidatePairReport(reports)?.id).toBe("selected");
  });

  test("falls back to the explicit legacy selected flag", () => {
    const reports = [
      { type: "candidate-pair", id: "viable", state: "succeeded", priority: 999 },
      { type: "candidate-pair", id: "selected", selected: true, priority: 1 },
    ];

    expect(selectCandidatePairReport(reports)?.id).toBe("selected");
  });

  test("uses the highest-priority nominated and succeeded pair for older reports", () => {
    const reports = [
      { type: "candidate-pair", id: "low", nominated: true, state: "succeeded", priority: 1 },
      { type: "candidate-pair", id: "high", nominated: true, state: "succeeded", priority: 20 },
    ];

    expect(selectCandidatePairReport(reports)?.id).toBe("high");
  });

  test("does not treat an arbitrary succeeded connectivity check as selected", () => {
    const reports = [
      { type: "candidate-pair", id: "one", state: "succeeded" },
      { type: "candidate-pair", id: "two", state: "succeeded" },
    ];

    expect(selectCandidatePairReport(reports)).toBeNull();
  });
});
