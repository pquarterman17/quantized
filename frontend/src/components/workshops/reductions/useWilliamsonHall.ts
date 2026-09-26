// Williamson-Hall section — state hook. Crystallite size + microstrain from an
// XRD peak list (2-theta, FWHM) via /api/reductions/williamson-hall ->
// calc.reductions.williamson_hall (golden vs MATLAB).
//
// PEAK ENTRY IS NO LONGER MANUAL-ONLY (audit P2.1). This header used to say the
// Peaks workshop's fitted peaks "live only in ITS OWN component state, never
// published to the store, so there is nothing durable to prefill from". That is
// the gap P2.1 closed: a fit is now saved onto its dataset as a durable
// `Dataset.peakTable` (lib/peakTable.ts), and `loadFittedPeaks` below fills this
// section's rows from it in one action — honouring the user's per-peak
// `excluded` flags and adopting the wavelength the pattern was measured at,
// when the instrument metadata recorded one. Manual entry stays exactly as it
// was for a pattern that was never fit here.
//
// The physics is untouched: the fit itself is still the backend's, and nothing
// in this hook computes a number the calc layer does not (CLAUDE.md's
// golden-parity rule). Per-peak UNCERTAINTIES are carried in the peak table
// (filled since 2026-09-26 when the Peak Analyzer's model fit published it)
// but NOT passed on — `calc.reductions.williamson_hall` takes no weights, so
// feeding it any would be new, ungoldened numerics. The caption says so when
// the loaded table has them. See P2.1's plan entry.

import { useMemo, useState } from "react";

import { williamsonHall } from "../../../lib/api/reductions";
import { includedPeaks, manualEditCount, peakTableMatchesData, peakTableXIsDegrees } from "../../../lib/peakTableFit";
import type { WilliamsonHallResult } from "../../../lib/reductionTypes";
import { useActiveDataset } from "../../../store/useApp";

export interface WHPeakRow {
  twoTheta: number;
  fwhm: number;
}

const emptyRow = (): WHPeakRow => ({ twoTheta: 0, fwhm: 0 });

export interface WilliamsonHallState {
  rows: WHPeakRow[];
  wavelength: number;
  kFactor: number;
  instrumentalBroadening: number;
  result: WilliamsonHallResult | null;
  busy: boolean;
  error: string | null;
  /** At least 2 rows, each with 0 < 2θ < 180 and FWHM > 0, plus positive
   *  wavelength/K — mirrors the backend's own validation (calc.reductions). */
  canCompute: boolean;
  /** How many of the active dataset's fitted peaks "Use fitted peaks" would
   *  load — i.e. its durable peak table minus the excluded rows. 0 when there
   *  is no table, which is also when the action is unavailable. */
  fittedPeakCount: number;
  /** How many rows of that table the user has excluded (0 when none, or when
   *  there is no table) — shown so the action never silently drops peaks. */
  fittedExcludedCount: number;
  /** Where the loaded rows came from, once `loadFittedPeaks` has run: the
   *  provenance the Peaks workshop recorded with the fit. Null until then, and
   *  cleared the moment a row or the wavelength is edited by hand (the rows are
   *  then no longer what the fit produced). */
  fittedSource: string | null;
  /** Why "Use fitted peaks" must NOT be taken, or null when it is safe (review
   *  round 2). Two refusals, both about the table describing something other
   *  than the reduction's own inputs: the dataset moved under the fit
   *  (`peakTableMatchesData`), or it was fit on an axis that is not 2-theta in
   *  degrees (`peakTableXIsDegrees` — a q axis passes `canCompute`'s
   *  `0 < 2θ < 180` check and yields a plausible-looking grain size; round 3
   *  made that check an exact unit match plus label evidence for a unit-less
   *  column, so a `q`/`""` axis is refused and a `degC` one is too). Rendered
   *  next to the disabled button so the refusal is never silent. */
  fittedBlockedReason: string | null;
  /** Replace the rows with the active dataset's INCLUDED fitted peaks, and
   *  adopt the fit's wavelength when the instrument metadata carried one. A
   *  no-op when there is no table, every peak in it is excluded, or
   *  `fittedBlockedReason` is set. */
  loadFittedPeaks: () => void;
  addRow: () => void;
  removeRow: (index: number) => void;
  updateRow: (index: number, patch: Partial<WHPeakRow>) => void;
  setWavelength: (v: number) => void;
  setKFactor: (v: number) => void;
  setInstrumentalBroadening: (v: number) => void;
  compute: () => Promise<void>;
  clear: () => void;
}

export function useWilliamsonHall(): WilliamsonHallState {
  const [rows, setRows] = useState<WHPeakRow[]>([emptyRow(), emptyRow()]);
  const [wavelength, setWavelengthRaw] = useState(1.5406);
  const [kFactor, setKFactor] = useState(0.9);
  const [instrumentalBroadening, setInstrumentalBroadening] = useState(0);
  const [result, setResult] = useState<WilliamsonHallResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fittedSource, setFittedSource] = useState<string | null>(null);
  const active = useActiveDataset();
  const table = active?.peakTable ?? null;
  const included = table ? includedPeaks(table) : [];
  // Memoized on the table + the DATASET identity: `peakDataFingerprint` walks
  // every value, and this hook re-renders on every keystroke in every field.
  // The dataset (not just `active.data`) is the right key now that the digest
  // covers the analysis view — a row exclusion changes `active`, not
  // `active.data`, and it does move the fit's real input.
  const fittedBlockedReason = useMemo(() => {
    if (!table || !active) return null;
    // NIT 4: name the REMEDY, not the cause. The digest is deliberately
    // conservative (adding a computed column invalidates too), so "the data
    // changed" can read as wrong to a user who only added a column; what is
    // always true is that this table can no longer be trusted as a
    // measurement of these rows, and that re-fitting is the one fix.
    if (!peakTableMatchesData(table, active))
      return `this dataset has changed since the fit — re-fit the peaks in the ${
        table.provenance.producer === "model_fit" ? "Peak Analyzer and publish again" : "Peaks workshop"}`;
    if (!peakTableXIsDegrees(table))
      return `fit on ${table.provenance.xLabel || "a non-2θ axis"} (${table.provenance.xUnit || "no unit recorded"}), not 2θ in degrees`;
    return null;
  }, [table, active]);

  const canCompute =
    rows.length >= 2 &&
    rows.every((r) => r.twoTheta > 0 && r.twoTheta < 180 && r.fwhm > 0) &&
    wavelength > 0 &&
    kFactor > 0;

  // Any hand edit invalidates the provenance label: the rows are then no longer
  // the fit's output, and claiming otherwise would be the exact kind of
  // untraceable result P2.1 exists to remove.
  const addRow = (): void => {
    setFittedSource(null);
    setRows((r) => [...r, emptyRow()]);
  };
  const removeRow = (index: number): void => {
    setFittedSource(null);
    setRows((r) => r.filter((_, i) => i !== index));
  };
  const updateRow = (index: number, patch: Partial<WHPeakRow>): void => {
    setFittedSource(null);
    setRows((r) => r.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  // Any hand edit of the WAVELENGTH invalidates the provenance label too
  // (review round 2): `loadFittedPeaks` adopts the fit's wavelength as part of
  // the same action, so a typed-over value means the inputs are no longer the
  // fit's — exactly the rule addRow/removeRow/updateRow already follow. The
  // load path below writes through `setWavelengthRaw` so it does not clear the
  // label it is in the middle of setting.
  const setWavelength = (v: number): void => {
    setFittedSource(null);
    setWavelengthRaw(v);
  };

  function loadFittedPeaks(): void {
    if (!table || included.length === 0 || fittedBlockedReason) return;
    setRows(included.map((p) => ({ twoTheta: p.center, fwhm: p.fwhm })));
    // The wavelength the pattern was MEASURED at beats whatever is currently
    // typed in the panel; absent metadata leaves the field alone rather than
    // guessing Cu Kα over someone's Mo source.
    if (table.provenance.wavelengthA != null) setWavelengthRaw(table.provenance.wavelengthA);
    setError(null);
    // Review round 2: the previous result must go with the inputs it was
    // computed from. Every row, the wavelength and the provenance caption all
    // change in this one click, and the result block renders on `result !=
    // null` — so without this the old grain size stays on screen captioned by
    // the NEW provenance line, which is the exact untraceable pairing this
    // feature exists to remove.
    setResult(null);
    const { datasetName, model, method, producer } = table.provenance;
    const excluded = table.peaks.length - included.length;
    const edited = manualEditCount(included);
    setFittedSource(
      `${included.length} fitted peak${included.length === 1 ? "" : "s"} from ${datasetName || "the active dataset"}` +
        ` · ${model} (${producer === "model_fit" ? "Peak Analyzer model fit" : method})` +
        (excluded > 0 ? ` · ${excluded} excluded` : "") +
        (edited > 0 ? ` · ${edited} edited by hand` : "") +
        // Honest about what the reduction does with the errors: nothing yet.
        (producer === "model_fit" ? " · per-peak errors not used (unweighted fit)" : ""),
    );
  }

  async function compute(): Promise<void> {
    if (!canCompute) {
      setError("enter at least 2 valid peaks (0 < 2θ < 180, FWHM > 0)");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await williamsonHall({
        two_theta_deg: rows.map((r) => r.twoTheta),
        fwhm_deg: rows.map((r) => r.fwhm),
        wavelength_a: wavelength,
        k_factor: kFactor,
        instrumental_broadening_deg: instrumentalBroadening,
      });
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Williamson-Hall fit failed");
    } finally {
      setBusy(false);
    }
  }

  function clear(): void {
    setResult(null);
    setError(null);
  }

  return {
    rows,
    wavelength,
    kFactor,
    instrumentalBroadening,
    result,
    busy,
    error,
    canCompute,
    fittedPeakCount: included.length,
    fittedExcludedCount: table ? table.peaks.length - included.length : 0,
    fittedSource,
    fittedBlockedReason,
    loadFittedPeaks,
    addRow,
    removeRow,
    updateRow,
    setWavelength,
    setKFactor,
    setInstrumentalBroadening,
    compute,
    clear,
  };
}
