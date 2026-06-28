// Two-frame reflectometry view: a refl1d export set is two datasets — a
// reflectivity curve (`*-refl.dat`: Q, dQ, R, dR, theory, fresnel) and an SLD
// depth profile (`*-profile.dat`: z, rho, irho). This pure layer classifies and
// pairs them by filename stem and packs each frame's PlotPayload. The backend
// io/refl1d parser already reads both; this just arranges them for display.

import type { PlotPayload, PlotSeriesSpec } from "./plotdata";
import type { DataStruct } from "./types";

const lc = (s: string) => s.toLowerCase();

/** A reflectivity curve: has an R channel plus a model column (theory/fresnel). */
export function isReflCurve(ds: DataStruct): boolean {
  const labs = ds.labels.map(lc);
  return labs.includes("r") && (labs.includes("theory") || labs.includes("fresnel"));
}

/** An SLD depth profile: has a rho channel (real scattering-length density). */
export function isProfile(ds: DataStruct): boolean {
  return ds.labels.some((l) => lc(l) === "rho");
}

// Strip the refl1d role suffix (`-refl`, `-profile`, `-slabs`, `-steps`, with an
// optional `-fix`/`-edit`/index tail) and the extension to get the shared stem.
const SUFFIX_RE = /-(refl|profile|slabs|steps)(-[a-z0-9]+)?$/i;
export function reflStem(name: string): string {
  return name.replace(/\.[^.]+$/, "").replace(SUFFIX_RE, "");
}

function findCol(ds: DataStruct, name: string): number {
  return ds.labels.findIndex((l) => lc(l) === lc(name));
}
function colData(ds: DataStruct, idx: number): (number | null)[] {
  return ds.values.map((row) => (Number.isFinite(row[idx]) ? row[idx] : null));
}
function xName(ds: DataStruct, fallback: string): string {
  return String(ds.metadata?.["x_column_name"] ?? fallback);
}
function xUnit(ds: DataStruct): string {
  return String(ds.metadata?.["x_column_unit"] ?? "");
}

/** Pack a subset of channels (by label, in order) against the dataset's x. */
function pack(ds: DataStruct, names: string[], xFallback: string): PlotPayload | null {
  const x = ds.time.map((v) => (Number.isFinite(v) ? v : null));
  const cols: (number | null)[][] = [x];
  const series: PlotSeriesSpec[] = [];
  for (const name of names) {
    const i = findCol(ds, name);
    if (i >= 0) {
      cols.push(colData(ds, i));
      series.push({ label: ds.labels[i], unit: ds.units[i] ?? "" });
    }
  }
  if (series.length === 0) return null;
  return {
    data: cols as PlotPayload["data"],
    series,
    xLabel: xName(ds, xFallback),
    xUnit: xUnit(ds),
  };
}

export interface ReflPanels {
  top: PlotPayload | null; // R + theory (+ fresnel) vs Q
  bottom: PlotPayload | null; // rho (+ irho) vs z
}

/** Build the two frames: top = measured + modelled reflectivity vs Q, bottom =
 *  the SLD profile vs depth. Either may be null if its dataset is absent. */
export function buildReflPanels(
  reflDs: DataStruct | null,
  profileDs: DataStruct | null,
): ReflPanels {
  return {
    top: reflDs ? pack(reflDs, ["R", "theory", "fresnel"], "Q") : null,
    bottom: profileDs ? pack(profileDs, ["rho", "irho"], "z") : null,
  };
}

export interface ReflPair {
  reflId: string | null;
  profileId: string | null;
}

/** Auto-pair a reflectivity dataset with its SLD profile by shared filename stem.
 *  Prefers a stem match; falls back to the first of each kind. Seeds the view's
 *  pickers so a freshly-imported refl1d set "just works". */
export function autoPair(datasets: { id: string; name: string; data: DataStruct }[]): ReflPair {
  const refls = datasets.filter((d) => isReflCurve(d.data));
  const profiles = datasets.filter((d) => isProfile(d.data));
  for (const r of refls) {
    const stem = reflStem(r.name);
    const p = profiles.find((d) => reflStem(d.name) === stem);
    if (p) return { reflId: r.id, profileId: p.id };
  }
  return { reflId: refls[0]?.id ?? null, profileId: profiles[0]?.id ?? null };
}
