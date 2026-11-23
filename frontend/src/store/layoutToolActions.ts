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
import { close, float, placementEntries, pruneRefs, reopen } from "../lib/windowLayout/ops";
import { clearPin, pinOf, setPin } from "../lib/windowLayout/pins";
import { toolRef } from "../lib/windowLayout/refs";
import { SMALL_SCREEN_PX } from "../lib/windowLayout/seed";
import { loadLayoutTemplate, toolFirstPlacement } from "../lib/windowLayout/template";
import type { WindowLayoutV1 } from "../lib/windowLayout/types";
import { isLayoutTool, PINNABLE_TOOLS, pinRefusal } from "../lib/windowLayout/toolCatalog";
import { seedAnalysisSelection, useAnalysisSelection } from "./analysisSelection";
import { layoutTool, mountedTools, patchLayoutTool } from "./layoutTools";
import { useApp } from "./useApp";
import { applyLayout, reopenRef } from "./windowLayoutActions";

const nameOf = (id: string): string => useApp.getState().datasets.find((d) => d.id === id)?.name ?? "the dataset";
const titleOf = (id: string): string => layoutTool(id)?.title ?? id;

/** A tool mounted: open its window where it was, or, the first time this project's layout has it,
 *  where the user's template keeps tools (plan P6), else at its default, the bottom. FLOATING on a
 *  screen under SMALL_SCREEN_PX (owner decision D6: windows stay floating there, and a bottom dock would
 *  sit under the floating plot, out of sight; UX pass 3, B2). Floating comes to the front. */
export function openToolPlacement(id: string): void {
  const ref = toolRef(id);
  // None of this is a user layout edit: the template is where tools GO, it does not learn from opening one.
  if (!useApp.getState().windowLayout?.placements[ref] && isSmallScreen()) applyLayout((l) => float(l, ref), false);
  else {
    applyLayout((l) => toolFirstPlacement(l, id, loadLayoutTemplate()), false);
    reopenRef(ref, false);
  }
}

const isSmallScreen = (): boolean => typeof window !== "undefined" && window.innerWidth < SMALL_SCREEN_PX;

/** A tool's window the first time the layout has it (op form of the above, for a layout re-seed). */
export function firstToolOpen(layout: WindowLayoutV1, id: string): WindowLayoutV1 {
  if (isSmallScreen()) return float(layout, toolRef(id));
  return reopen(toolFirstPlacement(layout, id, loadLayoutTemplate()), toolRef(id));
}
/** A tool unmounted (its workshop closed): close its window, keeping the placement. */
export const closeToolPlacement = (id: string): void => applyLayout((l) => close(l, toolRef(id)), false);

/** A saved layout keeps a `tool:` window it cannot place (a newer release's tool, P0's rule); this
 *  release drops the ones it does not have, and the status line names them. Returns the sentence. */
export function dropUnknownTools(): string | null {
  const layout = useApp.getState().windowLayout;
  if (!layout) return null;
  const gone = placementEntries(layout).map(([r]) => r).filter((r) => r.startsWith("tool:") && !isLayoutTool(r.slice(5)));
  if (!gone.length) return null;
  applyLayout((l) => pruneRefs(l, (r) => !gone.includes(r)), false);
  const msg = `Window layout: ${gone.length} tool window${gone.length === 1 ? "" : "s"} not restored (${gone.map((r) => r.slice(5)).join(", ")}: not a tool this version has).`;
  useApp.getState().setStatus(msg, "warn");
  return msg;
}

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

/** Make the tool's shared selection a frozen capture of `datasetId`: its own
 *  item when the tool already reads it, else an explicit capture of that one
 *  dataset (the live plot picks only when it is the active worksheet). Never a
 *  capture of the Library selection, whose first item may be another dataset. */
function freezeSelection(id: string, datasetId: string): void {
  const sel = useAnalysisSelection.getState();
  const owned = sel.toolId === id && sel.selection?.items[0]?.datasetId === datasetId ? sel.selection : null;
  if (owned) {
    if (owned.source !== "plot") sel.setSelection(id, { ...owned, source: "plot" });
    return;
  }
  const s = useApp.getState();
  const live = s.activeId === datasetId;
  const capture = {
    datasets: s.datasets,
    activeId: datasetId,
    selectedIds: [datasetId],
    xKey: live ? s.xKey : null,
    yKeys: live ? s.yKeys : null,
    seriesOrder: live ? s.seriesOrder : null,
    errKeys: live ? s.errKeys : {},
    selection: live && s.selection?.datasetId === datasetId ? s.selection : null,
    range: null,
  };
  sel.setSelection(id, captureAnalysisSelection(capture, "plot"));
}

/** Let the tool's selection follow the plot again (only when it still owns it). */
function thawSelection(id: string): void {
  const sel = useAnalysisSelection.getState();
  if (sel.toolId === id && sel.selection?.source === "plot") seedAnalysisSelection(id, "tool-default", true);
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

/** A tool reported a run starting or ending (its `busy` prop, already in the
 *  registry); the sentence to announce, or null when nothing changed. */
export function toolBusyChanged(id: string, busy: boolean): string | null {
  const entry = layoutTool(id);
  if (!entry || !PINNABLE_TOOLS.has(id) || pinOf(useApp.getState().windowLayout, toolRef(id))) return null;
  if (busy) {
    if (entry.autoPin) return null;
    const datasetId = toolDataset(id);
    if (!datasetId) return null;
    freezeSelection(id, datasetId);
    patchLayoutTool(id, { autoPin: datasetId });
    const msg = `${entry.title} is pinned to ${nameOf(datasetId)} while it runs.`;
    useApp.getState().setStatus(msg);
    return msg;
  }
  if (!entry.autoPin) return null;
  // The run is over: take its "pinned ... while it runs" line off the status bar (UX pass 4 m-10), unless
  // something else has been said since.
  const lastSaid = `${entry.title} is pinned to ${nameOf(entry.autoPin)} while it runs.`;
  if (useApp.getState().status === lastSaid) useApp.getState().setStatus("");
  patchLayoutTool(id, { autoPin: null });
  thawSelection(id);
  return `${entry.title} finished and follows the focused plot again`;
}

/** A tool mounted with a saved pin: put its frozen selection back. From now on
 *  the pin check watches it (before, the tool's own first seed is not a lost pin). */
export function restoreToolPin(id: string): void {
  const pinned = pinOf(useApp.getState().windowLayout, toolRef(id));
  if (pinned && PINNABLE_TOOLS.has(id)) freezeSelection(id, pinned);
  patchLayoutTool(id, { pinRestored: true });
}

/** Watch the shared selection: a pinned tool whose input another tool takes, or
 *  that re-seeds itself live, loses its pin, with the reason (status line, and
 *  `onLost` for the live region). A cleared selection is not a loss (a tool
 *  clears its own on close, and its pin is kept for next time), nor is anything
 *  before the host has restored the tool's saved pin. Returns the unsubscribe. */
export function watchToolPins(onLost: (sentence: string) => void): () => void {
  return useAnalysisSelection.subscribe((sel) => {
    if (sel.toolId === null || sel.selection === null) return;
    for (const [id, entry] of mountedTools()) {
      const pin = toolPin(id);
      if (!pin || !entry.pinRestored) continue;
      const held = sel.toolId === id && sel.selection.source !== "tool-default" && sel.selection.items[0]?.datasetId === pin.datasetId;
      if (held) continue;
      applyLayout((l) => clearPin(l, toolRef(id)));
      patchLayoutTool(id, { autoPin: null });
      const msg = `${entry.title} is no longer pinned: another tool took the shared input selection, so it follows the focused plot.`;
      useApp.getState().setStatus(msg, "warn");
      onLost(msg);
    }
  });
}

