// The Quick Figure Builder's side of the error-binding CONFIDENCE GRADE
// (lib/errorBindingConfidence.ts). `initialQuickFigureMapping` withholds an
// adjacency-only (`low`) pairing -- its column starts as Ignore -- and this
// panel asks: one sentence of why, and a button that applies it through the
// ordinary role assignment. A unit-`blocked` pairing is explained, never
// offered (the user can still assign any role explicitly in the column list).

import { useMemo } from "react";

import { reviewSeedErrorBindings } from "../../../lib/errorBindingConfidence";
import { assignmentFor, type QuickColumnAssignment } from "../../../lib/quickFigureMappingActions";
import type { QuickFigureMapping } from "../../../lib/quickFigureMapping";
import { describePairing } from "../../../lib/quickPlotErrorReview";
import type { Dataset } from "../../../lib/types";

export default function QuickErrorSuggestions({
  dataset,
  mapping,
  onAssign,
}: {
  dataset: Dataset;
  mapping: QuickFigureMapping;
  onAssign: (channel: number, assignment: QuickColumnAssignment) => void;
}) {
  const review = useMemo(() => reviewSeedErrorBindings(dataset), [dataset]);
  // Still pending: the column is exactly where the withholding left it.
  const pending = review.confirm.filter((b) => assignmentFor(mapping, b.channel).role === "ignore");
  if (pending.length === 0 && review.blocked.length === 0) return null;
  return (
    <div id="quick-builder-pairing-review" className="qzk-quick-builder-notice" role="status" aria-label="Suggested error pairings">
      {pending.map((b) => (
        <p key={`ask-${b.channel}`}>
          {describePairing(dataset.data, b)} is paired by column position alone, so it is not applied until you confirm it.{" "}
          <button
            type="button"
            className="qz-btn"
            onClick={() => onAssign(b.channel, { role: "error", target: b.target, axis: b.axis, side: b.side })}
          >
            Use as error bars
          </button>
        </p>
      ))}
      {review.blocked.map((b) => (
        <p key={`blocked-${b.channel}`}>
          {describePairing(dataset.data, b)} was not paired because their units contradict.
        </p>
      ))}
    </div>
  );
}
