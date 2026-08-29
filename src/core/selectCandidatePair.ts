export interface CandidatePairSelectionReport {
  type?: string;
  id?: string;
  selectedCandidatePairId?: string;
  selected?: boolean;
  nominated?: boolean;
  state?: string;
  priority?: number;
}

const highestPriority = <T extends CandidatePairSelectionReport>(reports: T[]): T | null =>
  reports.reduce<T | null>((best, report) => {
    if (!best) return report;
    return (report.priority ?? Number.NEGATIVE_INFINITY) >
      (best.priority ?? Number.NEGATIVE_INFINITY)
      ? report
      : best;
  }, null);

/**
 * Select the ICE candidate pair that WebRTC says is carrying media.
 *
 * A candidate pair in the `succeeded` state is only a viable connectivity
 * check; it is not necessarily the pair selected by the ICE transport. Older
 * browser reports may omit transport.selectedCandidatePairId, so the explicit
 * legacy `selected` flag and a nominated/succeeded pair are safe fallbacks.
 */
export const selectCandidatePairReport = <T extends CandidatePairSelectionReport>(
  reports: readonly T[]
): T | null => {
  const candidatePairs = reports.filter((report) => report.type === "candidate-pair");
  const selectedPairId = reports.find(
    (report) => report.type === "transport" && Boolean(report.selectedCandidatePairId)
  )?.selectedCandidatePairId;

  if (selectedPairId) {
    const transportSelectedPair = candidatePairs.find((report) => report.id === selectedPairId);
    if (transportSelectedPair) return transportSelectedPair;
  }

  const explicitlySelected = highestPriority(
    candidatePairs.filter((report) => report.selected === true)
  );
  if (explicitlySelected) return explicitlySelected;

  return highestPriority(
    candidatePairs.filter((report) => report.nominated === true && report.state === "succeeded")
  );
};
