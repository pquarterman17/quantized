// The first plot of a freshly imported dataset (UX audit 8, lane UX8-A), the
// lazy half: `withFirstPlot` runs `lib/firstPlot.ts` once at import (and on a
// re-import) and stores the picks as `metadata.first_plot`, which the eager
// `datasetViewDefaults` (store/windowDefaults.ts) only has to read; and
// `presentFirstPlot` says in the import toast what was picked, with a
// one-click way back, and opens a gridded x, y, z table as a map. Reached
// only from the lazy import / re-import chunks.
import { firstPlot } from "../lib/firstPlot";
import { ensureMapGate } from "../lib/mapdata";
import { textAxisFallbackChannel } from "../lib/modeling";
import { defaultDenseChannels } from "../lib/plotdata";
import { techniqueOf, techniqueViewDefaults } from "../lib/techniqueDefaults";
import type { Dataset } from "../lib/types";
import { TOAST_ACTION_TTL, toast, type ToastAction } from "./toasts";
import type { AppState } from "./useApp";
import { bookErrorLayer } from "./windowDefaults";

/** What `datasetViewDefaults` reads: the column labels the pick was made for
 *  (`of`: a dataset whose labels differ ignores it), the Y set when columns
 *  were left off, the Y2 set, and the decades that open Y on log. */
export interface FirstPlotHint {
  of: string[];
  y?: number[];
  y2?: number[];
  log?: number;
}

/** `ds` with its first plot stored in `metadata.first_plot` (any earlier one
 *  dropped; none stored when nothing changes). Never for an Origin book (its
 *  graphs and designations are the authority) or a parser-flagged 2-D map. */
export function withFirstPlot(ds: Dataset): Dataset {
  const { first_plot: _earlier, ...md } = ds.data.metadata ?? {};
  const plain = { ...ds, data: { ...ds.data, metadata: md } };
  if (md.origin_book != null || md.is2D === true || ds.data.labels.length === 0) return plain;
  const fp = firstPlot(ds.data, textAxisFallbackChannel(ds), bookErrorLayer(ds).hiddenChannels);
  if (!fp.yKeys && !fp.y2Keys && !fp.logDecades) return plain;
  const hint: FirstPlotHint = {
    of: ds.data.labels,
    ...(fp.yKeys ? { y: fp.yKeys } : {}),
    ...(fp.y2Keys ? { y2: fp.y2Keys } : {}),
    ...(fp.logDecades ? { log: fp.logDecades } : {}),
  };
  return { ...ds, data: { ...ds.data, metadata: { ...md, first_plot: hint } } };
}

const same = (a: readonly unknown[] | null | undefined, b: readonly unknown[] | null | undefined): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/** Toast what the first plot of the just-imported `id` did, if anything:
 *  "opened as a map" (Line plot), "log Y" (Linear Y), "Voltage on the right Y
 *  axis", "Temperature not plotted" (Plot all). Only while `id` is still
 *  active and each pick is still in the view; false when there was nothing
 *  to say (the caller then shows its plain toast). */
export async function presentFirstPlot(get: () => AppState, lead: string, id: string): Promise<boolean> {
  const ds = get().datasets.find((d) => d.id === id);
  if (!ds || get().activeId !== id) return false;
  const notes: string[] = [];
  const actions: ToastAction[] = [];
  const d = ds.data;
  const md = d.metadata;
  // An x, y, z table opens as a map when its two axes share a non-empty unit (x, y
  // in mm; 2θ, ω in deg) and cover a regular grid: the Map tab's own gate
  // (lib/mapdata), so the tab exists. Never for a parser-hinted or
  // technique-tagged file: "Field, Moment, Temperature" at a few setpoints
  // is a grid too, but its plot is M(H).
  const mapLike =
    d.labels.length === 2 && get().xKey === null && (d.units[0] ?? "").trim() !== "" &&
    (d.units[0] ?? "") === String(md.x_column_unit ?? "") &&
    md.origin_book == null && md.default_value_channels === undefined && techniqueOf(ds) === "generic";
  let mapped = false;
  // The table's grid gate is not enough (any two repeating columns pass it):
  // x and y1 themselves must tile.
  if (
    mapLike && get().stageTab === "plot" && (await ensureMapGate(d)) && (await import("../lib/mapGate")).hasGridPair(d, 0) &&
    get().activeId === id && get().stageTab === "plot"
  ) {
    get().setStageTab("map");
    mapped = true;
    notes.push("opened as a map");
    actions.push({ label: "Line plot", onClick: () => get().setStageTab("plot") });
  }
  const s = get();
  const fp = md.first_plot as FirstPlotHint | undefined;
  if (s.activeId !== id || !fp || !same(fp.of, d.labels)) return finish(lead, notes, actions);
  if (fp.log && s.yScale === "log" && techniqueViewDefaults(ds).yScale !== "log") {
    notes.push(`log Y (data spans ${fp.log} decades)`);
    actions.push({ label: "Linear Y", onClick: () => get().setYScale("linear") });
  }
  if (fp.y2 && same(s.y2Keys, fp.y2)) notes.push(`${fp.y2.map((c) => d.labels[c]).join(", ")} on the right Y axis`);
  // On a map the Plot tab's columns are a detail; Line plot is the way back.
  if (fp.y && same(s.yKeys, fp.y) && !mapped) {
    const shown = fp.y;
    const left = defaultDenseChannels(d, s.xKey).filter((c) => !shown.includes(c) && !s.hiddenChannels.includes(c));
    if (left.length > 0) {
      notes.push(`${left.map((c) => d.labels[c]).join(", ")} not plotted`);
      // One left-off quantity (Temperature) gets the free right axis; more
      // than one unit is never crammed onto one Y2, so those join Y1.
      const oneUnit = !fp.y2 && new Set(left.map((c) => d.units[c] ?? "")).size === 1;
      actions.push({
        label: "Plot all",
        onClick: () => {
          get().setYKeys(null);
          if (oneUnit) get().setY2Keys(left);
        },
      });
    }
  }
  return finish(lead, notes, actions);
}

function finish(lead: string, notes: string[], actions: ToastAction[]): boolean {
  if (notes.length === 0) return false;
  toast(`${lead} — ${notes.join("; ")}`, "ok", { actions, ttlMs: TOAST_ACTION_TTL * 2 });
  return true;
}
