// Optical gap (Tauc) workshop — state hook. Picks an energy/wavelength column
// and an absorption (or transmittance) column of the active dataset, runs the
// Tauc transform + linear-edge fit (/api/optical-gap, calc.optical_gap) and
// reports Eg with its uncertainty. The fit window is auto-detected until the
// user types one. "Add Tauc data" writes the transformed edge as a dataset.

import { useEffect, useMemo, useRef, useState } from "react";

import { taucFit, type TaucResult, type TaucSignal, type TaucXUnit, type TransitionKind } from "../../../lib/api/analysisExtras";
import { ROW_POLICY, type AnalysisInputs } from "../../../lib/analysisInputs";
import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import type { DataStruct } from "../../../lib/types";
import { useLatestRef } from "../../../lib/previewKey";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { afterCommit } from "../workbench/afterCommit";
import { useAnalysisInputs } from "../analysisselection/useAnalysisInputs";
import { useAnalysisCommit } from "../resultcommit/useAnalysisCommit";
import { seedChoice, seedNumber, useReopenSeed, useSeedHold } from "../resultcommit/useReopenSession";
import { useFollowColumnPicks } from "../useFollowColumnPicks";
import { useLoadColumns, parseField, pickColumns, pickUnit, validPick, type PickColumn } from "../analysisextras/columnPicks";

export const TRANSITIONS: { value: TransitionKind; label: string }[] = [
  { value: "direct", label: "Direct allowed, (αhν)²" },
  { value: "direct-forbidden", label: "Direct forbidden, (αhν)^(2/3)" },
  { value: "indirect", label: "Indirect allowed, (αhν)^(1/2)" },
  { value: "indirect-forbidden", label: "Indirect forbidden, (αhν)^(1/3)" },
];

export interface OpticalGapState {
  hasData: boolean;
  inputs: AnalysisInputs;
  columns: PickColumn[];
  xCol: number;
  yCol: number;
  setXCol: (i: number) => void;
  setYCol: (i: number) => void;
  xUnit: TaucXUnit;
  setXUnit: (u: TaucXUnit) => void;
  signal: TaucSignal;
  setSignal: (s: TaucSignal) => void;
  percent: boolean;
  setPercent: (p: boolean) => void;
  thickness: string;
  setThickness: (v: string) => void;
  kind: TransitionKind;
  setKind: (k: TransitionKind) => void;
  eMin: string;
  eMax: string;
  setEMin: (v: string) => void;
  setEMax: (v: string) => void;
  busy: boolean;
  error: string | null;
  result: TaucResult | null;
  yLabel: string;
  fit: () => Promise<void>;
  addTaucData: () => void;
  /** Why "Add Tauc data" is disabled (already added, or nothing to add). */
  addDisabledReason: string | null;
  /** The output a commit replaces (opened from its result, Replace chosen), else null. */
  replacing: string | null;
}

/** X quantity from the column's unit, else from its values (a number above 30
 *  cannot be a photon energy in eV, so it is read as a wavelength in nm). */
export function guessXUnit(unit: string, x: number[]): TaucXUnit {
  if (/mev/i.test(unit)) return "meV";
  if (/ev/i.test(unit)) return "eV";
  if (/cm(\^?[-\u2212\u207b]\s*1|\u207b\u00b9)|1\s*\/\s*cm/i.test(unit)) return "cm-1";
  if (/nm/i.test(unit)) return "nm";
  if (/[\u00c5\u212b]|^\s*a(ng|\b)/i.test(unit)) return "A";
  if (/[\u00b5\u03bcu]m|micron/i.test(unit)) return "um";
  return maxFinite(x) > 30 ? "nm" : "eV";
}

/** Largest finite value (-Infinity when none). A loop: spreading a whole spectrum
 *  into Math.max throws once the column is large. */
function maxFinite(v: readonly number[]): number {
  let m = -Infinity;
  for (const n of v) if (Number.isFinite(n) && n > m) m = n;
  return m;
}

/** What the Y column holds, from its name and unit only (values cannot tell a
 *  0-100 absorption coefficient from a percent transmittance). Absorbance is its
 *  own choice (alpha only up to a constant); a reflectance column is never read
 *  as transmittance. Anything not recognised stays absorption. */
export function guessSignal(label: string, unit: string, y: number[]): { signal: TaucSignal; percent: boolean } {
  const text = `${label} ${unit}`;
  if (/reflect/i.test(text)) return { signal: "alpha", percent: false };
  if (/absorbance|^\s*(abs|a)\s*$/i.test(label)) return { signal: "absorbance", percent: false };
  if (/absor|alpha|\u03b1|cm/i.test(text)) return { signal: "alpha", percent: false };
  if (!(/transmi|%/i.test(text) || /^T(\b|$)/.test(label.trim()))) return { signal: "alpha", percent: false };
  return { signal: "transmittance", percent: unit.includes("%") || maxFinite(y) > 1.5 };
}

const OPTICAL_GAP_PRODUCER = { id: "optical-gap", label: "Optical gap", version: 1 } as const;
const X_UNITS: readonly TaucXUnit[] = ["eV", "meV", "cm-1", "nm", "A", "um"];
const SIGNALS: readonly TaucSignal[] = ["alpha", "absorbance", "transmittance"];

export function useOpticalGap(): OpticalGapState {
  const active = useActiveDataset();
  const resolveDataset = useApp((s) => s.resolveDataset);
  const columns = useMemo(() => pickColumns(active), [active]);
  const load = useLoadColumns();

  // "Open in Optical gap" (lane RO): start from the recorded choices; the reset
  // and unit-guess effects leave them alone until a column pick changes.
  const seed = useReopenSeed(OPTICAL_GAP_PRODUCER.id, active?.id)?.settings;
  const text = (v: unknown): string => (typeof v === "string" ? v : "");
  const seededPicks: [number, number] | null = seed ? [seedNumber(seed.xCol, -1), seedNumber(seed.yCol, 0)] : null;
  const holdGuess = useRef(seededPicks?.join(":") ?? null);
  const holdSeed = useSeedHold(!!seed, [active?.id]);
  const [picks, setPicks] = useState<[number, number]>(() => seededPicks ?? [-1, 0]);
  const [xUnit, setXUnit] = useState<TaucXUnit>(() => seedChoice(seed?.xUnit, X_UNITS, "eV"));
  const [signal, setSignal] = useState<TaucSignal>(() => seedChoice(seed?.signal, SIGNALS, "alpha"));
  const [percent, setPercent] = useState(() => seed?.percent === true);
  const [thickness, setThickness] = useState(() => text(seed?.thickness));
  const [kind, setKind] = useState<TransitionKind>(() => seedChoice(seed?.kind, TRANSITIONS.map((t) => t.value), "direct"));
  const [eMin, setEMin] = useState(() => text(seed?.eMin));
  const [eMax, setEMax] = useState(() => text(seed?.eMax));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stored, setStored] = useState<{ key: string; res: TaucResult } | null>(null);

  const xCol = validPick(columns, picks[0], -1);
  const yCol = validPick(columns, picks[1], 0);
  // The shared input contract: the analysis view of the picked X and Y (the fit loads through it too).
  const inputs = useAnalysisInputs({ xKey: xCol, yKeys: [yCol], policy: ROW_POLICY.analysisView });
  const fingerprint = useMemo(() => (active && !active.pending ? analysisDataFingerprint(active) : "pending"), [active]);
  const key = [active?.id, fingerprint, xCol, yCol, xUnit, signal, percent, thickness, kind, eMin, eMax].join(":");
  const result = stored && stored.key === key ? stored.res : null;
  const liveKey = useLatestRef(key);
  const settingsKey = JSON.stringify([xCol, yCol, xUnit, signal, percent, thickness, kind, eMin, eMax]);
  const settingsRef = useLatestRef(settingsKey);
  const hasData = !!active && columns.length >= 2;

  // A new dataset resets the picks and the fit window.
  useEffect(() => {
    if (holdSeed()) return; // a reopen's recorded choices, not the defaults
    setPicks([-1, 0]);
    setError(null);
    setEMin("");
    setEMax("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);
  // The picked columns say what the X unit and the signal are (re-read when a pick changes).
  useEffect(() => {
    if (!active) return;
    if (holdGuess.current === `${xCol}:${yCol}`) return; // the recorded unit and signal stand
    holdGuess.current = null;
    let live = true;
    load(active.id, [xCol, yCol]).then(
      (got) => {
        if (!live) return;
        const [x, y] = got.columns;
        setXUnit(guessXUnit(pickUnit(got.data, xCol), x));
        const guess = guessSignal(got.data.labels[yCol] ?? "", got.data.units[yCol] ?? "", y);
        setSignal(guess.signal);
        setPercent(guess.percent);
      },
      () => undefined, // a failed read keeps the current choices; Fit reports its own errors
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, xCol, yCol]);
  useFollowColumnPicks(active, (follow) => setPicks((p) => [follow(p[0]) ?? -1, follow(p[1]) ?? 0]));

  async function fit(): Promise<void> {
    if (!active) return;
    const lo = parseField(eMin);
    const hi = parseField(eMax);
    const t = parseField(thickness);
    if ((lo !== null && !Number.isFinite(lo)) || (hi !== null && !Number.isFinite(hi))) {
      setError("The fit range is not a number (leave it empty to detect the edge automatically).");
      return;
    }
    if (signal === "transmittance" && !(t !== null && t > 0)) {
      setError("Enter the film thickness (nm) to convert transmittance to absorption.");
      return;
    }
    const clickSettings = settingsKey;
    const clickKey = key;
    setBusy(true);
    setError(null);
    try {
      // A lazy book's arrival moves the key the result is stored under: install it,
      // let that commit land, then take the key this fit is asked with. With no wait
      // nothing can have changed, and the refs (which catch up in a passive effect)
      // may still trail the render this click came from, so the click's own key is
      // the truth: reading the refs there dropped a click made just after a commit.
      let launchKey = clickKey;
      if (active.pending) {
        await resolveDataset(active.id);
        await afterCommit();
        if (settingsRef.current !== clickSettings) return; // changed while the book loaded: this request carries the old ones
        launchKey = liveKey.current;
      }
      const got = await load(active.id, [xCol, yCol]);
      const [x, y] = got.columns;
      const res = await taucFit({
        x,
        y,
        x_unit: xUnit,
        signal,
        percent,
        thickness_nm: signal === "transmittance" ? (t as number) : signal === "absorbance" && t ? t : undefined,
        kind,
        e_min: lo ?? undefined,
        e_max: hi ?? undefined,
      });
      setStored({ key: launchKey, res });
    } catch (e) {
      setStored(null);
      setError(e instanceof Error ? e.message : "optical-gap fit failed");
    } finally {
      setBusy(false);
    }
  }

  const yLabel = `(αhν)^${Number((result?.gamma ?? 2).toPrecision(3))}`;

  // One undo step, no duplicates, stale when the source changes
  // (store/analysisOutputCommit.ts).
  const commit = useAnalysisCommit(result && active ? {
    producer: OPTICAL_GAP_PRODUCER,
    sourceId: active.id,
    computedOn: fingerprint,
    xKey: xCol < 0 ? null : xCol, // -1 is the time axis (C9)
    settings: {
      xCol, yCol, xUnit, signal, percent, thickness, kind, eMin, eMax,
      eg: result.eg, egSe: result.eg_se, window: [result.e_min, result.e_max], n: result.energy.length,
    },
    status: `added the Tauc data (Eg = ${result.eg.toFixed(3)} eV)`,
    output: (source) => {
      const t = parseField(thickness);
      const order = result.energy.map((_, i) => i).sort((a, b) => result.energy[a] - result.energy[b]);
      const data: DataStruct = {
        time: order.map((i) => result.energy[i]),
        values: order.map((i) => [result.alpha[i], result.tauc[i]]),
        // Absorbance without a thickness gives alpha only up to a constant: no unit claimed.
        labels: [signal === "absorbance" && !t ? "α (∝ A)" : "α", yLabel],
        units: [signal === "absorbance" && !t ? "" : "cm⁻¹", ""],
        metadata: {
          x_column_name: "Photon energy",
          x_column_unit: "eV",
          tauc: {
            transition: result.kind,
            eg: result.eg,
            eg_se: result.eg_se,
            eg_se_fit: result.eg_se_fit,
            eg_window_sd: result.eg_window_sd,
            ci_level: result.level,
            eg_low: result.eg_lcl,
            eg_high: result.eg_ucl,
            window: [result.e_min, result.e_max],
            auto_window: result.auto_window,
            r2: result.r2,
          },
        },
      };
      return { name: `${source.name} (Tauc, ${result.label.toLowerCase()})`, data };
    },
  } : null);

  function addTaucData(): void {
    if (commit.disabledReason) return;
    commit.commit();
  }

  return {
    hasData,
    inputs,
    columns,
    xCol,
    yCol,
    setXCol: (i) => setPicks((p) => [i, p[1]]),
    setYCol: (i) => setPicks((p) => [p[0], i]),
    xUnit,
    setXUnit,
    signal,
    setSignal,
    percent,
    setPercent,
    thickness,
    setThickness,
    kind,
    setKind,
    eMin,
    eMax,
    setEMin,
    setEMax,
    busy,
    error,
    result,
    yLabel,
    fit,
    addTaucData,
    addDisabledReason: commit.disabledReason,
    replacing: commit.replacing,
  };
}
