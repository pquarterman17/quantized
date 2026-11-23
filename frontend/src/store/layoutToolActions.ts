// What the tool windows and the Analysis window do to the layout and to the
// shared analysis selection (WORKSPACE_LAYOUT_PLAN P4, D7/D8). Lazy: only the
// layout host's subtree imports it.
//
// A tool window FOLLOWS the focused plot: that is how every tool reads its
// input already (the live "tool-default" capture of the shared selection, or
// the active worksheet). PINNING a tool freezes its input the way the shared
// resolver expects a reviewed handoff (lib/analysisInputs.ts precedence): the
// tool's selection becomes a non-live capture ("plot" source) of the pinned
// dataset, so it stops re-seeding from the plot, and a pinned dataset that is
// deleted REFUSES instead of falling back to whatever is active. Only the
// tools whose whole input path reads that selection can be pinned
// (lib/windowLayout/toolCatalog PINNABLE_TOOLS); the others say why not.
//
// The shared selection holds ONE tool's input at a time (store/analysisSelection).
// So a pin holds only while its tool owns it: when another tool takes it (a
// launch, a re-seed), the pin is dropped and the status line and the live
// region say so, instead of the tool quietly following the plot again.
//
// A RUN in progress (a tool's `busy` prop) must not follow a focus change
// half-way: an unpinned pinnable tool is pinned automatically for the run
// (session only, never saved) and follows again when it ends, both said out loud.

import { captureAnalysisSelection } from "../lib/analysisSelection";
import { close } from "../lib/windowLayout/ops";
import { clearPin, pinOf, setPin } from "../lib/windowLayout/pins";
import { toolRef } from "../lib/windowLayout/refs";
import { PINNABLE_TOOLS, pinRefusal } from "../lib/windowLayout/toolCatalog";
import { seedAnalysisSelection, useAnalysisSelection } from "./analysisSelection";
import { layoutTool, mountedTools, patchLayoutTool } from "./layoutTools";
import { useApp } from "./useApp";
import { applyLayout, reopenRef } from "./windowLayoutActions";

const nameOf = (id: string): string => useApp.getState().datasets.find((d) => d.id === id)?.name ?? "the dataset";
const titleOf = (id: string): string => layoutTool(id)?.title ?? id;

/** A tool mounted: open its window where it was (or at its default, the bottom). */
export const openToolPlacement = (id: string): void => reopenRef(toolRef(id));
/** A tool unmounted (its workshop closed): close its window, keeping the placement. */
export const closeToolPlacement = (id: string): void => applyLayout((l) => close(l, toolRef(id)));

/** The dataset a tool reads now: its owned selection item, else the active one. */
export function toolDataset(id: string): string | null {
  const sel = useAnalysisSelection.getState();
  const owned = sel.toolId === id ? sel.selection?.items[0]?.datasetId : undefined;
  return owned ?? useApp.getState().activeId;
}

/** The dataset a tool is pinned to (by the user, else for a run), or null. */
export function toolPin(id: string): { datasetId: string; auto: boolean } | null {
  const pinned = pinOf(useApp.getState().windowLayout, toolRef(id));
  if (pinned) return { datasetId: pinned, auto: false };
  const auto = layoutTool(id)?.autoPin ?? null;
  return auto ? { datasetId: auto, auto: true } : null;
}

/** Make the tool's shared selection a frozen capture of `datasetId`. */
function freezeSelection(id: string, datasetId: string): void {
  const sel = useAnalysisSelection.getState();
  const owned = sel.toolId === id && sel.selection?.items[0]?.datasetId === datasetId ? sel.selection : null;
  if (owned) {
    if (owned.source !== "plot") sel.setSelection(id, { ...owned, source: "plot" });
    return;
  }
  const s = useApp.getState();
  if (s.activeId === datasetId) {
    seedAnalysisSelection(id, "plot");
    return;
  }
  // Not the active worksheet (a pin restored with the project): its own roles, no live plot picks.
  const capture = { datasets: s.datasets, activeId: datasetId, selectedIds: [datasetId], xKey: null, yKeys: null, seriesOrder: null, errKeys: {}, selection: null, range: null };
  sel.setSelection(id, captureAnalysisSelection(capture, "plot"));
}

/** Let the tool's selection follow the plot again (only when it still owns it). */
function thawSelection(id: string): void {
  const sel = useAnalysisSelection.getState();
  if (sel.toolId === id && sel.selection?.source === "plot") seedAnalysisSelection(id, "tool-default");
}

/** The pin button: pin the tool to the dataset it reads now. Returns the
 *  sentence to announce (a refusal says why). */
export function pinTool(id: string): string {
  const title = titleOf(id);
  const refused = pinRefusal(id, title);
  if (refused) return refused;
  const datasetId = toolDataset(id);
  if (!datasetId) return `${title} has no dataset to pin; focus a plot first.`;
  freezeSelection(id, datasetId);
  applyLayout((l) => setPin(l, toolRef(id), datasetId));
  patchLayoutTool(id, { autoPin: null });
  return `${title} pinned to ${nameOf(datasetId)}`;
}

/** Unpin: the tool follows the focused plot again (unless a run still holds it). */
export function unpinTool(id: string): string {
  const title = titleOf(id);
  const was = pinOf(useApp.getState().windowLayout, toolRef(id));
  applyLayout((l) => clearPin(l, toolRef(id)));
  const entry = layoutTool(id);
  if (entry?.busy) {
    // The run keeps its input: the pin becomes the run's own, released when it ends.
    patchLayoutTool(id, { autoPin: was ?? entry.autoPin });
    return `${title} stays pinned until its run ends`;
  }
  patchLayoutTool(id, { autoPin: null });
  thawSelection(id);
  return `${title} follows the focused plot`;
}

/** A tool reported a run starting or ending (its `busy` prop); the sentence to
 *  announce, or null when nothing changed. */
export function toolBusyChanged(id: string, busy: boolean): string | null {
  const entry = layoutTool(id);
  if (!entry || entry.busy === busy) return null;
  patchLayoutTool(id, { busy });
  if (!PINNABLE_TOOLS.has(id) || pinOf(useApp.getState().windowLayout, toolRef(id))) return null;
  if (busy) {
    const datasetId = toolDataset(id);
    if (!datasetId) return null;
    freezeSelection(id, datasetId);
    patchLayoutTool(id, { autoPin: datasetId });
    const msg = `${entry.title} is pinned to ${nameOf(datasetId)} while it runs.`;
    useApp.getState().setStatus(msg);
    return msg;
  }
  if (!entry.autoPin) return null;
  patchLayoutTool(id, { autoPin: null });
  thawSelection(id);
  return `${entry.title} finished and follows the focused plot again`;
}

/** A tool mounted with a saved pin: put its frozen selection back. */
export function restoreToolPin(id: string): void {
  const pinned = pinOf(useApp.getState().windowLayout, toolRef(id));
  if (pinned && PINNABLE_TOOLS.has(id)) freezeSelection(id, pinned);
}

/** Watch the shared selection: a pinned tool that no longer owns it loses its
 *  pin, with the reason (status line, and `onLost` for the live region).
 *  Returns the unsubscribe. */
export function watchToolPins(onLost: (sentence: string) => void): () => void {
  return useAnalysisSelection.subscribe((sel) => {
    for (const [id, entry] of mountedTools()) {
      const pin = toolPin(id);
      if (!pin) continue;
      const held = sel.toolId === id && sel.selection !== null && sel.selection.source !== "tool-default" && sel.selection.items[0]?.datasetId === pin.datasetId;
      if (held) continue;
      applyLayout((l) => clearPin(l, toolRef(id)));
      patchLayoutTool(id, { autoPin: null });
      const msg = `${entry.title} is no longer pinned: another tool took the shared input selection, so it follows the focused plot.`;
      useApp.getState().setStatus(msg, "warn");
      onLost(msg);
    }
  });
}

/** The Analysis window's pin. */
export const pinAnalysis = (datasetId: string) => applyLayout((l) => setPin(l, "analysis", datasetId));
export const unpinAnalysis = () => applyLayout((l) => clearPin(l, "analysis"));
