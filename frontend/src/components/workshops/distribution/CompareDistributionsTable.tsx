// Distribution workshop — "Compare distributions" table (JMP_GAP J12 items
// 1-2). Presentational only: state/ranking live in useDistribution. Renders
// every fitted family ranked by AICc (or, honestly labeled, by KS p when
// AICc can't be computed), highlights the winner, and lets the user click a
// row to change which family overlays the histogram (default: the winner).

import type { DistFamily } from "../../../lib/distpdf";
import { fmtNum } from "../../../lib/format";
import { DataTable } from "../../primitives/DataTable";
import { Badge } from "../../primitives";
import type { FitPick, RankedFit, RankingMetric } from "./useDistribution";

// Friendly parameter keys per family (mirrors calc/stats_dist.py's aliases).
const PARAM_KEYS: Record<string, string[]> = {
  normal: ["mu", "sigma"],
  lognormal: ["mu", "sigma"],
  weibull: ["shape", "scale"],
  gamma: ["shape", "scale"],
  exponential: ["rate"],
};

function paramLabel(dist: string, params: Record<string, number>): string {
  const keys = PARAM_KEYS[dist] ?? Object.keys(params);
  return keys.map((k) => `${k}=${fmtNum(params[k])}`).join(", ");
}

export default function CompareDistributionsTable({
  rankedFits,
  rankingMetric,
  winnerDist,
  selected,
  onSelect,
  skipped,
}: {
  rankedFits: RankedFit[];
  rankingMetric: RankingMetric;
  winnerDist: DistFamily | null;
  selected: FitPick;
  onSelect: (d: DistFamily) => void;
  skipped: { dist: string; reason: string }[];
}) {
  if (rankedFits.length === 0) return null;

  const rows = rankedFits.map((f) => {
    const isWinner = f.dist === winnerDist;
    const isSelected = f.dist === selected;
    return [
      <span key="dist" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <button
          type="button"
          onClick={() => onSelect(f.dist as DistFamily)}
          style={{
            all: "unset",
            cursor: "pointer",
            fontWeight: isSelected ? 700 : 400,
            color: isSelected ? "var(--accent)" : "inherit",
          }}
          aria-pressed={isSelected}
        >
          {f.dist}
        </button>
        {isWinner && <Badge tone="ok">winner</Badge>}
      </span>,
      paramLabel(f.dist, f.params),
      fmtNum(f.ks_d),
      fmtNum(f.ks_p),
      f.aicc == null ? "—" : fmtNum(f.aicc),
    ];
  });

  return (
    <div style={{ marginTop: 8 }}>
      <div className="qzk-ds-meta" style={{ color: "var(--text-faint)", marginBottom: 4 }}>
        {rankingMetric === "aicc"
          ? "Ranked by AICc (lower is better) — click a row to overlay it."
          : "AICc unavailable for this sample — ranked by KS p (higher is better) instead. Click a row to overlay it."}
      </div>
      <div style={{ overflowX: "auto" }}>
        <DataTable columns={["distribution", "params", "KS D", "KS p", "AICc"]} rows={rows} />
      </div>
      {skipped.length > 0 && (
        <div className="qzk-ds-meta" style={{ color: "var(--text-faint)", marginTop: 4 }}>
          skipped: {skipped.map((s) => `${s.dist} (${s.reason})`).join("; ")}
        </div>
      )}
    </div>
  );
}
