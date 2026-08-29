const SIP_INSTANCE_STORAGE_PREFIX = "orbit.sip.instanceId.v1";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type StorageLike = Pick<Storage, "getItem" | "setItem">;

const volatileInstanceIds = new Map<string, string>();

export const normalizeSipAccountId = (uri: string): string =>
  uri
    .trim()
    .replace(/^sips?:/i, "")
    .toLowerCase();

export const buildSipInstanceStorageKey = (uri: string): string =>
  `${SIP_INSTANCE_STORAGE_PREFIX}:${encodeURIComponent(normalizeSipAccountId(uri))}`;

export const isValidSipInstanceId = (value: unknown): value is string =>
  typeof value === "string" && UUID_PATTERN.test(value.trim());

const createFallbackUuid = (): string => {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20
  )}-${hex.slice(20)}`;
};

export const createSipInstanceId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return createFallbackUuid();
};

const getBrowserStorage = (): StorageLike | null => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/**
 * Return a stable RFC 5626/GRUU instance identity for this browser and AOR.
 * The identifier contains no credential material and remains stable across
 * JsSIP UA rebuilds and WebSocket reconnections.
 */
export const getOrCreateSipInstanceId = (
  uri: string,
  storage: StorageLike | null = getBrowserStorage(),
  generate: () => string = createSipInstanceId
): string => {
  const storageKey = buildSipInstanceStorageKey(uri);
  const volatile = volatileInstanceIds.get(storageKey);

  try {
    const stored = storage?.getItem(storageKey)?.trim();
    if (isValidSipInstanceId(stored)) {
      volatileInstanceIds.set(storageKey, stored);
      return stored;
    }
  } catch {
    // Fall through to the in-memory identity when storage is blocked.
  }

  if (volatile) {
    try {
      storage?.setItem(storageKey, volatile);
    } catch {
      // The in-memory identity is still valid when storage remains blocked.
    }
    return volatile;
  }

  const generated = generate().trim();
  const instanceId = isValidSipInstanceId(generated) ? generated : createFallbackUuid();
  volatileInstanceIds.set(storageKey, instanceId);

  try {
    storage?.setItem(storageKey, instanceId);
  } catch {
    // The in-memory copy still keeps the identity stable for this page.
  }

  return instanceId;
};
