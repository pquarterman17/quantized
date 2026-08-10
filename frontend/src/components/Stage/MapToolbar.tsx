// Float toolbar for the 2-D map viewer — extracted out of MapStage.tsx
// (RSM_CUTS_PLAN item 6, "PAY FIRST") to buy headroom for the box-ROI
// wiring before it lands: MapStage was 396/400 lines, one grouped-props
// dumb view away from the extraction the size ratchet always wants first.
// Pure presentation: every control's VALUE and CALLBACK is owned by
// MapStage (channel picks, colormap, cut tool state, the new ROI arm
// toggle); this component only lays them out. No behaviour change from
// the block it replaces.

import type { ColormapName } from "../../lib/colormap";
import type { CutMode, CutSpace } from "../../lib/mapcuts";

/** Box-ROI arm/disarm state (RSM_CUTS_PLAN item 6). Defined here (not in
 *  useMapRoi.ts) so this toolbar's extraction commit — step 1, "PAY
 *  FIRST" — stands alone with no dependency on the ROI hook that lands
 *  after it; useMapRoi.ts imports this type instead of the reverse. */
export type RoiMode = "off" | "roi";

/** Cut-ruler arm/disarm state (RSM_CUTS_PLAN item 7) — same reasoning as
 *  `RoiMode`: lives here so useMapRuler.ts imports the type, not the
 *  reverse. Box and ruler are mutually exclusive; MapStage.tsx's
 *  toggleRoi/toggleRuler/setCutMode keep only one of {roi, ruler, cuts}
 *  armed at a time. */
export type RulerMode = "off" | "ruler";

export interface MapToolbarProps {
  /** Angular ⇄ Q axis toggle (only shown when the dataset carries both). */
  qAvailable: boolean;
  isAngular: boolean;
  isQ: boolean;
  onAngular: () => void;
  onQ: () => void;

  /** X/Y/Z channel pickers. */
  labels: string[];
  keys: [number, number, number];
  onKeyChange: (slot: 0 | 1 | 2, value: number) => void;

  cmap: ColormapName;
  cmapOptions: string[];
  onCmapChange: (v: ColormapName) => void;
  logZ: boolean;
  onToggleLogZ: () => void;
  contourOn: boolean;
  onToggleContour: () => void;

  /** Cut tools (H/V/segment/projections) — only meaningful on an RSM axis
   *  pair, hence the whole group is gated on `cutSpace != null`. */
  cutSpace: CutSpace | null;
  gridable: boolean;
  cutMode: CutMode;
  onSetCutMode: (m: CutMode) => void;
  cutWidth: number;
  onSetCutWidth: (w: number) => void;
  cutWidthTooltip: string;
  onProjection: (axis: "pixels" | "frames") => void;

  /** Box ROI arm/disarm (RSM_CUTS_PLAN item 6) — lives in the same
   *  cutSpace-gated group as the other drawing tools; MapStage keeps it
   *  mutually exclusive with `cutMode` (arming one disarms the other). */
  roiMode: RoiMode;
  onToggleRoi: () => void;

  /** Cut-ruler arm/disarm (RSM_CUTS_PLAN item 7) — same group, mutually
   *  exclusive with both `roiMode` and `cutMode`. */
  rulerMode: RulerMode;
  onToggleRuler: () => void;

  onSavePng: () => void;
}

export default function MapToolbar(props: MapToolbarProps) {
  const {
    qAvailable,
    isAngular,
    isQ,
    onAngular,
    onQ,
    labels,
    keys,
    onKeyChange,
    cmap,
    cmapOptions,
    onCmapChange,
    logZ,
    onToggleLogZ,
    contourOn,
    onToggleContour,
    cutSpace,
    gridable,
    cutMode,
    onSetCutMode,
    cutWidth,
    onSetCutWidth,
    cutWidthTooltip,
    onProjection,
    roiMode,
    onToggleRoi,
    rulerMode,
    onToggleRuler,
    onSavePng,
  } = props;

  return (
    <div className="qzk-glass qzk-float-tools" style={{ gap: 8, padding: "6px 8px" }}>
      {qAvailable && (
        <>
          <button
            className={`qzk-tool-btn${isAngular ? " active" : ""}`}
            title="Angular axes (2θ / ω)"
            onClick={onAngular}
          >
            2θ/ω
          </button>
          <button className={`qzk-tool-btn${isQ ? " active" : ""}`} title="Reciprocal-space axes (Qx / Qz)" onClick={onQ}>
            Q
          </button>
          <span className="qzk-tool-sep" />
        </>
      )}
      {(["X", "Y", "Z"] as const).map((axis, slot) => (
        <Picker
          key={axis}
          label={axis}
          value={keys[slot]}
          options={labels.map((lab, i) => ({ v: i, text: lab }))}
          onChange={(v) => onKeyChange(slot as 0 | 1 | 2, Number(v))}
        />
      ))}
      <span className="qzk-tool-sep" />
      <Picker
        label="map"
        value={cmap}
        options={cmapOptions.map((n) => ({ v: n, text: n }))}
        onChange={(v) => onCmapChange(v as ColormapName)}
      />
      <button
        className={`qzk-tool-btn${logZ ? " active" : ""}`}
        title="Log intensity scale (for high-dynamic-range data like RSM)"
        onClick={onToggleLogZ}
      >
        log
      </button>
      <button
        className={`qzk-tool-btn${contourOn ? " active" : ""}`}
        title="Contour lines (level count + lin/log spacing live in the Inspector's 2-D map card)"
        onClick={onToggleContour}
      >
        ∿
      </button>
      {cutSpace != null && (
        <>
          <span className="qzk-tool-sep" />
          {gridable && (
            <button
              className={`qzk-tool-btn${cutMode === "h" ? " active" : ""}`}
              title="H-cut: click the map → intensity vs the horizontal axis at that height (width averages a swath)"
              onClick={() => onSetCutMode(cutMode === "h" ? "off" : "h")}
            >
              ─
            </button>
          )}
          {gridable && (
            <button
              className={`qzk-tool-btn${cutMode === "v" ? " active" : ""}`}
              title="V-cut: click the map → intensity vs the vertical axis at that position"
              onClick={() => onSetCutMode(cutMode === "v" ? "off" : "v")}
            >
              │
            </button>
          )}
          <button
            className={`qzk-tool-btn${cutMode === "seg" ? " active" : ""}`}
            title="Segment cut: drag any line across the map → distance-parametrized linescan"
            onClick={() => onSetCutMode(cutMode === "seg" ? "off" : "seg")}
          >
            ∕
          </button>
          <button
            className={`qzk-tool-btn${roiMode === "roi" ? " active" : ""}`}
            title="Box ROI: drag to draw, drag inside to move, edges/corners to resize — ∫ and stats commit from the floating bar"
            onClick={onToggleRoi}
          >
            ▭
          </button>
          <button
            className={`qzk-tool-btn${rulerMode === "ruler" ? " active" : ""}`}
            title="Cut ruler: drag along the cut direction to draw — endpoint handles set length/angle, width handles set width; radial/transverse-about-a-peak actions live in the RSM panel"
            onClick={onToggleRuler}
          >
            ▱
          </button>
          {gridable && (
            <button
              className="qzk-tool-btn"
              title="Project the whole map onto the horizontal axis (Σ over frames)"
              onClick={() => onProjection("pixels")}
            >
              Σx
            </button>
          )}
          {gridable && (
            <button
              className="qzk-tool-btn"
              title="Project the whole map onto the vertical axis (Σ over pixels — rocking-curve profile)"
              onClick={() => onProjection("frames")}
            >
              Σy
            </button>
          )}
          {cutMode !== "off" && (
            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }} title={cutWidthTooltip}>
              w
              <input
                type="number"
                min={0}
                step="any"
                value={cutWidth}
                onChange={(e) => onSetCutWidth(Math.max(0, Number(e.target.value) || 0))}
                style={{ width: 52 }}
              />
            </label>
          )}
        </>
      )}
      <span className="qzk-tool-sep" />
      <button className="qzk-tool-btn" title="Save map as PNG" onClick={onSavePng}>
        ⤓
      </button>
    </div>
  );
}

// A compact labeled <select> for the float toolbar (channel / colormap / grid).
function Picker({
  label,
  value,
  options,
  onChange,
  title,
}: {
  label: string;
  value: string | number;
  options: { v: string | number; text: string }[];
  onChange: (v: string) => void;
  title?: string;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }} title={title}>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={String(o.v)} value={o.v}>
            {o.text}
          </option>
        ))}
      </select>
    </label>
  );
}
