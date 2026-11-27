// The correlation methods the Multivariate workshop offers: the single source
// for the Correlation tab's toggle and for the preset adapter's validation.

export const CORR_METHODS = ["pearson", "spearman"] as const;
export type CorrMethod = (typeof CORR_METHODS)[number];

export const CORR_METHOD_LABELS: Record<CorrMethod, string> = { pearson: "Pearson", spearman: "Spearman" };
