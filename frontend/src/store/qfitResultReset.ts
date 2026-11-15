// The quick-fit gadget's RESULT and the two companions that travel with it: the
// model that produced it and the curve (Y, X) it was fitted on. Every reset
// that drops `qfitResult` must drop all three -- a stale `qfitResultCurve` on a
// fresh dataset would bind the next result's overlay to the old dataset's
// channels. One object, spread at every site (the gadget's own drop, its
// initial state, `analysisResultReset`, a dataset clone), so a field added here
// cannot be missed at one of them.
export const QFIT_RESULT_RESET = {
  qfitResult: null,
  qfitResultModel: null,
  qfitResultCurve: null,
} as const;
