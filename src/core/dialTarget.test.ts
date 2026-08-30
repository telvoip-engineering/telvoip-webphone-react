import { describe, expect, test } from "bun:test";
import { formatDialTarget } from "./dialTarget";

describe("formatDialTarget", () => {
  test("formats a Kenyan international number as compact national digits", () => {
    expect(
      formatDialTarget("+254 710 127 370", {
        format: "national",
        defaultCountry: "KE",
      })
    ).toBe("0710127370");
  });

  test("uses the per-call country for a local number", () => {
    expect(formatDialTarget({ number: "710 127 370", country: "KE" }, { format: "national" })).toBe(
      "0710127370"
    );
  });

  test("formats valid international numbers as E.164", () => {
    expect(formatDialTarget("(415) 555-2671", { format: "e164", defaultCountry: "US" })).toBe(
      "+14155552671"
    );
  });

  test("preserves PBX extensions and invalid values", () => {
    expect(formatDialTarget("1001", { format: "national", defaultCountry: "KE" })).toBe("1001");
    expect(formatDialTarget("1001")).toBe("1001");
  });
});
