const ICE_TRANSPORT_POLICIES = new Set<RTCIceTransportPolicy>(["all", "relay"]);

const parseIceServerUrls = (value: unknown): string | string[] | undefined => {
  const rawUrls = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
  const urls = rawUrls.flatMap((url) => {
    if (typeof url !== "string") return [];
    const normalized = url.trim();
    return /^(stun|turn|turns):/i.test(normalized) ? [normalized] : [];
  });

  if (!urls.length) return undefined;
  return typeof value === "string" ? urls[0] : urls;
};

export const parseIceServers = (value: unknown): RTCIceServer[] | undefined => {
  if (typeof value === "string" && !value.trim()) return undefined;

  try {
    const parsed = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
    if (!Array.isArray(parsed)) return undefined;

    const servers = parsed.flatMap((server): RTCIceServer[] => {
      if (!server || typeof server !== "object" || Array.isArray(server)) return [];

      const candidate = server as Record<string, unknown>;
      const urls = parseIceServerUrls(candidate.urls);
      if (!urls) return [];

      const username =
        typeof candidate.username === "string" && candidate.username.trim()
          ? candidate.username
          : undefined;
      const credential =
        typeof candidate.credential === "string" && candidate.credential
          ? candidate.credential
          : undefined;

      return [
        {
          urls,
          ...(username ? { username } : {}),
          ...(credential ? { credential } : {}),
        },
      ];
    });

    return servers.length > 0 ? servers : undefined;
  } catch {
    return undefined;
  }
};

export const parseIceTransportPolicy = (value: unknown): RTCIceTransportPolicy | undefined => {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : undefined;
  return normalized && ICE_TRANSPORT_POLICIES.has(normalized as RTCIceTransportPolicy)
    ? (normalized as RTCIceTransportPolicy)
    : undefined;
};

export const hasTurnIceServer = (servers: readonly RTCIceServer[] | undefined): boolean =>
  Boolean(
    servers?.some((server) => {
      const urls = typeof server.urls === "string" ? [server.urls] : server.urls;
      return urls?.some((url) => /^turns?:/i.test(url));
    })
  );

export const hasStunIceServer = (servers: readonly RTCIceServer[] | undefined): boolean =>
  Boolean(
    servers?.some((server) => {
      const urls = typeof server.urls === "string" ? [server.urls] : server.urls;
      return urls?.some((url) => /^stuns?:/i.test(url));
    })
  );
