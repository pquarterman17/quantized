// DREAM convergence diagnostics (audit P1 #2). Surfaces the Gelman-Rubin R-hat
// so a posterior is never presented as trustworthy when the chains haven't
// mixed. Renders nothing for non-DREAM results or legacy payloads that predate
// the diagnostics (rHatMax absent).

import { fmtNum as fmt } from "../../../lib/format";
import type { BumpsPosterior } from "../../../lib/fitbumps";
import { DataTable } from "../../primitives";

export default function DreamConvergence({ posterior }: { posterior?: BumpsPosterior }) {
  if (!posterior || posterior.rHatMax == null) return null;
  const { rHatMax, converged, nChains, n_draws } = posterior;
  return (
    <div style={{ marginTop: 10 }}>
      {converged === false && (
        <div
          className="qzk-ds-meta"
          role="alert"
          style={{ color: "var(--danger)", marginBottom: 6 }}
        >
          DREAM did not converge (R-hat {fmt(rHatMax)} ≥ 1.1) — the posterior
          medians and intervals may be unreliable. Increase the sample/burn
          budget, widen the parameter bounds, or reconsider the model.
        </div>
      )}
      <DataTable
        columns={["convergence", "value"]}
        rows={[
          ["R-hat (max)", fmt(rHatMax)],
          ["converged", converged ? "yes" : "no"],
          ["chains", nChains == null ? "—" : String(nChains)],
          ["draws", String(n_draws)],
        ]}
      />
    </div>
  );
}
