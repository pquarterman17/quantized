// Neutron spin asymmetry SA = (R++ - R--)/(R++ + R--) — the pure half of the
// Reflectivity workshop's "Spin asym." mode. No React, no store, no fetch;
// the math itself is the backend's (/api/reductions/spin-asymmetry, port of
// +bosonPlotter/computeAsymmetryForExport.m).
//
// ONE Q GRID. The two cross-sections must be measured on the same Q points.
// Different grids are REFUSED with a pointer to interpolate first, never
// resampled here: a silent interpolation would put a model into the data.
//
// ERRORS. dR for each channel is the error column bound to it (the dataset's
// declared error roles, else the label inference every importer uses); a
// channel without one sends none, and the backend treats it as zero.

import type { SpinAsymmetryResult } from "../../../lib/api/reductions";
import { inferErrorBindings, type ErrorBinding } from "../../../lib/errorRoles";
import { analysisData } from "../../../lib/rowstate";
import type { DataStruct, Dataset } from "../../../lib/types";

export interface SpinChannel {
  q: number[];
  r: number[];
  dr: number[] | null;
}

const bindingsOf = (ds: Dataset): ErrorBinding[] => ds.errorRoles ?? inferErrorBindings(ds.data);

/** The symmetric y-error column bound to `col`, or null. */
export function errorColumnFor(ds: Dataset, col: number): number | null {
  const b = bindingsOf(ds).find((e) => e.target === col && e.axis === "y" && e.side === "both");
  return b ? b.channel : null;
}

/** The first value (non-error) column and its bound error column. */
export function defaultChannels(ds: Dataset): { col: number; errCol: number | null } {
  const errs = new Set(bindingsOf(ds).map((b) => b.channel));
  const col = Math.max(0, ds.data.labels.findIndex((_, i) => !errs.has(i)));
  return { col, errCol: errorColumnFor(ds, col) };
}

/** One spin channel's analysis rows (exclusions honoured); rows with no
 *  finite Q are dropped. R may be NaN or ≤ 0: the backend masks those. */
export function readChannel(ds: Dataset, col: number, errCol: number | null): SpinChannel {
  const d = analysisData(ds) ?? ds.data;
  const keep = d.time.flatMap((q, i) => (Number.isFinite(q) ? [i] : []));
  return {
    q: keep.map((i) => d.time[i]),
    r: keep.map((i) => d.values[i][col]),
    dr: errCol === null ? null : keep.map((i) => d.values[i][errCol]),
  };
}

export interface SpinPair {
  q: number[];
  rpp: number[];
  rmm: number[];
  dpp?: number[];
  dmm?: number[];
}

const sameQ = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9 * Math.max(Math.abs(a), Math.abs(b), 1e-12);

export function pairChannels(pp: SpinChannel, mm: SpinChannel): SpinPair | { error: string } {
  if (pp.q.length === 0 || mm.q.length === 0) return { error: "a channel has no rows with a finite Q" };
  if (pp.q.length !== mm.q.length || !pp.q.every((q, i) => sameQ(q, mm.q[i]))) {
    return { error: "R++ and R-- are on different Q grids; interpolate one onto the other first" };
  }
  return { q: pp.q, rpp: pp.r, rmm: mm.r, dpp: pp.dr ?? undefined, dmm: mm.dr ?? undefined };
}

/** The request, over the rows JSON can carry: R++, R-- (and each dR sent)
 *  finite. Every other row is invalid anyway (the backend masks a NaN R) and
 *  comes back NaN via `rows`. */
export function spinRequest(p: SpinPair): {
  body: { r_pp: number[]; r_mm: number[]; dr_pp?: number[]; dr_mm?: number[] };
  rows: number[];
} {
  const ok = (v: number | undefined): boolean => v === undefined || Number.isFinite(v);
  const rows = p.q.flatMap((_, i) =>
    Number.isFinite(p.rpp[i]) && Number.isFinite(p.rmm[i]) && ok(p.dpp?.[i]) && ok(p.dmm?.[i]) ? [i] : []);
  const pick = (a: number[]): number[] => rows.map((i) => a[i]);
  return {
    rows,
    body: {
      r_pp: pick(p.rpp), r_mm: pick(p.rmm),
      ...(p.dpp ? { dr_pp: pick(p.dpp) } : {}), ...(p.dmm ? { dr_mm: pick(p.dmm) } : {}),
    },
  };
}

export interface SpinSources {
  pp: { dataset: Dataset; col: number };
  mm: { dataset: Dataset; col: number };
}

const nan = (v: number | null): number => (v == null ? Number.NaN : v);
const ref = (s: { dataset: Dataset; col: number }) => ({
  id: s.dataset.id, name: s.dataset.name, channel: s.dataset.data.labels[s.col] ?? `Column ${s.col + 1}`,
});

/** SA(Q) with dSA bound as its symmetric error, and where it came from. */
export function asymmetryStruct(
  q: number[],
  rows: readonly number[],
  res: SpinAsymmetryResult,
  src: SpinSources,
): { data: DataStruct; errorRoles: ErrorBinding[] } {
  const meta = src.pp.dataset.data.metadata ?? {};
  const cells: [number, number][] = q.map(() => [Number.NaN, Number.NaN]);
  rows.forEach((r, k) => {
    cells[r] = [nan(res.asymmetry[k] ?? null), nan(res.d_asymmetry[k] ?? null)];
  });
  return {
    errorRoles: [{ channel: 1, target: 0, axis: "y", side: "both" }],
    data: {
      time: q,
      values: cells,
      labels: ["SA", "dSA"],
      units: ["", ""],
      metadata: {
        reduction: "spin_asymmetry",
        technique: "reflectometry",
        x_column_name: typeof meta.x_column_name === "string" ? meta.x_column_name : "Q",
        x_column_unit: typeof meta.x_column_unit === "string" ? meta.x_column_unit : "",
        spinAsymmetry: {
          formula: "(R++ - R--)/(R++ + R--)",
          pp: ref(src.pp),
          mm: ref(src.mm),
          n_valid: res.n_valid,
        },
      },
    },
  };
}
