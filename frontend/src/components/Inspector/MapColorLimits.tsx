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

import { mapViewFor } from "../../lib/mapView";
import { useApp } from "../../store/useApp";
import { NumberField } from "../primitives/NumberField";

export default function MapColorLimits() {
  // The Inspector describes the ACTIVE dataset, so it edits that dataset's own
  // map view (P2.8 review round 2 — the views are keyed by dataset id, and a
  // map document window showing some other dataset has its own entry).
  const dsId = useApp((s) => s.activeId);
  const mapViews = useApp((s) => s.mapViews);
  const colorLimits = mapViewFor(mapViews, dsId).colorLimits;
  const setMapColorLimits = useApp((s) => s.setMapColorLimits);

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
    </div>
  );
}
