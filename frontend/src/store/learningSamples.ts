// The sample gallery's registry and its open path (plan item 45). Each sample
// is a generated worksheet (lib/learning/sampleData.ts) plus the REAL store
// actions that turn it into its graph: nothing here writes store state by
// hand. One open is one undo step (the same fold the pipeline templates use),
// so Edit > Undo removes the worksheet and the graph together.
//
// Lazy-only: reached from the Help > Sample gallery command's chunk, never
// from the entry chunk.

import { requestTernaryPicks } from "../lib/ternaryPending";
import { nextDatasetId } from "./idSeq";
import { snapshotOf } from "./historySnapshot";
import { withFirstPlot } from "./firstPlotNotice";
import { useApp } from "./useApp";
import { DEFAULT_MAP3D } from "../lib/mapView3d";
import { inferErrorBindings } from "../lib/errorRoles";
import type { DataStruct, Dataset } from "../lib/types";
import * as data from "../lib/learning/sampleData";

export type SampleFamily = "errorbars" | "statistics" | "map" | "fit" | "ternary" | "surface";

export interface Sample {
  id: string;
  title: string;
  family: SampleFamily;
  /** One sentence: what the graph shows. */
  blurb: string;
  /** What opening it does, named by the app's own commands. */
  how: string;
  make: () => { name: string; data: DataStruct };
}

export const SAMPLES: readonly Sample[] = [
  { id: "decay", family: "errorbars", title: "Decay with error bars", blurb: "A signal falling toward a baseline, drawn with symbols and a per-point uncertainty.", how: "Error bars come from the Signal err column, as on import.", make: () => ({ name: "sample-decay.dat", data: data.decayWithErrors() }) },
  { id: "groups", family: "statistics", title: "Groups compared (violin)", blurb: "One response measured in three groups, shown as violins with the group levels on the axis.", how: "Opens the statistics view on the Group and Response columns, as Graph builder does.", make: () => ({ name: "sample-groups.dat", data: data.groupsCompared() }) },
  { id: "heatmap", family: "map", title: "Intensity heat map", blurb: "Two Gaussian peaks on a shallow background, on a 25 by 25 grid.", how: "Opens the worksheet as a 2-D map window.", make: () => ({ name: "sample-map.dat", data: data.intensityMap() }) },
  { id: "fit", family: "fit", title: "Fit with residuals", blurb: "A noisy calibration curve, its least-squares quadratic fit, and the residuals on the right axis.", how: "Response with symbols, the fit as a line, Residual on Y2.", make: () => ({ name: "sample-fit.dat", data: data.fitWithResiduals() }) },
  { id: "ternary", family: "ternary", title: "Ternary composition", blurb: "Hardness over a three-component composition triangle, compositions in wt%.", how: "Opens Plot > Create > Ternary diagram on the A, B, C columns; pick Hardness as the colour column.", make: () => ({ name: "sample-ternary.dat", data: data.ternaryComposition() }) },
  { id: "surface", family: "surface", title: "3-D surface", blurb: "A radial ripple, the same 2-D map shown as a rotatable surface.", how: "Opens the map window and switches it to its 3-D surface view.", make: () => ({ name: "sample-surface.dat", data: data.rippleSurface() }) },
];

/** Why a sample opened nothing, or null once it opened. */
export type OpenResult = { ok: true; datasetId: string } | { ok: false; reason: string };

async function showAsMap(id: string): Promise<void> {
  const s = useApp.getState();
  if (s.layoutMode !== "windows") return; // classic: addDataset already routed a 2-D map to the Map tab
  const m = await import("./windowLayoutMap");
  await m.openMapWindowFor(id);
}

/** Open one sample: its worksheet, then its graph, as ONE undo step. */
export async function openSample(id: string): Promise<OpenResult> {
  const sample = SAMPLES.find((x) => x.id === id);
  if (!sample) return { ok: false, reason: `unknown sample "${id}"` };
  const get = useApp.getState;
  const before = get().history;
  const lastSeq = before[before.length - 1]?.seq;
  const snapshot = snapshotOf(get());
  try {
    const made = sample.make();
    const roles = sample.family === "errorbars" ? inferErrorBindings(made.data) : undefined;
    const plain: Dataset = { id: nextDatasetId(), name: made.name, data: made.data, ...(roles?.length ? { errorRoles: roles } : {}) };
    const ds = sample.family === "fit" ? plain : withFirstPlot(plain);
    get().addDataset(ds);
    if (sample.family === "fit") {
      const s = get();
      s.setYKeys([0, 1]);
      s.setY2Keys([2]);
      s.setSeriesStyle(0, { marker: true });
    } else if (sample.family === "statistics") {
      get().seedStatStage({ mode: "violin", groupCol: 0, valueCol: 1 });
    } else if (sample.family === "ternary") {
      requestTernaryPicks({ datasetId: ds.id, a: 0, b: 1, c: 2 });
    } else if (sample.family === "map" || sample.family === "surface") {
      await showAsMap(ds.id);
      if (sample.family === "surface") get().setMapView3d(ds.id, { ...DEFAULT_MAP3D, kind: "surface" });
    }
    get().setStatus(`opened sample "${sample.title}" with its worksheet`);
    return { ok: true, datasetId: ds.id };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "the sample could not open";
    get().setStatus(`could not open sample "${sample.title}": ${reason}`, "danger");
    return { ok: false, reason };
  } finally {
    get().foldHistorySince(lastSeq, `open sample: ${sample.title}`, snapshot);
  }
}
