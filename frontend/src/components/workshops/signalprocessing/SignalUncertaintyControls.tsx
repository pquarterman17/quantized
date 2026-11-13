// Signal Processing — what happens to a BOUND Y uncertainty (worksheet audit
// #9). QD imports bind the moment's error column automatically, so this is
// the common case for magnetometry. Smoothing, the derivatives and the
// cumulative integral are linear and propagate it (independent points
// assumed — the backend's calc/linear_uncertainty.py documents the method).
// What comes out is the DIAGONAL of the output covariance only, and the note
// says so: the output is marked, and a second such step on it is refused
// (signalProcessingModel.correlatedBoundErrors);
// detrend and the logarithmic derivative cannot, and need the explicit
// "drop uncertainty for this output" choice offered here.

import { Checkbox } from "../../primitives/Checkbox";
import { propagatesBoundErrors, type CorrectionOperation } from "./signalProcessingModel";

export default function SignalUncertaintyControls({
  operation,
  boundLabels,
  blocked,
  drop,
  setDrop,
}: {
  operation: CorrectionOperation;
  boundLabels: string[];
  /** The operation cannot propagate this uncertainty (the panel's alert says
   *  why): only the drop choice applies. */
  blocked: boolean;
  drop: boolean;
  setDrop: (drop: boolean) => void;
}) {
  if (!boundLabels.length) return null;
  const propagates = propagatesBoundErrors(operation);
  return (
    <div role="group" aria-label="Bound uncertainty" style={{ display: "grid", gap: 4, minWidth: 0 }}>
      <Checkbox checked={drop} onChange={setDrop}>
        Drop uncertainty for this output
      </Checkbox>
      <div className="qz-signal-note">
        {drop
          ? `The output's error column for ${boundLabels.join(", ")} is left blank; the source keeps its uncertainty.`
          : blocked || !propagates
            ? `The bound uncertainty of ${boundLabels.join(", ")} cannot be propagated through this operation. Drop it for this output to continue.`
            : operation.startsWith("normalize")
              ? `The bound uncertainty of ${boundLabels.join(", ")} is scaled with the signal.`
              : `The bound uncertainty of ${boundLabels.join(", ")} is propagated through this linear operation (squared weights; input points assumed independent). The result is the diagonal only: neighbouring output points are correlated, so a further smoothing, derivative or integral of this output cannot reuse it.`}
      </div>
    </div>
  );
}
