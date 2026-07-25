// "This fit was recomputed" marker (MAIN_PLAN #30).
//
// A recomputed fit is not the fit the user ran: the recalc graph re-derived it
// over data that changed underneath. That is the difference between a number
// you can cite and one you should re-check, so it earns a mark of its own
// rather than being folded into the generic stale dot — which means the
// opposite ("not yet recomputed").
//
// Its own file because DatasetRow sits at the component ceiling; this is the
// workshop pattern in miniature, and the row reads better without it inline.

import type { FitSpec } from "../../lib/types";

/** Shown only when the fit is settled: while a dataset is stale the pending
 *  recompute is the more urgent fact, and two markers arguing helps nobody. */
export default function RecomputedMark({
  spec,
  stale,
}: {
  spec: FitSpec | undefined;
  stale: boolean;
}) {
  if (!spec?.recomputedAt || stale) return null;
  const when = new Date(spec.recomputedAt).toLocaleString();
  const orig = spec.fittedAt ? ` — originally fit ${new Date(spec.fittedAt).toLocaleString()}` : "";
  return (
    <span
      className="qzk-ds-meta"
      style={{ color: "var(--text-faint)" }}
      title={`Fit recomputed ${when}${orig}`}
    >
      ↻
    </span>
  );
}
