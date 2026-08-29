import { afterEach, describe, expect, test } from "bun:test";
import { normalizeCredentials } from "./SipContext.shared";

const validCreds = {
  sipUsername: "1001",
  sipPassword: "secret",
  sipWsUrl: "wss://sip.example.com:7443",
};

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
});

describe("normalizeCredentials", () => {
  test("returns null when sipUsername is missing", () => {
    expect(normalizeCredentials({ ...validCreds, sipUsername: undefined })).toBeNull();
  });

  test("returns null when sipPassword is missing", () => {
    expect(normalizeCredentials({ ...validCreds, sipPassword: undefined })).toBeNull();
  });

  test("returns null when sipWsUrl is missing", () => {
    expect(normalizeCredentials({ ...validCreds, sipWsUrl: undefined })).toBeNull();
  });

  test("returns null for an empty credentials object", () => {
    expect(normalizeCredentials({})).toBeNull();
    expect(normalizeCredentials()).toBeNull();
  });

  test("accepts a wss:// URL regardless of environment", () => {
    process.env.NODE_ENV = "production";
    const result = normalizeCredentials(validCreds);
    expect(result).not.toBeNull();
    expect(result?.wsUri).toBe(validCreds.sipWsUrl);
  });

  test("accepts ws:// to localhost outside production", () => {
    process.env.NODE_ENV = "development";
    const result = normalizeCredentials({ ...validCreds, sipWsUrl: "ws://localhost:8088" });
    expect(result).not.toBeNull();
  });

  test("accepts ws:// to 127.0.0.1 outside production", () => {
    process.env.NODE_ENV = "test";
    const result = normalizeCredentials({ ...validCreds, sipWsUrl: "ws://127.0.0.1:8088" });
    expect(result).not.toBeNull();
  });

  test("rejects ws:// to localhost in production", () => {
    process.env.NODE_ENV = "production";
    const result = normalizeCredentials({ ...validCreds, sipWsUrl: "ws://localhost:8088" });
    expect(result).toBeNull();
  });

  test("rejects ws:// to a non-localhost host even outside production", () => {
    process.env.NODE_ENV = "development";
    const result = normalizeCredentials({ ...validCreds, sipWsUrl: "ws://sip.example.com" });
    expect(result).toBeNull();
  });

  test("rejects a malformed WS URL", () => {
    const result = normalizeCredentials({ ...validCreds, sipWsUrl: "not a url" });
    expect(result).toBeNull();
  });

  test("rejects an http:// URL", () => {
    const result = normalizeCredentials({ ...validCreds, sipWsUrl: "http://sip.example.com" });
    expect(result).toBeNull();
  });

  test("a username with an embedded domain is used as-is, even over an explicit sipDomain", () => {
    // buildSipUri() short-circuits on "username already contains @" before
    // ever consulting the derived domain - sipDomain is silently ignored in
    // this case, matching the source implementation's precedence exactly.
    const result = normalizeCredentials({
      ...validCreds,
      sipDomain: "explicit.example.com",
      sipUsername: "1001@embedded.example.com",
    });
    expect(result?.uri).toBe("sip:1001@embedded.example.com");
  });

  test("explicit sipDomain wins over a WS-URL-derived domain when username has no @", () => {
    const result = normalizeCredentials({
      ...validCreds,
      sipUsername: "1001",
      sipDomain: "explicit.example.com",
      sipWsUrl: "wss://pbx.example.com:7443",
    });
    expect(result?.uri).toBe("sip:1001@explicit.example.com");
  });

  test("derives domain from sipUsername containing @ when sipDomain is absent", () => {
    const result = normalizeCredentials({
      ...validCreds,
      sipUsername: "1001@tenant.example.com",
    });
    expect(result?.uri).toBe("sip:1001@tenant.example.com");
    expect(result?.registrarServer).toBe("sip:tenant.example.com");
  });

  test("falls back to deriving domain from the WS URL hostname", () => {
    const result = normalizeCredentials({
      ...validCreds,
      sipUsername: "1001",
      sipWsUrl: "wss://pbx.example.com:7443",
    });
    expect(result?.uri).toBe("sip:1001@pbx.example.com");
  });

  test("an out-of-range dotted-quad host fails URL parsing and is rejected", () => {
    // "256" exceeds a valid IPv4 octet, so the WHATWG URL parser throws -
    // caught by isAllowedSipWebSocketUrl's own try/catch, same as any other
    // malformed URL.
    const result = normalizeCredentials({
      ...validCreds,
      sipWsUrl: "wss://256.256.256.256",
    });
    expect(result).toBeNull();
  });

  test("defaults authorizationUser to the URI's user part when sipAuthUser is absent", () => {
    const result = normalizeCredentials(validCreds);
    expect(result?.authorizationUser).toBe("1001");
  });

  test("uses an explicit sipAuthUser over the derived default", () => {
    const result = normalizeCredentials({ ...validCreds, sipAuthUser: "custom-auth-user" });
    expect(result?.authorizationUser).toBe("custom-auth-user");
  });

  test("uses an explicit sipRegistrar over the derived default", () => {
    const result = normalizeCredentials({ ...validCreds, sipRegistrar: "sip:custom-registrar" });
    expect(result?.registrarServer).toBe("sip:custom-registrar");
  });

  test("passes through sipIceServers and sipIceTransportPolicy unchanged", () => {
    const iceServers = [{ urls: ["stun:stun.example.com:3478"] }];
    const result = normalizeCredentials({
      ...validCreds,
      sipIceServers: iceServers,
      sipIceTransportPolicy: "relay",
    });
    expect(result?.iceServers).toBe(iceServers);
    expect(result?.iceTransportPolicy).toBe("relay");
  });
});
