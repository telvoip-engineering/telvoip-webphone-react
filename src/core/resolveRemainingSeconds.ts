/**
 * Shared utility: parse a socket balance-update payload into a seconds value.
 * Lives here so it can be imported by both NotificationContext and tests.
 */

export const toFiniteNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
};

/**
 * Resolve the remaining-seconds figure from a socket balance-update payload.
 *
 * Priority:
 *  1. `balance_minutes` — the ledger shape (DID outbound wallet).
 *  2. Direct seconds fields: `seconds_remaining`, `remaining_seconds`, etc.
 *
 * Returns null when the payload carries no usable balance data.
 */
export const resolveRemainingSeconds = (payload: Record<string, unknown>): number | null => {
  const balanceMinutes = toFiniteNumber(payload.balance_minutes);
  if (balanceMinutes !== null) return Math.max(0, Math.floor(balanceMinutes * 60));

  const directCandidates = [
    payload.seconds_remaining,
    payload.remaining_seconds,
    payload.remaining,
    payload.available_seconds,
    payload.balance,
  ];
  for (const candidate of directCandidates) {
    const value = toFiniteNumber(candidate);
    if (value !== null) return Math.max(0, Math.floor(value));
  }

  return null;
};
