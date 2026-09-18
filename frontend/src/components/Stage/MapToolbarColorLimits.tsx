// Compact two-field colour-limit control for the map TOOLBAR
// (PRIMARY_SOFTWARE_AUDIT_PLAN P2.8 residual (a) — review round 3, finding 8:
// a `kind:"map"` document window on a NON-active dataset had no colour-limit
// control at all. The Inspector's `MapColorLimits.tsx` edits the ACTIVE
// dataset by rule — that rule is what makes the per-dataset keying coherent —
// and `MapToolbar` already covers colormap/scale per window (every write it
// makes already takes THAT window's own `datasetId`, never the active one,
// see MapStage.tsx's `setMapColormap(dsId, …)`); limits were the one thing
// that per-window coverage had not taken.
//
// Same commit/undo contract as the Inspector row, via the shared
// `useMapColorLimitsField` hook — one blur/Enter gesture is one undo entry,
// labelled with the dataset (store/mapView.ts's `edit()`, round-4's
// disambiguator when two live datasets share a name) — so this is not a
// second idiom for the same gesture, only a second, more compact LAYOUT for
// it. `fmt` (not a copy) is fine here, unlike the Inspector's: this component
// only ever mounts inside `MapToolbar`, which only ever mounts inside the
// lazy `MapStage` chunk that already imports `mapRender.ts` for the exact
// same formatting.

import { fmt } from "./mapRender";
import { useMapColorLimitsField } from "../../lib/useMapColorLimitsField";

export default function MapToolbarColorLimits({ datasetId }: { datasetId: string | null }) {
  const { lo, hi, setLo, setHi, commit, revert, effective } = useMapColorLimitsField(datasetId);
  const onKeyDown = (e: { key: string }) => (e.key === "Enter" ? commit() : e.key === "Escape" ? revert() : undefined);

  return (
    <>
      <span className="qzk-tool-sep" />
      <label
        style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}
        title="Colour limits for THIS map's dataset — blank = auto (the Inspector's Colour limits row edits only the active dataset)"
      >
        clim
        <input
          type="text"
          inputMode="decimal"
          value={lo}
          placeholder="auto"
          aria-label="Map window colour minimum"
          onChange={(e) => setLo(e.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
          style={{ width: 46 }}
        />
        <span style={{ color: "var(--text-faint)" }}>–</span>
        <input
          type="text"
          inputMode="decimal"
          value={hi}
          placeholder="auto"
          aria-label="Map window colour maximum"
          onChange={(e) => setHi(e.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
          style={{ width: 46 }}
        />
      </label>
      {effective !== undefined && (
        <span
          data-testid="map-toolbar-colour-limits-effective"
          style={{ fontSize: 10, color: "var(--text-dim)" }}
          title={
            effective === null
              ? "Nothing to paint at these limits."
              : "The map cannot paint the typed limits as-is (log-mode floor raise, or a range the " +
                "data cannot honour) — this is what it painted instead. The typed limits are kept."
          }
        >
          {effective === null ? "n/a" : `eff ${fmt(effective[0])}–${fmt(effective[1])}`}
        </span>
      )}
    </>
  );
}
