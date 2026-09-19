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
//
// The commit/undo/effective-pair logic itself lives in the shared
// `useMapColorLimitsField` hook (P2.8 residual (a), review round 3 finding 8)
// so this row and the per-window toolbar control
// (`components/Stage/MapToolbarColorLimits.tsx`) implement the gesture once —
// this component ALWAYS binds it to the ACTIVE dataset, which is what makes
// the per-dataset keying coherent for the Inspector's "describes the active
// selection" rule; only the layout below is specific to this card.

import { useMapColorLimitsField } from "../../lib/useMapColorLimitsField";
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
  // map document window showing some other dataset has its own entry; that
  // window's own colour-limit control is `components/Stage/
  // MapToolbarColorLimits.tsx`, sharing this same hook against THAT window's
  // dataset instead of `activeId`).
  const dsId = useApp((s) => s.activeId);
  const { lo, hi, setLo, setHi, commit, revert, effective } = useMapColorLimitsField(dsId);

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
          onKeyDown={(e) => (e.key === "Enter" ? commit() : e.key === "Escape" ? revert() : undefined)}
        />
        <span style={{ color: "var(--text-faint)" }}>–</span>
        <NumberField
          value={hi}
          width={64}
          placeholder="auto"
          aria-label="Map colour maximum"
          onChange={setHi}
          onBlur={commit}
          onKeyDown={(e) => (e.key === "Enter" ? commit() : e.key === "Escape" ? revert() : undefined)}
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
