// Magnetometry tools workshop — state hook for the Background tab (linear
// background removal, backed by golden calc.magnetometry helpers) plus the
// request guards every MagTools hook shares. The Units tab's explicit-basis
// sample normalization lives in ./useMagNormalization.ts (MAIN_PLAN #42).
// Each transform writes a new dataset to the library.
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
// (useMagNormalization.ts) SUBSTITUTES per axis instead, because a unit
// conversion is elementwise. See `lib/api/finitePairs.ts` for both contracts.

import { useMemo, useState } from "react";

import { dropGapRows, restoreGapRows } from "../../../lib/api/finitePairs";
import { subtractHysteresisBackground, subtractMagBackground } from "../../../lib/api/magnetometry";
import { fullPlottedX, plottedYKey } from "../../../lib/fitselectionActions";
import { ownXKey } from "../../../lib/perSeriesX";
import {
  detectMagXKind,
  magXAxis,
  stampXIdentity,
  type MagXDetection,
} from "../../../lib/magDataKind";
import type { Dataset, DataStruct } from "../../../lib/types";
import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import { commitComputedOutput } from "../../../store/commitComputedOutput";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { datasetInputsToken } from "../workbench/inputsKey";

/** The plotted X (independent variable — T or field) + primary Y (moment)
 *  CHANNELS over the FULL data (magnetometry transforms convert every row, so
 *  no analysis-row pruning), plus the Y channel index for labelling the output
 *  dataset. Follows the plot (audit P1 #1) instead of assuming time/values[0].
 *  Falls back to the first channel vs time when nothing is plotted. */
export function magXY(
  ds: Dataset,
  xKey: number | null,
  yKeys: number[] | null,
  seriesOrder: number[] | null,
): { x: number[]; y: number[]; yKey: number } {
  const yKey = plottedYKey(ds, xKey, yKeys, seriesOrder) ?? 0;
  return {
    x: fullPlottedX(ds.data, ownXKey(ds, xKey, yKey)), // a secondary-X Y reads its own X
    y: ds.data.values.map((row) => row[yKey]),
    yKey,
  };
}

export type MagTab = "background" | "units" | "demag" | "curie-weiss";

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

/** The Units tab's SOURCE units, read from the data: the plotted x's own unit
 *  when it is a field (blank = QD's "Oe"), else `null` (never convert it), and
 *  the plotted moment channel's unit (blank = "emu"). */
export function sourceUnits(
  ds: Dataset, xKey: number | null, yKeys: number[] | null, seriesOrder: number[] | null,
): { fromField: string | null; xLabel: string; xUnit: string; fromMoment: string } {
  const yKey = plottedYKey(ds, xKey, yKeys, seriesOrder) ?? 0;
  const axis = magXAxis(ds.data, ownXKey(ds, xKey, yKey));
  const isField = detectMagXKind(axis.label, axis.unit).kind === "field";
  return {
    fromField: isField ? axis.unit || "Oe" : null,
    xLabel: axis.label,
    xUnit: axis.unit,
    fromMoment: ds.data.units[yKey] || "emu",
  };
}

export const FIELD_UNITS = ["Oe", "T", "mT", "A/m"];

/** The two paths' natural defaults. They are NOT the same number and must
 *  never be sent to the other route: 10% of the temperature span is the high-T
 *  tail; 70% of max|H| is where a loop is saturated. */
export const DEFAULT_AUTO_FRACTION = 0.1;
export const DEFAULT_HI_FRACTION = 0.7;

const MAG_BACKGROUND_PRODUCER = { id: "mag-background", label: "Magnetometry background", version: 1 } as const;

export interface MagRequestView {
  sourceId: string;
  xKey: number | null;
  yKeys: number[] | null;
  seriesOrder: number[] | null;
}

function sameNumbers(a: readonly number[] | null, b: readonly number[] | null): boolean {
  return a === b || (!!a && !!b && a.length === b.length && a.every((value, index) => value === b[index]));
}

export function requestView(sourceId: string, xKey: number | null, yKeys: number[] | null, seriesOrder: number[] | null): MagRequestView {
  return { sourceId, xKey, yKeys: yKeys ? [...yKeys] : null, seriesOrder: seriesOrder ? [...seriesOrder] : null };
}

/** A lazy Origin-book resolution or backend call must never combine the
 * dataset captured by the click with a later dataset's plot bindings. */
export function requestStillCurrent(request: MagRequestView): boolean {
  const state = useApp.getState();
  return state.activeId === request.sourceId && state.xKey === request.xKey &&
    sameNumbers(state.yKeys, request.yKeys) && sameNumbers(state.seriesOrder, request.seriesOrder);
}

/** Resolve a lazy source, then reject it if selection changed while loading. */
export async function resolveCurrentRequest(request: MagRequestView): Promise<Dataset | undefined> {
  const ds = await useApp.getState().resolveDataset(request.sourceId);
  return ds && requestStillCurrent(request) ? ds : undefined;
}

/** Read the live dataset only from an imperative action. Kept beside the
 * other getState-based request guards so workshop hooks do not become new
 * render-body getState sites. */
export function currentRequestDataset(sourceId: string): Dataset | undefined {
  return useApp.getState().datasets.find((dataset) => dataset.id === sourceId);
}

/** After resolution, also require the exact source data that was sent to the
 * backend. A same-id reimport or correction while the call is in flight must
 * not receive an output derived from the superseded rows. */
export function resolvedSourceStillCurrent(request: MagRequestView, source: DataStruct): boolean {
  const state = useApp.getState();
  return requestStillCurrent(request) &&
    state.datasets.find((dataset) => dataset.id === request.sourceId)?.data === source;
}

/** The panel's result line, tagged with the dataset ids it is ABOUT — the
 *  source it was computed from and the corrected dataset it wrote. Shown only
 *  while one of those is active. */
interface Readout {
  owners: readonly string[];
  /** What the fit was measured for (see {@link bgRunKey}); null when there is no fit. */
  key: string | null;
  fit: MagBgFit | null;
  warning: string | null;
  error: string | null;
}

const EMPTY_READOUT: Readout = { owners: [], key: null, fit: null, warning: null, error: null };

/** Every input the background fit depends on (lane WB7): the source's rows /
 *  data, the plotted channels, the routine and ITS fraction (the other path's
 *  fraction is not an input). */
export function bgRunKey(
  ds: Dataset | null, xKey: number | null, yKeys: number[] | null, seriesOrder: number[] | null,
  path: MagBgPath | null, fraction: number,
): string {
  return JSON.stringify([datasetInputsToken(ds), xKey, yKeys, seriesOrder, path, fraction]);
}

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
  /** The plotted data's own units, for labelling the fit readout. */
  source: { fromField: string | null; xUnit: string; fromMoment: string } | null;
  fit: MagBgFit | null;
  /** The shown fit was measured for a different source / plot / routine / fraction
   *  than the panel now has (lane WB7): the fit and its warning are withheld. The
   *  corrected dataset it wrote is a committed output and is unaffected. */
  fitStale: boolean;
  warning: string | null;
  busy: boolean;
  error: string | null;
  subtractBackground: () => Promise<void>;
}

export function useMagTools(): MagToolsState {
  const active = useActiveDataset();
  const xKey = useApp((s) => s.xKey);
  const yKeys = useApp((s) => s.yKeys);
  const seriesOrder = useApp((s) => s.seriesOrder);
  const [tab, setTab] = useState<MagTab>("background");
  const [bgMode, setBgModeState] = useState<MagBgMode>("auto");
  const [autoFraction, setAutoFraction] = useState(DEFAULT_AUTO_FRACTION);
  const [hiFraction, setHiFraction] = useState(DEFAULT_HI_FRACTION);
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
    // The Y's OWN X decides field vs temperature (T1,R1,H2,M2: M2 is vs H2).
    const yKey = plottedYKey(active, xKey, yKeys, seriesOrder) ?? 0;
    const axis = magXAxis(active.data, ownXKey(active, xKey, yKey));
    return detectMagXKind(axis.label, axis.unit);
  }, [active, xKey, yKeys, seriesOrder]);
  const src = active ? sourceUnits(active, xKey, yKeys, seriesOrder) : null;

  const bgPath: MagBgPath | null =
    bgMode === "auto"
      ? detection.kind === "field"
        ? "mh"
        : detection.kind === "temperature"
          ? "mt"
          : null
      : bgMode;

  // On the corrected dataset the readout describes the dataset itself; on the
  // source it describes the run, so a moved input marks it.
  const liveKey = bgRunKey(active, xKey, yKeys, seriesOrder, bgPath, bgPath === "mh" ? hiFraction : autoFraction);
  const fitStale = visible.fit !== null && activeId === visible.owners[0] && visible.key !== liveKey;

  /** Switching path DISCARDS the previous readout. The two paths report
   *  different quantities (intercept vs offset), so leaving the old one on
   *  screen under the new path's label is the same mislabelling defect 4 is
   *  about, one step removed. */
  const setBgMode = (m: MagBgMode): void => {
    setBgModeState(m);
    setReadout(EMPTY_READOUT);
  };

  const stem = (): string => (active ? active.name.replace(/\.[^.]+$/, "") : "data");

  async function subtractBackground(): Promise<void> {
    if (!active) return;
    const request = requestView(active.id, xKey, yKeys, seriesOrder);
    const owners = [request.sourceId];
    const fraction = bgPath === "mh" ? hiFraction : autoFraction;
    if (!bgPath) {
      setReadout({
        owners,
        key: null,
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
      const ds = await useApp.getState().resolveDataset(request.sourceId);
      if (!ds || !requestStillCurrent(request)) return;
      const { x, y, yKey } = magXY(ds, request.xKey, request.yKeys, request.seriesOrder);
      // Gaps out (a `null` in the body is a 422 per element), gaps back in at
      // the same rows afterwards — lib/api/finitePairs.ts.
      const pairs = dropGapRows(x, y);
      if (pairs.keep.length < 3) {
        setReadout({
          owners,
          key: null,
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
      // Set on the commit, so a repeat that adds nothing keeps its own "already added" status.
      let status = "";
      if (bgPath === "mh") {
        const res = await subtractHysteresisBackground({
          h: pairs.x,
          m: pairs.y,
          hi_fraction: hiFraction,
        });
        if (!resolvedSourceStillCurrent(request, ds.data)) return;
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
          status = "no high-field background found (too few tail points)";
        } else if (res.offset === 0) {
          // The MINOR-LOOP branch (`calc/magnetometry.py`): high field on only
          // one side, so a symmetric centre is undefined and the routine
          // deliberately removes the slope WITHOUT centring. Saying "re-centred
          // the loop" here would claim something that did not happen.
          status = `removed χ·H background, not centred — high field on one side only (χ ${res.slope.toExponential(2)})`;
        } else {
          status = `removed χ·H background and re-centred the loop (χ ${res.slope.toExponential(2)})`;
        }
      } else {
        const res = await subtractMagBackground({
          temperature: pairs.x,
          moment: pairs.y,
          auto_fraction: autoFraction,
        });
        if (!resolvedSourceStillCurrent(request, ds.data)) return;
        corrected = restoreGapRows(res.corrected, pairs);
        fit = { kind: "mt", slope: res.slope, intercept: res.intercept };
        status = `subtracted high-T background (slope ${res.slope.toExponential(2)})`;
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
          ownXKey(ds, request.xKey, yKey), // the X `time` was read from
        ),
      };
      const suffix = bgPath === "mh" ? "loop bg-sub" : "bg-sub";
      // One undo step with its Library result; the same correction of the same data
      // adds nothing; the output goes out of date when the source changes.
      const outcome = commitComputedOutput({
        producer: MAG_BACKGROUND_PRODUCER,
        sources: [{ id: ds.id, computedOn: analysisDataFingerprint(ds) }],
        settings: { path: bgPath, fraction, xKey: request.xKey, yKey },
        name: `${stem()} (${suffix})`,
        data,
        status,
      });
      if (outcome.kind === "refused") {
        setReadout({ owners, key: null, fit: null, warning: null, error: outcome.reason });
        return;
      }
      setReadout({
        owners: [...owners, outcome.outputId],
        key: bgRunKey(ds, request.xKey, request.yKeys, request.seriesOrder, bgPath, fraction),
        fit,
        warning: warnings.length ? warnings.join(" ") : null,
        error: null,
      });
    } catch (e) {
      setReadout({
        owners,
        key: null,
        fit: null,
        warning: null,
        error: e instanceof Error ? e.message : "background subtraction failed",
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
    source: src,
    fit: fitStale ? null : visible.fit,
    fitStale,
    warning: fitStale ? null : visible.warning,
    busy,
    error: visible.error,
    subtractBackground,
  };
}
