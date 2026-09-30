// Curve Fit — "Bands" section (lazy chunk; CurveFitPanel mounts it only after
// a completed registry-model fit). Toggle on -> the fit's confidence band
// (and, optionally, the prediction band) at the chosen level from
// calc.fit_stats.fit_bands; "Plot with band" opens it as its own plot, where
// it is a real fill that also exports (see fitBandData.ts).

import { Button, Select } from "../../primitives";
import { Checkbox } from "../../primitives/Checkbox";
import { fmtNum as fmt } from "../../../lib/format";
import { BAND_LEVELS, levelLabel } from "./fitBandData";
import { useFitBands, type FitBandsTarget } from "./useFitBands";

export default function FitBandsSection({ target }: { target: FitBandsTarget }) {
  const b = useFitBands(target);
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Checkbox checked={b.on} onChange={b.setOn} title="Draw the confidence band around the fit">
          Bands
        </Checkbox>
        <Select
          aria-label="Band level"
          disabled={!b.on}
          options={BAND_LEVELS.map((l) => ({ value: String(l), label: levelLabel(l) }))}
          value={String(b.level)}
          onChange={(e) => b.setLevel(Number(e.target.value))}
        />
        <Checkbox checked={b.prediction} onChange={b.setPrediction} disabled={!b.on} title="Also draw the wider band for a new measurement">
          Prediction
        </Checkbox>
      </div>
      {b.on && (
        <div className="qzk-ds-meta" style={{ marginTop: 6, color: "var(--text-faint)" }}>
          {b.busy && "computing band…"}
          {b.error && <span style={{ color: "var(--danger)" }}>{b.error}</span>}
          {b.empty && "This fit has no parameter covariance, so it has no band."}
          {b.halfWidth != null && (
            <>
              <span>
                {levelLabel(b.level)} CI ± <span style={{ fontFamily: "var(--font-mono)" }}>{fmt(b.halfWidth)}</span> (median)
              </span>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
                <Button size="sm" onClick={b.plot}>
                  Plot with band
                </Button>
              </div>
              <div style={{ marginTop: 4 }}>The band opens in its own plot, which also exports it.</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
