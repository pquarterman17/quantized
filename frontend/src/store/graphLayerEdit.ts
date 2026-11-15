// Writes to a plot's graph layers (`PlotView.layers`, origin gap audit 3
// #15): the focused window's live field, or a background window's own view
// (`store/windowViewEdit.ts`, so a drag on an unfocused window lands there
// without a focus swap unmounting it mid-gesture). Every write is ONE undo
// step labelled `history`. Imported only by lazy code.

import { sanitizeLayers, type GraphLayer } from "../lib/graphLayers";
import { useApp } from "./useApp";
import { patchBackgroundView } from "./windowViewEdit";
import { plotWindowView } from "./windowDocuments";

/** The layers of `windowId` (a background window) or of the focused plot. */
export function layersOf(windowId?: string): GraphLayer[] {
  const s = useApp.getState();
  const win = windowId && windowId !== s.focusedWindowId ? s.plotWindows.find((w) => w.id === windowId) : undefined;
  return sanitizeLayers(win?.kind === "plot" ? plotWindowView(win).layers : s.layers);
}

/** Replace the layers with `fn(current)` as one undo step (equal = no-op). */
export function editLayers(fn: (layers: GraphLayer[]) => GraphLayer[], history: string, windowId?: string): void {
  const cur = layersOf(windowId);
  const next = fn(cur);
  if (JSON.stringify(next) === JSON.stringify(cur)) return;
  const s = useApp.getState();
  if (windowId && windowId !== s.focusedWindowId) return patchBackgroundView(windowId, { layers: next }, history);
  s.recordHistory(history);
  useApp.setState({ layers: next });
}

const NOUN: Record<GraphLayer["kind"], string> = { inset: "inset graph", image: "image", table: "table" };
export const layerNoun = (l: Pick<GraphLayer, "kind">): string => NOUN[l.kind];

/** Merge `patch` into layer `id`. */
export function patchLayer(id: string, patch: Partial<GraphLayer>, history: string, windowId?: string): void {
  editLayers((ls) => ls.map((l) => (l.id === id ? ({ ...l, ...patch } as GraphLayer) : l)), history, windowId);
}

export function removeLayer(id: string, windowId?: string): void {
  const l = layersOf(windowId).find((x) => x.id === id);
  if (l) editLayers((ls) => ls.filter((x) => x.id !== id), `delete ${layerNoun(l)}`, windowId);
}

let seq = 0;
export const nextLayerId = (): string => `layer-${Date.now().toString(36)}-${++seq}`;

/** Add `layer` on top of the focused plot's layers. */
export function addLayer(layer: GraphLayer): void {
  editLayers((ls) => [...ls, layer], `insert ${layerNoun(layer)}`);
}
