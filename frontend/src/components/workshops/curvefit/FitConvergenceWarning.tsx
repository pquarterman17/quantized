// Shared convergence guard for every Curve Fit result surface. The parity
// fitter returns exitFlag=0 when Nelder-Mead stopped unsuccessfully; results
// remain inspectable, but must never look like a trustworthy completed fit.
// The fitter's own `warnings` (e.g. a parameter that never left its start --
// fitting audit #2) are listed under the banner, naming what went wrong.

import type { CalcResult } from "../../../lib/types";

export default function FitConvergenceWarning({ result }: { result: CalcResult | null }) {
  if (!result || result.exitFlag !== 0) return null;
  const details = Array.isArray(result.warnings)
    ? result.warnings.filter((w): w is string => typeof w === "string")
    : [];
  return (
    <div className="qzk-ds-meta qzk-msg" role="alert" style={{ marginTop: 10, color: "var(--danger)" }}>
      Fit did not converge — displayed parameters and statistics may be unreliable. Adjust the model,
      starting values, bounds, or fit range and try again.
      {details.map((w) => (
        <div key={w} style={{ marginTop: 4 }}>
          {w}
        </div>
      ))}
    </div>
  );
}
