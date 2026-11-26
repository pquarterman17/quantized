// The inline commit bar both the box and the cut ruler share (RSM_CUTS_PLAN
// items 6 + 7), split out of MapRoiOverlay.tsx: a client-only preview
// sparkline, a live N / integrated-intensity readout, and the ∫ / Stats
// buttons that turn one drag and one click into a library dataset.

import { Button } from "../primitives";
import type { RoiBoxStats, RoiProfile } from "../../lib/roiMath";
import type { BoxStats } from "../../lib/api/rsm";
import { fmt } from "./mapRender";
import { integrateTitle, previewTitle, type CollapseAxes } from "./roiAxisNames";
import { sparklinePoints, SPARK_H, SPARK_W } from "./roiBarLayout";

export interface CommitBarProps {
  preview: RoiProfile | null;
  previewAxis: "x" | "y";
  onPreviewAxisChange: (axis: "x" | "y") => void;
  previewStats: RoiBoxStats | null;
  onIntegrate: (axis: "x" | "y") => void;
  landingBusy: boolean;
  onStats: () => void;
  statsBusy: boolean;
  apiStats: BoxStats | null;
  statsError: string | null;
  onClearStats: () => void;
  /** Remove this ROI outright. Until this button existed, Delete/Backspace on
   *  a FOCUSED map was the only way — and the map is only focusable once a
   *  shape exists, so if focus sat anywhere else (a Library row, say) the
   *  keystroke fell through to the global shortcut and removed the DATASET
   *  instead. Reported from a real session. The keystroke still works; this
   *  is the discoverable path that does not depend on where focus happens to
   *  be. Sits in the header row, deliberately away from the ∫/Stats buttons,
   *  so it is not mis-hit while committing. */
  onRemove: () => void;
  removeLabel: string;
  /** What this shape's two collapse axes are actually called — the map's own
   *  axes for the box, the ruler's own frame for the ruler. See
   *  `roiAxisNames.ts` for why those are not the same thing. */
  axes: CollapseAxes;
  /** false: no ∫ / Stats buttons. A box drawn on a plain (non-RSM) map has no
   *  backend cut to commit (those routes read an angular or Q pair), so the bar
   *  shows its local preview only, never a button that would act on other axes. */
  actions?: boolean;
}

/** Shared inline-bar body for both the box and the ruler — same preview/N/
 *  ∫I/∫/Stats vocabulary, only the positioning (caller), the axis NAMES
 *  (`axes`, see roiAxisNames.ts) and the request shape underneath
 *  `onIntegrate`/`onStats` (box_cut vs rulerBoxBody) differ. */
export default function MapRoiCommitBar(props: CommitBarProps) {
  const { preview, previewAxis, onPreviewAxisChange, previewStats, onIntegrate, landingBusy, onStats, statsBusy, apiStats, statsError, onClearStats, onRemove, removeLabel, axes, actions = true } = props;
  return (
    <>
      <div className="qzk-roi-bar-row">
        <span className="qzk-roi-bar-label">preview</span>
        <div className="qzk-roi-axis-toggle">
          <button className={previewAxis === "x" ? "active" : ""} title={previewTitle(axes.x)} onClick={() => onPreviewAxisChange("x")}>
            {axes.x.name}
          </button>
          <button className={previewAxis === "y" ? "active" : ""} title={previewTitle(axes.y)} onClick={() => onPreviewAxisChange("y")}>
            {axes.y.name}
          </button>
        </div>
        <button className="qzk-chip-reset" title={removeLabel} aria-label={removeLabel} onClick={onRemove}>
          ✕
        </button>
      </div>
      <svg className="qzk-roi-sparkline" width={SPARK_W} height={SPARK_H} viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}>
        {preview && preview.x.length > 1 && (
          <polyline points={sparklinePoints(preview, SPARK_W, SPARK_H)} fill="none" stroke="var(--accent)" strokeWidth={1.5} />
        )}
      </svg>
      <div className="qzk-roi-bar-row qzk-roi-bar-readout">
        <span>N</span>
        <span>{previewStats ? previewStats.n_points : "—"}</span>
        <span>∫I</span>
        <span>{previewStats ? fmt(previewStats.integrated_intensity) : "—"}</span>
      </div>
      {/* The two ∫ buttons get a row to themselves: named axes ("∫ 2Theta")
          do not fit three-to-a-row in a 216 px bar the way "∫x" did, and the
          name is the whole point of the change. */}
      {actions && (
        <>
          <div className="qzk-roi-bar-row">
            <Button size="sm" disabled={landingBusy} onClick={() => onIntegrate("x")} title={integrateTitle(axes.x)}>
              {`∫ ${axes.x.name}`}
            </Button>
            <Button size="sm" disabled={landingBusy} onClick={() => onIntegrate("y")} title={integrateTitle(axes.y)}>
              {`∫ ${axes.y.name}`}
            </Button>
          </div>
          <div className="qzk-roi-bar-row">
            <Button size="sm" disabled={statsBusy} onClick={onStats} title="Fetch box_stats from the backend">
              {statsBusy ? "Stats…" : "Stats"}
            </Button>
          </div>
        </>
      )}
      {apiStats && (
        <div className="qzk-roi-bar-stats">
          <span>∫I</span>
          <strong>{fmt(apiStats.integrated_intensity)}</strong>
          <span>centroid</span>
          <strong>
            {fmt(apiStats.centroid_x)}, {fmt(apiStats.centroid_y)}
          </strong>
          <span>peak</span>
          <strong>
            {fmt(apiStats.peak_x)}, {fmt(apiStats.peak_y)}
          </strong>
          <span>N</span>
          <strong>{apiStats.n_points}</strong>
          <button aria-label="Clear stats" className="qzk-chip-reset" title="Clear" onClick={onClearStats}>
            ×
          </button>
        </div>
      )}
      {statsError && <div className="qzk-roi-bar-error">{statsError}</div>}
    </>
  );
}
