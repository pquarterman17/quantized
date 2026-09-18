// Inspector control: the 2-D map's explicit colour (z) limits — audit P2.8's
// "Persist color limits/scale/map/slices/annotations". A filled min+max clips
// the heatmap and its colourbar to that range (Origin-style); clearing both
// restores auto, i.e. the regridded payload's own finite z extent, which is
// what the canvas used before this control existed.
//
// Deliberately a near-copy of the sibling `AxisLimits.tsx` — same
// commit-on-blur/Enter contract, same "partial or inverted range leaves the
// current value alone" rule, same store-mirroring effect — so the map's limits
// behave exactly like the plot's X/Y limits rather than inventing a second
// idiom for the same gesture. The difference that matters is undo: this one
// DOES record an entry (see `setMapColorLimits` in store/mapView.ts for why).

import { useEffect, useState } from "react";

import { mapViewFor, sameColorLimits } from "../../lib/mapView";
import { useApp } from "../../store/useApp";
import { NumberField } from "../primitives/NumberField";

/** Compact numeric label, 4 significant figures. A deliberate 3-line copy of
 *  `components/Stage/mapRender.ts`'s `fmt` rather than an import of it: this
 *  card is in the EAGER Inspector graph and that module is only loaded with
 *  the map itself (it pulls the colormap LUTs and the contour code with it),
 *  so importing one helper from it would move all of that eager. */
function num(v: number): string {
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(2);
  return Number(v.toPrecision(4)).toString();
}

export default function MapColorLimits() {
  // The Inspector describes the ACTIVE dataset, so it edits that dataset's own
  // map view (P2.8 review round 2 — the views are keyed by dataset id, and a
  // map document window showing some other dataset has its own entry).
  const dsId = useApp((s) => s.activeId);
  const mapViews = useApp((s) => s.mapViews);
  const colorLimits = mapViewFor(mapViews, dsId).colorLimits;
  const setMapColorLimits = useApp((s) => s.setMapColorLimits);
  // What the canvas is ACTUALLY painting with (P2.8 review round 3, finding
  // 2). `mapRender.effectiveColorLimits` can replace the stored pair — in log
  // mode a non-positive lower limit is raised to the grid's smallest positive
  // cell, and a pair that is unusable after that raise falls back to the
  // payload's own extent — and until this round the fields went on showing a
  // range the renderer was ignoring (enter -1 … 2 in log mode on data starting
  // at 7 and the map paints 7 … 9). The stored pair stays in the fields, so it
  // is still editable and still recoverable; the effective pair is shown
  // beside them, and only when the two actually differ.
  const painted = useApp((s) => (dsId ? s.mapPaintedLimits[dsId] : undefined));
  const effective =
    colorLimits !== null &&
    painted !== undefined &&
    !sameColorLimits(painted === null ? null : [painted[0], painted[1]], colorLimits)
      ? painted
      : undefined;

  const [lo, setLo] = useState("");
  const [hi, setHi] = useState("");

  // Mirror store → fields when the limits change elsewhere (a dataset switch
  // resets them to auto; undo restores an earlier pair).
  useEffect(() => {
    setLo(colorLimits ? String(colorLimits[0]) : "");
    setHi(colorLimits ? String(colorLimits[1]) : "");
  }, [colorLimits]);

  const commit = (): void => {
    if (lo === "" && hi === "") {
      if (colorLimits !== null) setMapColorLimits(dsId, null); // both blank → auto
      return;
    }
    const min = Number(lo);
    const max = Number(hi);
    if (!Number.isFinite(min) || !Number.isFinite(max) || !(min < max)) return;
    if (colorLimits && colorLimits[0] === min && colorLimits[1] === max) return; // no change, no undo entry
    setMapColorLimits(dsId, [min, max]);
  };

  return (
    <div style={{ marginTop: 12 }}>
      <span className="qzk-field-lbl">Colour limits</span>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
        <NumberField
          value={lo}
          width={64}
          placeholder="auto"
          aria-label="Map colour minimum"
          onChange={setLo}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
        />
        <span style={{ color: "var(--text-faint)" }}>–</span>
        <NumberField
          value={hi}
          width={64}
          placeholder="auto"
          aria-label="Map colour maximum"
          onChange={setHi}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
        />
      </div>
      {effective !== undefined && (
        <div
          data-testid="map-colour-limits-effective"
          style={{ marginTop: 4, color: "var(--text-dim)", font: "11px var(--font-ui)" }}
          title={
            "The map cannot paint the limits as typed — a log scale raises a non-positive " +
            "minimum to the smallest positive value, and a range the data cannot honour falls " +
            "back to the data's own range. The typed limits are kept."
          }
        >
          {effective === null
            ? "nothing to paint at these limits"
            : `effective ${num(effective[0])} – ${num(effective[1])}`}
        </div>
      )}
    </div>
  );
}
