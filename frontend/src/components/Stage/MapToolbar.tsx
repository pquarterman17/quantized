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

/** Sector-wedge arm/disarm state (RSM_CUTS_PLAN item 12) — same reasoning as
 *  `RoiMode`/`RulerMode`: lives here so useMapSectorWedge.ts imports the
 *  type, not the reverse. Mutually exclusive with box/ruler/cuts (same
 *  canvas pointer gestures). */
export type WedgeMode = "off" | "sector";

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

  /** Sector-wedge arm/disarm (RSM_CUTS_PLAN item 12) — visible only when
   *  `qAvailable` (the wedge is meaningless without Q columns at all);
   *  disabled with a reason, not hidden, when `cutSpace` isn't currently
   *  "q" (the wedge needs the Q view on screen — see `useMapSectorWedge.ts`'s
   *  header). */
  wedgeMode: WedgeMode;
  onToggleWedge: () => void;

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
    wedgeMode,
    onToggleWedge,
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
          {/* ▣ / ▨ rather than the ▭ / ▱ these carried until 2026-08-12
              ("the controls were confusing, the icon wasn't super clear",
              owner, from a real release test). Two problems, one fix:
              ▭ and ▱ are a rectangle and a near-rectangle, indistinguishable
              at this size — AND both are already spoken for elsewhere in the
              app (▭ is the Rectangle SHAPE tool in plotToolbarDefs, ▱ is the
              plot toolbar's shapes-dock button), so the map's two tools were
              wearing two other tools' icons. ▣ reads as a region with content
              selected; ▨'s diagonal fill reads as the rotated swath the ruler
              actually is. The titles lead with what the tool PRODUCES, not
              with its shape. */}
          <button
            className={`qzk-tool-btn${roiMode === "roi" ? " active" : ""}`}
            title="Integration box — drag on the map to draw one; drag inside to move it, edges/corners to resize. Its own floating bar previews the profile and commits ∫ / Stats"
            onClick={onToggleRoi}
          >
            ▣
          </button>
          <button
            className={`qzk-tool-btn${rulerMode === "ruler" ? " active" : ""}`}
            title="Angled line cut (ruler) — drag along the cut direction to draw; endpoint handles set length and angle, side handles set width. Radial / transverse-about-a-peak actions live in the RSM panel"
            onClick={onToggleRuler}
          >
            ▨
          </button>
          {qAvailable && (
            <button
              className={`qzk-tool-btn${wedgeMode === "sector" ? " active" : ""}`}
              disabled={cutSpace !== "q"}
              title={
                cutSpace !== "q"
                  ? "Sector wedge needs the Q-space view — switch to Q first"
                  : "Sector wedge: drag the q/φ handles to resize, drag inside to rotate — Radial/Azimuthal commit from the floating bar; the panel's Sector card is still the exact-value entry point"
              }
              onClick={onToggleWedge}
            >
              ◔
            </button>
          )}
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
