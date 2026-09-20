// Magnetometry tools workshop — state hook. Two transforms backed by golden
// calc.magnetometry helpers that had no frontend: linear background removal
// and sample-aware field/moment unit conversion (convert_mag_units). Each
// writes a new dataset to the library.
//
// The Background tab DISPATCHES on what the x axis actually is (BUG-021):
// M(T) goes to the one-sided high-T fit (`subtract_mag_background`), an M(H)
// loop goes to the two-tail susceptibility removal + re-centring
// (`subtract_hysteresis_background`). Running the M(T) routine on a loop
// shears it down by Ms — see `lib/magDataKind.ts`'s header for the
// measurement and for why an undetectable x axis FAILS CLOSED (the user
// picks) instead of defaulting to either one.
//
// Non-finite entries (the gaps in a measured loop) never reach the wire:
// `JSON.stringify` writes them as `null`, which pydantic's `list[float]`
// rejects one element at a time. The Background tab DROPS those rows before
// the fit and puts them back at their original row indices; the Units tab
// SUBSTITUTES per axis instead, because a unit conversion is elementwise and
// dropping would throw away a good field value over a gap in the moment. See
// `lib/api/finitePairs.ts` for both contracts and why they differ.

import { useMemo, useState } from "react";

import {
  dropGapRows,
  restoreGapRows,
  restoreSubstituted,
  substituteGaps,
} from "../../../lib/api/finitePairs";
import {
  convertMagUnits,
  subtractHysteresisBackground,
  subtractMagBackground,
} from "../../../lib/api/magnetometry";
import { fullPlottedX, plottedYKey } from "../../../lib/fitselectionActions";
import { detectMagXKind, type MagXDetection } from "../../../lib/magDataKind";
import type { Dataset, DataStruct } from "../../../lib/types";
import { nextDatasetId, useActiveDataset, useApp } from "../../../store/useApp";

/** The plotted X (independent variable — T or field) + primary Y (moment)
 *  CHANNELS over the FULL data (magnetometry transforms convert every row, so
 *  no analysis-row pruning), plus the Y channel index for labelling the output
 *  dataset. Follows the plot (audit P1 #1) instead of assuming time/values[0].
 *  Falls back to the first channel vs time when nothing is plotted. */
function magXY(
  ds: Dataset,
  xKey: number | null,
  yKeys: number[] | null,
  seriesOrder: number[] | null,
): { x: number[]; y: number[]; yKey: number } {
  const yKey = plottedYKey(ds, xKey, yKeys, seriesOrder) ?? 0;
  return {
    x: fullPlottedX(ds.data, xKey),
    y: ds.data.values.map((row) => row[yKey]),
    yKey,
  };
}

/** The DECLARED name/unit of the plotted X — the `xKey` channel's own, or the
 *  `x_column_long` / `x_column_name` / `x_column_unit` hints when X is `time`.
 *
 *  `x_column_long` FIRST, exactly as `lib/plotdata.ts`, `lib/plotspec.ts`,
 *  `ChannelsCard.tsx`, `lib/quickFigureMapping.ts`, `lib/panelwindow.ts` and
 *  `lib/peakTableFit.ts` all resolve it. This is not cosmetic here:
 *  `io/origin_project/opj.py` puts Origin's SHORT column name in
 *  `x_column_name` (a bare letter — "A", "B", … "H", … "T") and the human
 *  label in `x_column_long`. Reading the short name alone hands
 *  `detectMagXKind` a single letter, whose whole-word symbol rule then fires:
 *  an M(T) curve whose Origin column happens to be "B" or "H" classifies as
 *  FIELD and silently runs the hysteresis routine — the same silent
 *  misdispatch this module exists to remove, mirror-imaged. Origin's
 *  unrecovered-x case writes `x_column_long: "Row"`, which matches neither
 *  rule and correctly lands on `unknown`. */
function magXAxis(data: DataStruct, xKey: number | null): { label: string; unit: string } {
  const named = xKey != null && xKey >= 0 && xKey < data.labels.length;
  return {
    label: named
      ? (data.labels[xKey] ?? "")
      : String(data.metadata?.["x_column_long"] || data.metadata?.["x_column_name"] || ""),
    unit: named ? (data.units[xKey] ?? "") : String(data.metadata?.["x_column_unit"] ?? ""),
  };
}

/** The `x_column_*` hints to STAMP on a derived dataset whose `time` is the
 *  plotted x of `src`.
 *
 *  A derived dataset's x is a bare `time` column, so whatever the source's
 *  hints said is what every downstream reader — including this hook's own
 *  detector on a second pass — will believe about it. When x came from a
 *  CHANNEL those inherited hints describe the source's ORIGINAL time column,
 *  a different quantity entirely: right after a successful M(H) run the panel
 *  could flip to "Cannot tell M(T) from M(H)" beside "removed: χ …", and a
 *  second run could dispatch off metadata for the wrong axis. Stamping the
 *  real identity (and clearing a now-meaningless long name) keeps the derived
 *  dataset self-describing. `unitOverride` is for the Units tab, whose x is
 *  converted. */
function stampXIdentity(
  meta: Record<string, unknown>,
  src: DataStruct,
  xKey: number | null,
  unitOverride?: string,
): Record<string, unknown> {
  const axis = magXAxis(src, xKey);
  const named = xKey != null && xKey >= 0 && xKey < src.labels.length;
  return {
    ...meta,
    x_column_name: axis.label,
    // The channel's own label IS the human label; there is no separate short
    // designation to keep, and the source's long name described another column.
    x_column_long: named ? axis.label : String(src.metadata?.["x_column_long"] ?? ""),
    x_column_unit: unitOverride ?? axis.unit,
  };
}

export type MagTab = "background" | "units";

/** Which background routine runs: `mt` = one-sided high-T fit, `mh` = both
 *  saturated tails + re-centre. `auto` follows {@link detectMagXKind}. */
export type MagBgMode = "auto" | "mt" | "mh";
export type MagBgPath = "mt" | "mh";

/** The reported quantities differ by path and are NOT interchangeable: the
 *  M(T) fit reports the line it removed (slope + intercept); the loop routine
 *  reports the susceptibility it removed and the vertical OFFSET it re-centred
 *  by — an offset, not an intercept. */
export type MagBgFit =
  | { kind: "mt"; slope: number; intercept: number }
  | { kind: "mh"; slope: number; offset: number };

export const FIELD_UNITS = ["Oe", "T", "mT", "A/m"];
export const MOMENT_UNITS = ["emu", "emu/g", "emu/cm³", "A·m²", "kA/m"];

/** The two paths' natural defaults. They are NOT the same number and must
 *  never be sent to the other route: 10% of the temperature span is the high-T
 *  tail; 70% of max|H| is where a loop is saturated. */
export const DEFAULT_AUTO_FRACTION = 0.1;
export const DEFAULT_HI_FRACTION = 0.7;

export interface UnitParams {
  fromField: string;
  toField: string;
  toMoment: string; // source moment is always "emu" (the only supported source)
  sampleMass: number; // g (for emu/g)
  sampleVolume: number; // cm³ (for emu/cm³, kA/m)
}

const DEFAULT_UNITS: UnitParams = {
  fromField: "Oe",
  toField: "T",
  toMoment: "emu",
  sampleMass: 0,
  sampleVolume: 0,
};

/** The panel's result line, tagged with the dataset ids it is ABOUT — the
 *  source it was computed from and the corrected dataset it wrote. Shown only
 *  while one of those is active. */
interface Readout {
  owners: readonly string[];
  fit: MagBgFit | null;
  warning: string | null;
  error: string | null;
}

const EMPTY_READOUT: Readout = { owners: [], fit: null, warning: null, error: null };

export interface MagToolsState {
  active: Dataset | null;
  tab: MagTab;
  setTab: (t: MagTab) => void;
  bgMode: MagBgMode;
  setBgMode: (m: MagBgMode) => void;
  /** What the declared x label/unit says the data is. */
  detection: MagXDetection;
  /** The routine that will actually run, or null when it cannot be decided. */
  bgPath: MagBgPath | null;
  autoFraction: number;
  setAutoFraction: (v: number) => void;
  hiFraction: number;
  setHiFraction: (v: number) => void;
  units: UnitParams;
  setUnits: (patch: Partial<UnitParams>) => void;
  fit: MagBgFit | null;
  warning: string | null;
  busy: boolean;
  error: string | null;
  subtractBackground: () => Promise<void>;
  convert: () => Promise<void>;
}

export function useMagTools(): MagToolsState {
  const active = useActiveDataset();
  const xKey = useApp((s) => s.xKey);
  const addDataset = useApp((s) => s.addDataset);
  const setStatus = useApp((s) => s.setStatus);
  const [tab, setTab] = useState<MagTab>("background");
  const [bgMode, setBgModeState] = useState<MagBgMode>("auto");
  const [autoFraction, setAutoFraction] = useState(DEFAULT_AUTO_FRACTION);
  const [hiFraction, setHiFraction] = useState(DEFAULT_HI_FRACTION);
  const [units, setUnitsState] = useState<UnitParams>(DEFAULT_UNITS);
  const [busy, setBusy] = useState(false);
  // The readout (fit + warning + error) BELONGS to the datasets it was
  // computed from and wrote. Selecting a different dataset re-labels the
  // panel — the detection is recomputed — but used to leave the PREVIOUS
  // dataset's slope/intercept on screen under the new path's wording: run
  // M(T) on A, click loop B, and A's intercept sits under "removed: χ …".
  //
  // Ownership is DERIVED, not cleared by an effect. An effect keyed on the
  // active id would fire on the app's own `addDataset`, which activates the
  // dataset just written — wiping the readout in the same turn that produced
  // it. Listing both the source and the output as owners keeps it visible
  // exactly where it means something.
  const [readout, setReadout] = useState<Readout>(EMPTY_READOUT);
  const activeId = active?.id ?? null;
  const visible = activeId && readout.owners.includes(activeId) ? readout : EMPTY_READOUT;

  const detection = useMemo<MagXDetection>(() => {
    if (!active) return { kind: "unknown", reason: "no dataset is selected" };
    const axis = magXAxis(active.data, xKey);
    return detectMagXKind(axis.label, axis.unit);
  }, [active, xKey]);

  const bgPath: MagBgPath | null =
    bgMode === "auto"
      ? detection.kind === "field"
        ? "mh"
        : detection.kind === "temperature"
          ? "mt"
          : null
      : bgMode;

  /** Switching path DISCARDS the previous readout. The two paths report
   *  different quantities (intercept vs offset), so leaving the old one on
   *  screen under the new path's label is the same mislabelling defect 4 is
   *  about, one step removed. */
  const setBgMode = (m: MagBgMode): void => {
    setBgModeState(m);
    setReadout(EMPTY_READOUT);
  };

  const setUnits = (patch: Partial<UnitParams>): void =>
    setUnitsState((u) => ({ ...u, ...patch }));

  const stem = (): string => (active ? active.name.replace(/\.[^.]+$/, "") : "data");

  async function subtractBackground(): Promise<void> {
    if (!active) return;
    const owners = [active.id];
    if (!bgPath) {
      setReadout({
        owners,
        fit: null,
        warning: null,
        error: `Cannot tell M(T) from M(H): ${detection.reason}. Choose the data type above.`,
      });
      return;
    }
    setBusy(true);
    setReadout(EMPTY_READOUT);
    try {
      // #38 deferred edge: resolve the active dataset's full data first.
      const ds = await useApp.getState().resolveDataset(active.id);
      if (!ds) return;
      const st = useApp.getState();
      const { x, y, yKey } = magXY(ds, st.xKey, st.yKeys, st.seriesOrder);
      // Gaps out (a `null` in the body is a 422 per element), gaps back in at
      // the same rows afterwards — lib/api/finitePairs.ts.
      const pairs = dropGapRows(x, y);
      if (pairs.keep.length < 3) {
        setReadout({
          owners,
          fit: null,
          warning: null,
          error: `Only ${pairs.keep.length} of ${pairs.n} rows have both a finite x and a finite moment — not enough to fit a background.`,
        });
        return;
      }
      // Accumulated, not `setWarning`n as we go: a gap notice and a no-op
      // notice can BOTH apply, and the second call would silently replace the
      // first.
      const warnings: string[] = [];
      if (!pairs.complete) {
        warnings.push(
          `${pairs.n - pairs.keep.length} of ${pairs.n} rows are gaps; they were excluded from the fit and stay gaps in the result.`,
        );
      }
      let corrected: number[];
      let fit: MagBgFit;
      if (bgPath === "mh") {
        const res = await subtractHysteresisBackground({
          h: pairs.x,
          m: pairs.y,
          hi_fraction: hiFraction,
        });
        corrected = restoreGapRows(res.corrected, pairs);
        fit = { kind: "mh", slope: res.slope, offset: res.offset };
        // `subtract_hysteresis_background` is a documented NO-OP — it returns
        // `(m, 0.0, 0.0)` unchanged — when fewer than `min_points` exceed
        // `hi_fraction*max|H|` or the field span is degenerate. Reporting that
        // as "removed χ·H … (χ 0, offset 0)" claims an analysis that did not
        // happen; the sibling `useHysteresis` already says so, and now this
        // path does too (reachable by raising High-field fraction, or on a
        // minor loop).
        if (res.slope === 0 && res.offset === 0) {
          warnings.push(
            "No high-field background found (too few saturated-tail points, or the field span is degenerate) — the moment is unchanged. Lower the high-field fraction to widen the tails.",
          );
          setStatus("no high-field background found (too few tail points)");
        } else if (res.offset === 0) {
          // The MINOR-LOOP branch (`calc/magnetometry.py`): high field on only
          // one side, so a symmetric centre is undefined and the routine
          // deliberately removes the slope WITHOUT centring. Saying "re-centred
          // the loop" here would claim something that did not happen.
          setStatus(
            `removed χ·H background, not centred — high field on one side only (χ ${res.slope.toExponential(2)})`,
          );
        } else {
          setStatus(
            `removed χ·H background and re-centred the loop (χ ${res.slope.toExponential(2)})`,
          );
        }
      } else {
        const res = await subtractMagBackground({
          temperature: pairs.x,
          moment: pairs.y,
          auto_fraction: autoFraction,
        });
        corrected = restoreGapRows(res.corrected, pairs);
        fit = { kind: "mt", slope: res.slope, intercept: res.intercept };
        setStatus(`subtracted high-T background (slope ${res.slope.toExponential(2)})`);
      }
      const data: DataStruct = {
        time: x, // the ORIGINAL x, gaps included — `corrected` is row-aligned to it
        values: corrected.map((v) => [v]),
        labels: [ds.data.labels[yKey] ?? "Moment"],
        units: [ds.data.units[yKey] ?? ""],
        metadata: stampXIdentity(
          {
            ...ds.data.metadata,
            ...(bgPath === "mh"
              ? { mag_hysteresis_bg_subtracted: true }
              : { mag_bg_subtracted: true }),
          },
          ds.data,
          st.xKey,
        ),
      };
      const suffix = bgPath === "mh" ? "loop bg-sub" : "bg-sub";
      const outId = nextDatasetId();
      addDataset({ id: outId, name: `${stem()} (${suffix})`, data });
      setReadout({
        owners: [...owners, outId],
        fit,
        warning: warnings.length ? warnings.join(" ") : null,
        error: null,
      });
    } catch (e) {
      setReadout({
        owners,
        fit: null,
        warning: null,
        error: e instanceof Error ? e.message : "background subtraction failed",
      });
    } finally {
      setBusy(false);
    }
  }

  async function convert(): Promise<void> {
    if (!active) return;
    const owners = [active.id];
    setBusy(true);
    setReadout(EMPTY_READOUT);
    try {
      // #38 deferred edge: resolve the active dataset's full data first.
      const ds = await useApp.getState().resolveDataset(active.id);
      if (!ds) return;
      const st = useApp.getState();
      const { x, y, yKey } = magXY(ds, st.xKey, st.yKeys, st.seriesOrder);
      // NOT `dropGapRows`. A unit conversion is a scalar multiply per axis, so
      // no row can influence another — pairing the coordinates here would
      // discard a perfectly good FIELD value just because that row's moment
      // was a gap. `substituteGaps` sends a placeholder per gap, per axis, and
      // throws its converted result away on the way back; each axis keeps
      // exactly the gaps it started with. See finitePairs.ts's
      // "ELEMENTWISE case" note for why this is safe here and nowhere near a
      // fit.
      const xs = substituteGaps(x);
      const ys = substituteGaps(y);
      const anyX = xs.finite.includes(true);
      const anyY = ys.finite.includes(true);
      if (x.length === 0 || (!anyX && !anyY)) {
        setReadout({
          owners,
          fit: null,
          warning: null,
          error: "No finite field or moment values to convert.",
        });
        return;
      }
      // One all-gap axis is not a reason to refuse — the other axis converts
      // perfectly well, and that is the whole point of converting per axis —
      // but the user should be told the output column is empty.
      const warnings: string[] = [];
      if (!anyX) warnings.push("Every field value is a gap; the converted x column is all gaps.");
      if (!anyY) warnings.push("Every moment value is a gap; the converted y column is all gaps.");
      const res = await convertMagUnits({
        x: xs.safe,
        y: ys.safe,
        from_field: units.fromField,
        to_field: units.toField,
        from_moment: "emu",
        to_moment: units.toMoment,
        sample_mass: units.sampleMass,
        sample_volume: units.sampleVolume,
      });
      const data: DataStruct = {
        time: restoreSubstituted(res.x, xs.finite),
        values: restoreSubstituted(res.y, ys.finite).map((v) => [v]),
        labels: [ds.data.labels[yKey] ?? "Moment"],
        units: [res.y_unit],
        // Stamps `x_column_long` too: the new unit-precedence rule reads it
        // FIRST, so leaving a stale inherited long name here would have the
        // converted dataset described by the wrong axis.
        metadata: stampXIdentity({ ...ds.data.metadata }, ds.data, st.xKey, res.x_unit),
      };
      const outId = nextDatasetId();
      addDataset({ id: outId, name: `${stem()} (${res.y_unit})`, data });
      if (res.warning) warnings.push(res.warning);
      setReadout({
        owners: [...owners, outId],
        fit: null,
        warning: warnings.length ? warnings.join(" ") : null,
        error: null,
      });
      setStatus(`converted to ${res.x_unit} / ${res.y_unit}`);
    } catch (e) {
      setReadout({
        owners,
        fit: null,
        warning: null,
        error: e instanceof Error ? e.message : "unit conversion failed",
      });
    } finally {
      setBusy(false);
    }
  }

  return {
    active,
    tab,
    setTab,
    bgMode,
    setBgMode,
    detection,
    bgPath,
    autoFraction,
    setAutoFraction,
    hiFraction,
    setHiFraction,
    units,
    setUnits,
    fit: visible.fit,
    warning: visible.warning,
    busy,
    error: visible.error,
    subtractBackground,
    convert,
  };
}
