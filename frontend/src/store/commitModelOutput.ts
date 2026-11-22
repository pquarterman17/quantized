// Add a simulated reflectivity curve or SLD profile (lane RL4). A simulation
// has no source worksheet, so there is no result envelope or stale state to
// carry; the duplicate guard is the output's own digest, recorded in its
// metadata so it also holds after a project reload.

import { dataFingerprint } from "../lib/dataFingerprint";
import type { DataStruct } from "../lib/types";
import { nextDatasetId } from "./idSeq";
import { useApp } from "./useApp";

let _simCounter = 0;

/** Add a simulated curve unless this exact model output is already in the
 *  library (same kind, same numbers: a repeat click creates nothing). A
 *  simulation has no source worksheet, so there is no result envelope or stale
 *  state to carry; the guard is the output's own digest, recorded in its
 *  metadata so it also holds after a project reload. One undo step (addDataset). */
export function addModelOutput(kind: "reflectivity-sim" | "reflectivity-sld", label: string, data: DataStruct, status: string): void {
  const app = useApp.getState();
  const modelKey = `${kind}:${dataFingerprint(data)}`;
  const existing = app.datasets.find((d) => d.data.metadata?.model_key === modelKey);
  if (existing) {
    app.setActive(existing.id);
    app.setStatus(`this ${label} is already added as “${existing.name}”; nothing was duplicated`);
    return;
  }
  const n = ++_simCounter;
  app.addDataset({
    id: nextDatasetId(),
    name: kind === "reflectivity-sim" ? `Reflectivity model ${n}` : `SLD profile ${n}`,
    data: { ...data, metadata: { ...data.metadata, model_key: modelKey } },
  });
  app.setStatus(status);
}
