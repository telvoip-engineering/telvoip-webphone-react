// Strips useless ICE candidates from a local SDP before it is handed to the
// remote peer. Most endpoints carry several network interfaces (wifi + Docker
// bridges + VPN tunnels), so the browser emits one host candidate per
// interface plus a server-reflexive candidate per interface — all sharing the
// same public IP. The PBX cannot reach Docker/VPN addresses and does not need
// five srflx candidates for the same public address, so every extra candidate
// only inflates the SDP and lengthens ICE connectivity checks after the call
// is answered. The remote side just needs one reachable pair per component.
//
// Safety: a section is left untouched unless pruning keeps at least two
// candidates in it, and the whole SDP is returned unchanged when pruning
// would leave fewer than two candidates overall.

const CANDIDATE_LINE = /^a=candidate:(.+)$/;

interface ParsedCandidate {
  component: number;
  transport: string;
  type: string;
  address: string;
}

const MIN_CANDIDATES_PER_SECTION = 2;
const MIN_TOTAL_CANDIDATES = 2;

const parseCandidate = (line: string): ParsedCandidate | null => {
  const match = CANDIDATE_LINE.exec(line);
  if (!match) return null;
  const tokens = match[1].trim().split(/\s+/);
  if (tokens.length < 7) return null;
  const component = Number(tokens[1]);
  if (!Number.isFinite(component)) return null;
  return {
    component,
    transport: (tokens[2] || "").toUpperCase(),
    type: (tokens[7] || "").toLowerCase(),
    address: tokens[4] || "",
  };
};

// Docker default bridge/overlay ranges and common VPN pools: 172.16.0.0/12.
const isDockerish172 = (ip: string): boolean => {
  const parts = ip.split(".");
  if (parts.length !== 4 || parts[0] !== "172") return false;
  const second = Number(parts[1]);
  return Number.isInteger(second) && second >= 16 && second <= 31;
};

export const minimizeSdpCandidates = (sdp: string): string => {
  const lineTerminator = sdp.includes("\r\n") ? "\r\n" : "\n";
  const lines = sdp.split(/\r?\n/);

  let candidateCount = 0;
  const groups: Array<{ kept: number; originals: number[] }> = [];
  let groupIndex = 0;
  const lineGroup = new Map<number, number>();
  const verdicts = new Map<number, "keep" | "drop">();
  const dedupeSeen = new Set<string>();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith("m=")) {
      groupIndex = groups.length;
      groups.push({ kept: 0, originals: [] });
    }
    const parsed = parseCandidate(line);
    if (!parsed) continue;
    candidateCount += 1;
    if (groups.length === 0) {
      // Candidates before any media line are rare but legal at session level.
      groups.push({ kept: 0, originals: [] });
    }
    const group = groups[groupIndex];
    lineGroup.set(index, groupIndex);
    group.originals.push(index);

    let verdict: "keep" | "drop" = "drop";
    if (parsed.type === "srflx") {
      const key = `${groupIndex}:${parsed.component}:${parsed.address}`;
      if (!dedupeSeen.has(key)) {
        dedupeSeen.add(key);
        verdict = "keep";
        group.kept += 1;
      }
    } else if (parsed.type === "host") {
      const shouldKeep =
        parsed.transport === "UDP" &&
        !parsed.address.includes(":") &&
        !parsed.address.startsWith("127.") &&
        !isDockerish172(parsed.address);
      if (shouldKeep) {
        verdict = "keep";
        group.kept += 1;
      }
    } else {
      // relay, prflx and unknown types: never prune.
      verdict = "keep";
      group.kept += 1;
    }
    verdicts.set(index, verdict);
  }

  if (candidateCount === 0) return sdp;

  const totalKept = groups.reduce((sum, group) => sum + group.kept, 0);
  if (totalKept < MIN_TOTAL_CANDIDATES) return sdp;

  const restoreGroup = new Set<number>();
  groups.forEach((group, index) => {
    if (group.kept < MIN_CANDIDATES_PER_SECTION) restoreGroup.add(index);
  });

  const output: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const verdict = verdicts.get(index);
    if (verdict === undefined) {
      output.push(lines[index]);
      continue;
    }
    const group = lineGroup.get(index);
    if (group !== undefined && restoreGroup.has(group)) {
      output.push(lines[index]);
      continue;
    }
    if (verdict === "keep") {
      output.push(lines[index]);
    }
  }

  return output.join(lineTerminator);
};
