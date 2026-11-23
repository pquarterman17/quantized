// The map toolbar's cut and ROI tools (H/V/segment cuts, integration box, angled
// cut, sector wedge, projections, swath width), split out of MapToolbar.tsx to
// keep it under the component ceiling. Only meaningful on an RSM axis pair, so
// the toolbar mounts it when `cutSpace != null`. Pure presentation.

import type { MapToolbarProps } from "./MapToolbar";

type CutToolsProps = Pick<
  MapToolbarProps,
  | "qAvailable" | "gridable" | "cutMode" | "onSetCutMode" | "cutWidth" | "onSetCutWidth" | "cutWidthTooltip" | "onProjection"
  | "roiMode" | "onToggleRoi" | "rulerMode" | "onToggleRuler" | "wedgeMode" | "onToggleWedge"
> & { cutSpace: NonNullable<MapToolbarProps["cutSpace"]> };

export default function MapToolbarCutTools({
  qAvailable, cutSpace, gridable, cutMode, onSetCutMode, cutWidth, onSetCutWidth, cutWidthTooltip, onProjection,
  roiMode, onToggleRoi, rulerMode, onToggleRuler, wedgeMode, onToggleWedge,
}: CutToolsProps) {
  return (
    <>
      <span className="qzk-tool-sep" />
      {gridable && (
        <button
          aria-label="H-cut"
          aria-pressed={cutMode === "h"}
          className={`qzk-tool-btn${cutMode === "h" ? " active" : ""}`}
          title="H-cut: click the map → intensity vs the horizontal axis at that height (width averages a swath)"
          onClick={() => onSetCutMode(cutMode === "h" ? "off" : "h")}
        >
          ─
        </button>
      )}
      {gridable && (
        <button
          aria-label="V-cut"
          aria-pressed={cutMode === "v"}
          className={`qzk-tool-btn${cutMode === "v" ? " active" : ""}`}
          title="V-cut: click the map → intensity vs the vertical axis at that position"
          onClick={() => onSetCutMode(cutMode === "v" ? "off" : "v")}
        >
          │
        </button>
      )}
      <button
        aria-label="Segment cut"
        aria-pressed={cutMode === "seg"}
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
        aria-label="Integration box"
        aria-pressed={roiMode === "roi"}
        className={`qzk-tool-btn${roiMode === "roi" ? " active" : ""}`}
        title="Integration box — drag on the map to draw one; drag inside to move it, edges/corners to resize; its own floating bar previews the profile and commits ∫ / Stats"
        onClick={onToggleRoi}
      >
        ▣
      </button>
      <button
        aria-label="Angled cut"
        aria-pressed={rulerMode === "ruler"}
        className={`qzk-tool-btn${rulerMode === "ruler" ? " active" : ""}`}
        title="Angled line cut (ruler) — drag along the cut direction to draw; endpoint handles set length and angle, side handles set width; radial / transverse-about-a-peak actions live in the RSM panel"
        onClick={onToggleRuler}
      >
        ▨
      </button>
      {qAvailable && (
        <button
          aria-label="Sector wedge"
          aria-pressed={wedgeMode === "sector"}
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
          aria-label="Project onto the horizontal axis"
          className="qzk-tool-btn"
          title="Project the whole map onto the horizontal axis (Σ over frames)"
          onClick={() => onProjection("pixels")}
        >
          Σx
        </button>
      )}
      {gridable && (
        <button
          aria-label="Project onto the vertical axis"
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
            style={{ width: 52, height: 24, boxSizing: "border-box" }}
          />
        </label>
      )}
    </>
  );
}
