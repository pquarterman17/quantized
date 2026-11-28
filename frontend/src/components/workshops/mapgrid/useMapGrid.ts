// Map gridding workshop — state hook. Three jobs, each committing a NEW derived
// dataset through the shared result contract (store/commitComputedOutput: one
// undo step, no duplicate on a repeat, marked out of date when a source
// changes, inputs and settings recorded; the sources are never edited):
//   grid     X, Y, Z columns of the active worksheet -> a regular map
//            (/api/map-ops/grid; analysis-view rows only, finite rows only)
//   formula  the active map's values from an expression of x, y, z
//   extract  the value at (x, y) in every selected map -> one row per map

import { useEffect, useMemo, useState } from "react";

import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import { extractPixels, gridXyz, mapFormula } from "../../../lib/api/mapGrid";
import type { CommitSettings } from "../../../lib/committedOutput";
import { sameAxes } from "../../../lib/mapBoxSpace";
import { extractionColumns, useMapPick } from "../../../lib/mapPick";
import { polygonRefusal } from "../../../lib/roiPolygon";
import type { DataStruct, Dataset } from "../../../lib/types";
import { commitComputedOutput } from "../../../store/commitComputedOutput";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { mapDefaults, pickColumns, pickLabel, pickUnit, useLoadColumns, validPick, type PickColumn } from "../analysisextras/columnPicks";
import { isAbortError } from "../workbench/useWorkbenchPreview";
import { useWorkbenchCommit } from "../workbench/useWorkbenchCommit";
import {
  buildFormulaRequest, buildGridRequest, buildLocation, emptyExtractForm, emptyFormulaForm, emptyGridForm, gridLabel,
  type ExtractForm, type FormulaForm, type GridForm, type MapGridMode,
} from "./mapGridForm";

export const MAP_GRID_PRODUCER = { id: "map-grid", label: "Map gridding", version: 1 } as const;

const isMap = (d: DataStruct | undefined): boolean => d?.metadata?.["is2D"] === true;
const short = (s: string, n = 36): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function defaults(cols: PickColumn[], ds: Dataset | null): [number, number, number] {
  const map = mapDefaults(ds);
  if (map) return map;
  const n = cols.length;
  return [cols[0]?.index ?? -1, cols[Math.min(1, n - 1)]?.index ?? -1, cols[Math.min(2, n - 1)]?.index ?? -1];
}

/** Three different columns: a repeated pick moves to the first column not yet used. */
function distinctPicks(p: number[], cols: PickColumn[]): [number, number, number] {
  const out = [...p];
  out.forEach((v, i) => {
    if (out.indexOf(v) === i) return;
    const free = cols.find((c) => !out.includes(c.index));
    if (free) out[i] = free.index;
  });
  return out as [number, number, number];
}

export interface MapGridState {
  mode: MapGridMode;
  setMode: (m: MapGridMode) => void;
  hasActive: boolean;
  isMap: boolean;
  columns: PickColumn[];
  picks: [number, number, number];
  setPick: (slot: 0 | 1 | 2, index: number) => void;
  grid: GridForm;
  setGrid: (patch: Partial<GridForm>) => void;
  formula: FormulaForm;
  setFormula: (patch: Partial<FormulaForm>) => void;
  extract: ExtractForm;
  setExtract: (patch: Partial<ExtractForm>) => void;
  maps: { id: string; name: string; selected: boolean }[];
  toggleMap: (id: string) => void;
  hasDrawnBox: boolean;
  /** Fill the location from the centre of the box drawn on the map. */
  boxCentre: () => void;
  /** The axes the map's Pick tool last read a point on ("2Theta / Omega"), or
   *  null when nothing was picked. Picking fills the location (see the hook). */
  pickedOn: string | null;
  busy: boolean;
  error: string | null;
  cancel: () => void;
  run: () => Promise<void>;
}

export function useMapGrid(): MapGridState {
  const active = useActiveDataset();
  const datasets = useApp((s) => s.datasets);
  const resolveDataset = useApp((s) => s.resolveDataset);
  const mapRoi = useApp((s) => s.mapRoi);
  const mapPolygon = useApp((s) => s.mapPolygon);
  const pick = useMapPick();
  const load = useLoadColumns();
  const committing = useWorkbenchCommit();
  const [mode, setModeState] = useState<MapGridMode>("grid");
  // The user's picks belong to the dataset they were made on: when another dataset becomes active
  // (an Apply makes its new map active) they must not be re-read against that one's columns.
  const [userPicks, setUserPicks] = useState<{ id: string; picks: [number, number, number] } | null>(null);
  const [grid, setGridState] = useState(emptyGridForm);
  const [formula, setFormulaState] = useState(emptyFormulaForm);
  const [extract, setExtractState] = useState(emptyExtractForm);
  const [skipped, setSkipped] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const columns = useMemo(() => pickColumns(active ?? null), [active]);
  const dflt = defaults(columns, active ?? null);
  const mine = userPicks && userPicks.id === active?.id ? userPicks.picks : null;
  const valid = (mine ?? dflt).map((p, i) => validPick(columns, p, dflt[i]!));
  // Only defaults are forced apart; a duplicate the user picked is refused at Apply, not rewritten.
  const picks = mine ? (valid as [number, number, number]) : distinctPicks(valid, columns);
  const maps = datasets.filter((d) => isMap(d.data)).map((d) => ({ id: d.id, name: d.name, selected: !skipped.includes(d.id) }));

  const commit = (sources: Dataset[], settings: CommitSettings, name: string, data: DataStruct): void => {
    const outcome = commitComputedOutput({
      producer: MAP_GRID_PRODUCER,
      sources: sources.map((d) => ({ id: d.id, computedOn: analysisDataFingerprint(d) })),
      settings,
      name,
      data,
      status: `created ${name}`,
    });
    if (outcome.kind === "refused") setError(outcome.reason);
  };

  const runGrid = async (signal: AbortSignal): Promise<void> => {
    if (!active) throw new Error("Select a worksheet with X, Y and Z columns.");
    const built = buildGridRequest(grid);
    if (built.error !== undefined) throw new Error(built.error);
    if (new Set(picks).size !== 3) throw new Error("Pick three different columns for X, Y and Z.");
    const { columns: cols, data } = await load(active.id, picks);
    signal.throwIfAborted();
    const [xs, ys, zs] = cols as [number[], number[], number[]];
    const [xl, yl, zl] = picks.map((p) => pickLabel(columns, p)) as [string, string, string];
    const [xu, yu, zu] = picks.map((p) => pickUnit(data, p)) as [string, string, string];
    const sheet: DataStruct = {
      time: xs, values: ys.map((y, i) => [y, zs[i]!]), labels: [yl, zl], units: [yu, zu],
      metadata: { x_column_name: xl, x_column_unit: xu, source: String(data.metadata["source"] ?? "") },
    };
    const out = await gridXyz({ ...built.req, dataset: sheet, x_col: -1, y_col: 0, z_col: 1 }, signal);
    signal.throwIfAborted();
    commit([active], { mode, picks, ...built.req }, `${active.name} · ${gridLabel(grid)}`, out);
  };

  const runFormula = async (signal: AbortSignal): Promise<void> => {
    if (!active || !isMap(active.data)) throw new Error("Select a 2-D map to set its values from a formula.");
    const built = buildFormulaRequest(formula);
    if (built.error !== undefined) throw new Error(built.error);
    const a = await resolveDataset(active.id);
    if (!a) throw new Error("the map is unavailable");
    signal.throwIfAborted();
    const out = await mapFormula({ ...built.req, dataset: a.data }, signal);
    signal.throwIfAborted();
    commit([a], { mode, ...built.req }, `${a.name} · ${short(built.req.expr)}`, out);
  };

  const runExtract = async (signal: AbortSignal): Promise<void> => {
    const built = buildLocation(extract);
    if (built.error !== undefined) throw new Error(built.error);
    const chosen = maps.filter((m) => m.selected);
    if (chosen.length === 0) throw new Error("Tick at least one map.");
    const resolved: Dataset[] = [];
    for (const m of chosen) {
      const d = await resolveDataset(m.id);
      if (!d) throw new Error(`the map ${m.name} is unavailable`);
      resolved.push(d);
    }
    signal.throwIfAborted();
    const out = await extractPixels({ ...built.req, maps: resolved.map((d) => ({ name: d.name, dataset: d.data })) }, signal);
    signal.throwIfAborted();
    const where = `(${extract.x}, ${extract.y})`;
    commit(resolved, { mode, ...built.req, maps: resolved.map((d) => d.name) }, `${resolved[0]!.name} · pixel ${where}`, out);
  };

  const run = async (): Promise<void> => {
    setError(null);
    await committing.run(async (signal) => {
      try {
        await (mode === "grid" ? runGrid : mode === "formula" ? runFormula : runExtract)(signal);
      } catch (e) {
        if (signal.aborted || isAbortError(e)) return;
        setError(e instanceof Error ? e.message : "the operation failed");
      }
    });
  };

  // A point picked on the map (Pick tool) fills the location, on the click and
  // when the workshop opens over an earlier pick. The map stage only accepts a
  // click on the maps' own axes, so what arrives here is always well defined.
  useEffect(() => {
    if (!pick) return;
    setError(null);
    setExtractState({ x: String(Number(pick.x.toPrecision(8))), y: String(Number(pick.y.toPrecision(8))) });
  }, [pick]);

  const boxCentre = (): void => {
    if (!mapRoi && mapPolygon) { setError(polygonRefusal("The pixel-extraction centre")); return; }
    if (!mapRoi) { setError("Draw a box on the map first (Box tool in the map toolbar)."); return; }
    // The extraction reads each map on its own axes: an angular box is those axes on an RSM, and a plain-map box is
    // fine when it was drawn on exactly that pair. A Q box is on other axes.
    const own = active ? extractionColumns(active.data) : null;
    const ownAxes: [string, string] | null = own && active ? [active.data.labels[own[0]]!, active.data.labels[own[1]]!] : null;
    const ok = mapRoi.space === "angular" || (mapRoi.space === "map" && sameAxes(mapRoi.axes, ownAxes));
    if (!ok) { setError(mapRoi.space === "q" ? "The box was drawn in Q space; pixel extraction reads each map's own axes. Draw it on the angular view." : "The box was drawn on axes other than the ones pixel extraction reads; draw it on the map's own axes, or pick a point instead."); return; }
    setError(null);
    const mid = (a: number, b: number): string => String(Number(((a + b) / 2).toPrecision(8)));
    setExtractState({ x: mid(mapRoi.x0, mapRoi.x1), y: mid(mapRoi.y0, mapRoi.y1) });
  };

  return {
    mode,
    setMode: (m) => { setModeState(m); setError(null); },
    hasActive: !!active,
    isMap: isMap(active?.data),
    columns,
    picks,
    setPick: (slot, index) => setUserPicks(() => {
      const n: [number, number, number] = [...picks];
      n[slot] = index;
      return { id: active?.id ?? "", picks: n };
    }),
    grid,
    setGrid: (patch) => setGridState((f) => ({ ...f, ...patch })),
    formula,
    setFormula: (patch) => setFormulaState((f) => ({ ...f, ...patch })),
    extract,
    setExtract: (patch) => setExtractState((f) => ({ ...f, ...patch })),
    maps,
    toggleMap: (id) => setSkipped((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id])),
    hasDrawnBox: mapRoi != null || mapPolygon != null,
    boxCentre,
    pickedOn: pick ? `${pick.axes[0]} / ${pick.axes[1]}` : null,
    busy: committing.busy,
    error,
    cancel: committing.abort,
    run,
  };
}
