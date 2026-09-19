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
//
// `painted` is optional and, when the PROP KEY is present at all (checked
// with `"painted" in props`, not a truthiness/undefined check — see review
// round 7, finding 1), wins over the hook's own store lookup: `MapToolbar`
// always supplies it, forwarding whatever `useMapPaint.ts` returned for the
// MapStage instance this toolbar sits in, so this control's "effective" hint
// always describes THIS instance's own canvas, never another open map's on
// the same dataset. `MapToolbarColorLimits.test.tsx` renders this component
// directly, with no live `MapStage`/`useMapPaint` behind it, and omits the
// prop entirely — the hook then falls back to its own store read, exactly as
// before this round.

import { fmt } from "./mapRender";
import { useMapColorLimitsField } from "../../lib/useMapColorLimitsField";

interface MapToolbarColorLimitsProps {
  datasetId: string | null;
  painted?: readonly [number, number] | null;
}

/** Visually hidden but still in the accessibility tree — lets "clim" label
 *  BOTH fields (review round 7, finding 8) without changing either input's
 *  tested `aria-label`, which still wins for the accessible name. */
const srOnly: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};

export default function MapToolbarColorLimits(props: MapToolbarColorLimitsProps) {
  const { datasetId } = props;
  const hasPaintedOverride = "painted" in props;
  const { lo, hi, setLo, setHi, commit, revert, effective } = useMapColorLimitsField(
    datasetId,
    hasPaintedOverride ? { value: props.painted } : undefined,
  );
  const onKeyDown = (e: { key: string }) => (e.key === "Enter" ? commit() : e.key === "Escape" ? revert() : undefined);
  const tooltip =
    "Colour limits for THIS map's dataset — blank = auto (the Inspector's Colour limits row edits only the active dataset)";

  return (
    <>
      <span className="qzk-tool-sep" />
      <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }} title={tooltip}>
        {/* Two sibling <label>s, one per input, rather than one <label>
            wrapping both (review round 7, finding 8): an HTML <label>'s
            IMPLICIT association binds to its first labelable descendant
            only, so a single wrapper made "clim" name the MIN field alone.
            Each input's own `aria-label` still governs its accessible name
            (it wins over a wrapping <label>'s text), so nothing tested here
            changes — only which field(s) "clim" is formally associated with. */}
        <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
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
        </label>
        <span style={{ color: "var(--text-faint)" }}>–</span>
        <label style={{ display: "flex", alignItems: "center" }}>
          <span style={srOnly}>clim</span>
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
      </span>
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
