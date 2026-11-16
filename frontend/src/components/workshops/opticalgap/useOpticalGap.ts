// Optical gap (Tauc) workshop — state hook. Picks an energy/wavelength column
// and an absorption (or transmittance) column of the active dataset, runs the
// Tauc transform + linear-edge fit (/api/optical-gap, calc.optical_gap) and
// reports Eg with its uncertainty. The fit window is auto-detected until the
// user types one. "Add Tauc data" writes the transformed edge as a dataset.

import { useEffect, useMemo, useState } from "react";

import { taucFit, type TaucResult, type TransitionKind } from "../../../lib/api/analysisExtras";
import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import type { DataStruct } from "../../../lib/types";
import { nextDatasetId, useActiveDataset, useApp } from "../../../store/useApp";
import { useFollowColumnPicks } from "../useFollowColumnPicks";
import { useLoadColumns, parseField, pickColumns, validPick, type PickColumn } from "../analysisextras/columnPicks";

export const TRANSITIONS: { value: TransitionKind; label: string }[] = [
  { value: "direct", label: "Direct allowed, (αhν)²" },
  { value: "direct-forbidden", label: "Direct forbidden, (αhν)^(2/3)" },
  { value: "indirect", label: "Indirect allowed, (αhν)^(1/2)" },
  { value: "indirect-forbidden", label: "Indirect forbidden, (αhν)^(1/3)" },
];

export interface OpticalGapState {
  hasData: boolean;
  columns: PickColumn[];
  xCol: number;
  yCol: number;
  setXCol: (i: number) => void;
  setYCol: (i: number) => void;
  xUnit: "eV" | "nm";
  setXUnit: (u: "eV" | "nm") => void;
  signal: "alpha" | "transmittance";
  setSignal: (s: "alpha" | "transmittance") => void;
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
}

/** Wavelength-like X: a "nm" unit, or values that cannot be photon energies in eV. */
function guessXUnit(unit: string, x: number[]): "eV" | "nm" {
  if (/nm/i.test(unit)) return "nm";
  if (/ev/i.test(unit)) return "eV";
  return Math.max(...x.filter(Number.isFinite)) > 30 ? "nm" : "eV";
}

/** What the Y column holds, from its name and unit only (values cannot tell a
 *  0-100 absorption coefficient from a percent transmittance). Anything not
 *  recognised stays absorption, the plain-reading default. */
export function guessSignal(label: string, unit: string, y: number[]): { signal: "alpha" | "transmittance"; percent: boolean } {
  const text = `${label} ${unit}`;
  const absorption = /absor|alpha|α|cm/i.test(text);
  const trans = !absorption && (/transmi|%/i.test(text) || /^T(\b|$)/.test(label.trim()));
  if (!trans) return { signal: "alpha", percent: false };
  const top = Math.max(...y.filter(Number.isFinite));
  return { signal: "transmittance", percent: unit.includes("%") || top > 1.5 };
}

export function useOpticalGap(): OpticalGapState {
  const active = useActiveDataset();
  const addDataset = useApp((s) => s.addDataset);
  const setStatus = useApp((s) => s.setStatus);
  const columns = useMemo(() => pickColumns(active), [active]);
  const load = useLoadColumns();

  const [picks, setPicks] = useState<[number, number]>([-1, 0]);
  const [xUnit, setXUnit] = useState<"eV" | "nm">("eV");
  const [signal, setSignal] = useState<"alpha" | "transmittance">("alpha");
  const [percent, setPercent] = useState(false);
  const [thickness, setThickness] = useState("");
  const [kind, setKind] = useState<TransitionKind>("direct");
  const [eMin, setEMin] = useState("");
  const [eMax, setEMax] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stored, setStored] = useState<{ key: string; res: TaucResult } | null>(null);

  const xCol = validPick(columns, picks[0], -1);
  const yCol = validPick(columns, picks[1], 0);
  const fingerprint = useMemo(() => (active && !active.pending ? analysisDataFingerprint(active) : "pending"), [active]);
  const key = [active?.id, fingerprint, xCol, yCol, xUnit, signal, percent, thickness, kind, eMin, eMax].join(":");
  const result = stored && stored.key === key ? stored.res : null;
  const hasData = !!active && columns.length >= 2;

  // A new dataset: reset picks, then read its X unit and signal scale from the data.
  useEffect(() => {
    setPicks([-1, 0]);
    setError(null);
    setEMin("");
    setEMax("");
    if (!active) return;
    let live = true;
    void load(active.id, [-1, 0]).then((got) => {
      if (!live || !got) return;
      const [x, y] = got.columns;
      setXUnit(guessXUnit(String(got.data.metadata?.["x_column_unit"] ?? ""), x));
      const guess = guessSignal(got.data.labels[0] ?? "", got.data.units[0] ?? "", y);
      setSignal(guess.signal);
      setPercent(guess.percent);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);
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
    setBusy(true);
    setError(null);
    try {
      const got = await load(active.id, [xCol, yCol]);
      if (!got) return;
      const [x, y] = got.columns;
      const res = await taucFit({
        x,
        y,
        x_unit: xUnit,
        signal,
        percent,
        thickness_nm: signal === "transmittance" ? (t as number) : undefined,
        kind,
        e_min: lo ?? undefined,
        e_max: hi ?? undefined,
      });
      setStored({ key, res });
    } catch (e) {
      setStored(null);
      setError(e instanceof Error ? e.message : "optical-gap fit failed");
    } finally {
      setBusy(false);
    }
  }

  const yLabel = `(αhν)^${Number((result?.gamma ?? 2).toPrecision(3))}`;

  function addTaucData(): void {
    if (!result || !active) return;
    const order = result.energy.map((_, i) => i).sort((a, b) => result.energy[a] - result.energy[b]);
    const data: DataStruct = {
      time: order.map((i) => result.energy[i]),
      values: order.map((i) => [result.alpha[i], result.tauc[i]]),
      labels: ["α", yLabel],
      units: ["cm⁻¹", ""],
      metadata: {
        x_column_name: "Photon energy",
        x_column_unit: "eV",
        tauc: { transition: result.kind, eg: result.eg, eg_se: result.eg_se },
      },
    };
    addDataset({ id: nextDatasetId(), name: `${active.name} (Tauc, ${result.label.toLowerCase()})`, data });
    setStatus(`added the Tauc data (Eg = ${result.eg.toFixed(3)} eV)`);
  }

  return {
    hasData,
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
  };
}
