import { describe, expect, test } from "bun:test";
import {
  buildSipInstanceStorageKey,
  getOrCreateSipInstanceId,
  isValidSipInstanceId,
  normalizeSipAccountId,
} from "./sipInstanceId";

const UUID_A = "8f1fa16a-1165-4a96-8341-785b1ef24f12";
const UUID_B = "6d3cf0ac-8614-4a4a-a7bb-b60b5479cbb1";

const createStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    values,
  };
};

describe("SIP instance identity", () => {
  test("normalizes an AOR without storing credentials", () => {
    expect(normalizeSipAccountId(" SIP:Agent@Example.COM ")).toBe("agent@example.com");
    expect(buildSipInstanceStorageKey("sip:agent@example.com")).toBe(
      "orbit.sip.instanceId.v1:agent%40example.com"
    );
  });

  test("reuses the same valid identifier for the same account", () => {
    const storage = createStorage();
    const first = getOrCreateSipInstanceId("sip:agent@example.com", storage, () => UUID_A);
    const second = getOrCreateSipInstanceId("SIP:AGENT@EXAMPLE.COM", storage, () => UUID_B);

    expect(first).toBe(UUID_A);
    expect(second).toBe(UUID_A);
    expect(storage.values.size).toBe(1);
  });

  test("uses distinct identifiers for distinct accounts", () => {
    const storage = createStorage();

    expect(getOrCreateSipInstanceId("sip:1001@example.com", storage, () => UUID_A)).toBe(UUID_A);
    expect(getOrCreateSipInstanceId("sip:1002@example.com", storage, () => UUID_B)).toBe(UUID_B);
    expect(storage.values.size).toBe(2);
  });

  test("replaces an invalid stored value", () => {
    const storage = createStorage();
    storage.setItem(buildSipInstanceStorageKey("sip:invalid@example.com"), "not-a-uuid");

    expect(getOrCreateSipInstanceId("sip:invalid@example.com", storage, () => UUID_A)).toBe(UUID_A);
    expect(storage.values.get(buildSipInstanceStorageKey("sip:invalid@example.com"))).toBe(UUID_A);
    expect(isValidSipInstanceId(UUID_A)).toBe(true);
    expect(isValidSipInstanceId("not-a-uuid")).toBe(false);
  });

  test("keeps an in-memory identity when storage is blocked", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };

    const first = getOrCreateSipInstanceId("sip:blocked@example.com", blocked, () => UUID_A);
    const second = getOrCreateSipInstanceId("sip:blocked@example.com", blocked, () => UUID_B);

    expect(first).toBe(UUID_A);
    expect(second).toBe(UUID_A);
  });
});
