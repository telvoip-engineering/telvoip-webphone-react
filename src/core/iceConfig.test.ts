import { describe, expect, test } from "bun:test";
import {
  hasStunIceServer,
  hasTurnIceServer,
  parseIceServers,
  parseIceTransportPolicy,
} from "./iceConfig";

describe("parseIceServers", () => {
  test("accepts STUN, TURN/UDP, and TURNS/TCP entries", () => {
    const servers = parseIceServers([
      { urls: "stun:media.example.test:3478" },
      {
        urls: "turn:media.example.test:3478?transport=udp",
        username: "temporary-user",
        credential: "temporary-credential",
      },
      {
        urls: "turns:media.example.test:5349?transport=tcp",
        username: "temporary-user",
        credential: "temporary-credential",
      },
    ]);

    expect(servers).toHaveLength(3);
    expect(hasTurnIceServer(servers)).toBe(true);
  });

  test("parses the JSON environment representation", () => {
    expect(parseIceServers('[{"urls":"turn:media.example.test:3478"}]')).toEqual([
      { urls: "turn:media.example.test:3478" },
    ]);
  });

  test("drops invalid URLs, unsupported fields, and non-string credentials", () => {
    expect(
      parseIceServers([
        { urls: "https://example.test/not-ice" },
        {
          urls: "turn:media.example.test:3478",
          username: 42,
          credential: { leaked: true },
          unexpected: "discarded",
        },
      ])
    ).toEqual([{ urls: "turn:media.example.test:3478" }]);
  });
});

describe("parseIceTransportPolicy", () => {
  test("accepts only supported policies", () => {
    expect(parseIceTransportPolicy(" relay ")).toBe("relay");
    expect(parseIceTransportPolicy("all")).toBe("all");
    expect(parseIceTransportPolicy("invalid")).toBeUndefined();
  });
});

describe("ICE server detection", () => {
  test("distinguishes STUN and TURN URLs across string and array forms", () => {
    const servers: RTCIceServer[] = [
      { urls: "stun:turn.telvoip.io:3478" },
      { urls: ["turn:turn.telvoip.io:3478?transport=udp"] },
    ];

    expect(hasStunIceServer(servers)).toBe(true);
    expect(hasTurnIceServer(servers)).toBe(true);
    expect(hasStunIceServer([{ urls: "turn:turn.telvoip.io:3478" }])).toBe(false);
    expect(hasTurnIceServer([{ urls: "stun:turn.telvoip.io:3478" }])).toBe(false);
  });
});
