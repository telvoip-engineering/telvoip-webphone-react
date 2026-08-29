import { describe, expect, test } from "bun:test";

import { minimizeSdpCandidates } from "./minimizeSdpCandidates";

const HEADER = [
  "v=0",
  "o=- 4611730575899604121 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "a=group:BUNDLE 0",
  "a=msid-semantic: WMS",
].join("\n");

const AUDIO_MLINE = [
  "m=audio 9 UDP/TLS/RTP/SAVPF 111 8 0 101",
  "c=IN IP4 0.0.0.0",
  "a=rtcp:9 IN IP4 0.0.0.0",
  "a=ice-ufrag:E7j8Dv7q7jfHXK9D",
  "a=ice-pwd:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "a=mid:0",
  "a=rtcp-mux",
  "a=rtcp-fb:111 transport-cc",
  "a=sendrecv",
].join("\n");

// Captured-style candidates: wifi host, four Docker/VPN hosts, a TCP host,
// an IPv6 host, three srflx candidates all on the same public IP, one relay.
const CANDIDATES = [
  "a=candidate:1 1 UDP 2122252543 192.168.100.16 50329 typ host",
  "a=candidate:1 2 UDP 2122252542 192.168.100.16 50330 typ host",
  "a=candidate:2 1 UDP 2122194687 172.20.0.1 50331 typ host",
  "a=candidate:2 2 UDP 2122194686 172.20.0.1 50332 typ host",
  "a=candidate:3 1 UDP 2122120831 172.19.0.1 50333 typ host",
  "a=candidate:4 1 UDP 2122046975 172.17.0.1 50334 typ host",
  "a=candidate:5 1 UDP 2121973119 172.28.0.1 50335 typ host",
  "a=candidate:6 1 TCP 1518284799 192.168.100.16 9 typ host tcptype active",
  "a=candidate:7 1 UDP 1686054911 102.204.4.14 54321 typ srflx raddr 192.168.100.16 rport 50329",
  "a=candidate:7 2 UDP 1686054910 102.204.4.14 54322 typ srflx raddr 192.168.100.16 rport 50330",
  "a=candidate:8 1 UDP 1685981055 102.204.4.14 54444 typ srflx raddr 172.20.0.1 rport 50331",
  "a=candidate:9 1 UDP 1694498815 [fe80::1] 50336 typ host",
  "a=candidate:10 1 UDP 41820159 3.3.3.3 49999 typ relay raddr 102.204.4.14 rport 54321",
].join("\n");

const buildSdp = (body: string[]): string => `${HEADER}\n${AUDIO_MLINE}\n${body.join("\n")}`;

const candidateLines = (sdp: string): string[] =>
  sdp.split("\n").filter((line) => line.startsWith("a=candidate:"));

describe("minimizeSdpCandidates", () => {
  test("drops Docker/VPN host, TCP host and IPv6 host candidates", () => {
    const result = minimizeSdpCandidates(buildSdp([CANDIDATES]));
    const kept = candidateLines(result).join("\n");
    expect(kept).not.toContain("172.20.0.1");
    expect(kept).not.toContain("172.19.0.1");
    expect(kept).not.toContain("172.17.0.1");
    expect(kept).not.toContain("172.28.0.1");
    expect(kept).not.toContain("typ host tcptype");
    expect(kept).not.toContain("[fe80::1]");
  });

  test("keeps the LAN host and relay candidates", () => {
    const result = minimizeSdpCandidates(buildSdp([CANDIDATES]));
    const kept = candidateLines(result).join("\n");
    expect(kept).toContain("192.168.100.16 50329 typ host");
    expect(kept).toContain("192.168.100.16 50330 typ host");
    expect(kept).toContain("typ relay");
  });

  test("dedupes srflx candidates to one per public address and component", () => {
    const result = minimizeSdpCandidates(buildSdp([CANDIDATES]));
    const srflx = candidateLines(result).filter((line) => line.includes("typ srflx"));
    expect(srflx).toHaveLength(2);
    expect(srflx.every((line) => line.includes("102.204.4.14"))).toBe(true);
  });

  test("prunes the captured 5-interface SDP down to a handful of candidates", () => {
    const result = minimizeSdpCandidates(buildSdp([CANDIDATES]));
    const kept = candidateLines(result);
    expect(kept).toHaveLength(5);
  });

  test("leaves non-candidate lines byte-identical", () => {
    const input = buildSdp([CANDIDATES]);
    const result = minimizeSdpCandidates(input);
    const expected = [HEADER, AUDIO_MLINE].join("\n").split("\n");
    const actual = result.split("\n");
    for (const line of expected) {
      if (!line.startsWith("a=candidate:")) {
        expect(actual).toContain(line);
      }
    }
    expect(actual).toHaveLength(expected.length + 5);
  });

  test("returns SDP unchanged when there are no candidate lines", () => {
    const input = buildSdp([]);
    expect(minimizeSdpCandidates(input)).toBe(input);
  });

  test("restores a section when pruning would leave fewer than two candidates", () => {
    const sparse = [
      "a=candidate:7 1 UDP 1686054911 102.204.4.14 54321 typ srflx raddr 192.168.100.16 rport 50329",
    ].join("\n");
    const input = buildSdp([sparse]);
    expect(minimizeSdpCandidates(input)).toBe(input);
  });

  test("returns SDP unchanged when the whole SDP would end up below two candidates", () => {
    const sparse = buildSdp(["a=candidate:1 1 UDP 2122252543 192.168.100.16 50329 typ host"]);
    expect(minimizeSdpCandidates(sparse)).toBe(sparse);
  });

  test("tolerates CRLF line endings", () => {
    const input = buildSdp([CANDIDATES]).replace(/\n/g, "\r\n");
    const result = minimizeSdpCandidates(input);
    expect(candidateLines(result.replace(/\r\n/g, "\n"))).toHaveLength(5);
    expect(result).toContain("\r\n");
    expect(result.replace(/\r\n/g, "")).not.toContain("\n");
  });
});
