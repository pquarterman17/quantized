// Shared convergence guard for every Curve Fit result surface. The parity
// fitter returns exitFlag=0 when Nelder-Mead stopped unsuccessfully; results
// remain inspectable, but must never look like a trustworthy completed fit.

import type { CalcResult } from "../../../lib/types";

export default function FitConvergenceWarning({ result }: { result: CalcResult | null }) {
  if (!result || result.exitFlag !== 0) return null;
  return (
    <div className="qzk-ds-meta" role="alert" style={{ marginTop: 10, color: "var(--danger)" }}>
      Fit did not converge — displayed parameters and statistics may be unreliable. Adjust the model,
      starting values, bounds, or fit range and try again.
    </div>
  );
}
