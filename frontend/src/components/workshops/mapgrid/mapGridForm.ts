// Map gridding workshop: the form models and the requests/names they produce.
// Pure (no React, no store) so the wiring is unit-testable.

import type { ExtractRequest, FormulaRequest, GridMethod, GridRequest, Variogram } from "../../../lib/api/mapGrid";

export type MapGridMode = "grid" | "formula" | "extract";

export const MODE_OPTIONS: { value: MapGridMode; label: string }[] = [
  { value: "grid", label: "Grid X, Y, Z columns to a map" },
  { value: "formula", label: "Map values from a formula" },
  { value: "extract", label: "Pixel at (x, y) across maps" },
];

export const METHOD_OPTIONS: { value: GridMethod; label: string }[] = [
  { value: "natural", label: "Natural neighbour (Sibson)" },
  { value: "linear", label: "Linear (triangulation)" },
  { value: "renka", label: "Renka-Cline (C1 cubic)" },
  { value: "shepard", label: "Modified Shepard (local)" },
  { value: "kriging", label: "Kriging (ordinary)" },
  { value: "nearest", label: "Nearest" },
  { value: "idw", label: "Inverse distance (global)" },
  { value: "thinplate", label: "Thin-plate spline" },
];

export const VARIOGRAM_OPTIONS: { value: Variogram; label: string }[] = [
  { value: "auto", label: "Best fit of the three" },
  { value: "spherical", label: "Spherical" },
  { value: "exponential", label: "Exponential" },
  { value: "gaussian", label: "Gaussian" },
];

export interface GridForm {
  method: GridMethod;
  nx: string;
  ny: string;
  logX: boolean;
  logY: boolean;
  /** false: blank outside the data's convex hull (default); true: fill with the nearest value. */
  nearestFill: boolean;
  output: "value" | "variance";
  variogram: Variogram;
  shepRadius: string;
  shepNeighbors: string;
  shepQuadratic: boolean;
}

export const emptyGridForm = (): GridForm => ({
  method: "natural", nx: "100", ny: "100", logX: false, logY: false, nearestFill: false,
  output: "value", variogram: "auto", shepRadius: "", shepNeighbors: "19", shepQuadratic: true,
});

const whole = (t: string, lo: number, hi: number): number | null => {
  const v = Number(t);
  return t.trim() !== "" && Number.isInteger(v) && v >= lo && v <= hi ? v : null;
};

type Built<T> = { req: T; error?: undefined } | { error: string; req?: undefined };

/** The grid request for the form (the dataset and column picks are added by the caller). */
export function buildGridRequest(f: GridForm): Built<Omit<GridRequest, "dataset" | "x_col" | "y_col" | "z_col">> {
  const nx = whole(f.nx, 2, 2000), ny = whole(f.ny, 2, 2000);
  if (nx === null || ny === null) return { error: "Grid size must be whole numbers from 2 to 2000 cells per axis." };
  if (f.output === "variance" && f.method !== "kriging") return { error: "Only kriging has a variance map; choose Kriging or output the values." };
  const req: Omit<GridRequest, "dataset" | "x_col" | "y_col" | "z_col"> = {
    method: f.method, nx, ny, log_x: f.logX, log_y: f.logY,
    extrapolation: f.nearestFill ? "nearest" : "none", output: f.output,
  };
  if (f.method === "kriging") req.variogram = f.variogram;
  if (f.method === "shepard") {
    const nb = whole(f.shepNeighbors, 3, 200);
    if (nb === null) return { error: "Shepard neighbours must be a whole number from 3 to 200." };
    req.shepard_neighbors = nb;
    req.shepard_quadratic = f.shepQuadratic;
    if (f.shepRadius.trim() !== "") {
      const r = Number(f.shepRadius);
      if (!(r > 0 && r <= 2)) return { error: "Shepard radius is a fraction of the data extent: above 0 and at most 2 (empty = adaptive)." };
      req.shepard_radius = r;
    }
  }
  return { req };
}

export function gridLabel(f: GridForm): string {
  const m = METHOD_OPTIONS.find((o) => o.value === f.method)?.label.split(" (")[0] ?? f.method;
  const log = f.logX || f.logY ? ` log${f.logX ? "X" : ""}${f.logY ? "Y" : ""}` : "";
  return `${f.output === "variance" ? "variance" : "grid"} ${m}${log}`;
}

export interface FormulaForm { expr: string; unit: string }
export const emptyFormulaForm = (): FormulaForm => ({ expr: "z", unit: "" });

export function buildFormulaRequest(f: FormulaForm): Built<Omit<FormulaRequest, "dataset">> {
  if (f.expr.trim() === "") return { error: "Enter a formula of x, y and z, for example z * 2 + x." };
  return { req: { expr: f.expr.trim(), ...(f.unit.trim() !== "" ? { unit: f.unit.trim() } : {}) } };
}

export interface ExtractForm { x: string; y: string }
export const emptyExtractForm = (): ExtractForm => ({ x: "", y: "" });

export function buildLocation(f: ExtractForm): Built<Pick<ExtractRequest, "x" | "y">> {
  const x = Number(f.x), y = Number(f.y);
  if (f.x.trim() === "" || f.y.trim() === "" || !Number.isFinite(x) || !Number.isFinite(y)) return { error: "Enter the X and Y of the location as numbers." };
  return { req: { x, y } };
}
