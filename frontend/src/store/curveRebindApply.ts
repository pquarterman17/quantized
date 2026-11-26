// The writes behind the plot right-click "Change Y / Change X / Change
// Worksheet" and "Hide others / Show all" entries (Origin gap plan item 38).
//
// ONE BINDING PATH. A re-bind is a Layer Contents draft with one row changed,
// handed to `applyLayerContents` (store/layerContentsApply.ts), the same
// function the Layer Contents dialog's Apply calls. It validates the draft,
// records ONE undo step, keeps the curve's style (the column keeps its index),
// and, on a plain dataset's graph, turns the graph into a live one exactly as
// the dialog does. Nothing here writes a curve binding itself.
//
// Fail closed: every call names the binding the menu showed (`expected`); if
// the curve is no longer that, nothing is changed and the user is told.
//
// Loaded on demand from the plot context menu (components/Stage/curveRebindMenu.ts).

import { layerRowsOf, newCurve, sameBinding } from "../lib/layerContents";
import { curveBindingAt, legendIsTyped, resolveOnSheet, rebindBlocker, worksheetCandidates, type CurveBindingRef } from "../lib/curveRebind";
import { applyLayerContents, layerCurvesOf } from "./layerContentsApply";
import { toast } from "./toasts";
import { useApp } from "./useApp";

const refuse = (msg: string): false => (toast(msg, "danger"), false);

/** Re-point the curve drawn at display channel `channel`, which the menu saw
 *  bound to `expected`, at `to`. True when the graph changed. */
export function rebindCurve(channel: number, expected: CurveBindingRef, to: CurveBindingRef): boolean {
  const s = useApp.getState();
  const target = s.datasets.find((d) => d.id === s.activeId);
  if (!target) return false;
  const blocked = rebindBlocker(s);
  if (blocked) return refuse(`can't change the curve: ${blocked}`);
  const now = curveBindingAt(s, channel);
  if (!now || !sameBinding({ ...now, label: "" }, { ...expected, label: "" })) {
    return refuse("that curve changed while the menu was open: right-click it again");
  }
  const source = s.datasets.find((d) => d.id === to.datasetId);
  if (!source) return refuse("that sheet is gone");
  const old = layerCurvesOf(s, target.id);
  const live = !!target.linkedCurves;
  const index = live ? channel : old.findIndex((c) => c.yKey === channel);
  const curve = old[index];
  if (!curve) return refuse("that curve is not in the graph's layer");
  if (sameBinding({ ...to, label: "" }, curve)) return false;
  // A legend the user typed stays; one derived from the source follows it.
  const typed = legendIsTyped(s, channel, curve.labelFrom, live);
  const next = typed ? { ...curve, ...to } : newCurve(source, to.xKey, to.yKey);
  const rows = layerRowsOf(old).map((r, i) => (i === index ? { ...r, curve: next } : r));
  const savedLabel = s.seriesLabels[channel];
  const ok = applyLayerContents(target.id, rows);
  // The apply forgets a re-bound column's typed legend (its OLD data's text);
  // here the user typed it for this curve, so it stays.
  if (ok && live && savedLabel !== undefined) {
    useApp.setState((st) => ({ seriesLabels: { ...st.seriesLabels, [channel]: savedLabel } }));
  }
  return ok;
}

/** Change Worksheet: the curve's columns, found by name on sheet `sheetId`. */
export function changeCurveWorksheet(channel: number, expected: CurveBindingRef, sheetId: string): boolean {
  const s = useApp.getState();
  const cand = worksheetCandidates(s, expected).find((c) => c.sheet.id === sheetId);
  const from = s.datasets.find((d) => d.id === expected.datasetId);
  if (!cand || !from) return refuse("that sheet cannot take this curve");
  const res = resolveOnSheet(from, expected, cand.sheet);
  if ("ambiguous" in res) return refuse(`can't move the curve: ${res.ambiguous}`);
  if ("none" in res) return refuse(`can't move the curve: “${cand.sheet.name}” lacks its columns`);
  return rebindCurve(channel, expected, res.binding);
}

/** `hidden` with every plotted curve but `keep` hidden; channels that are not
 *  plotted (an error column hidden by its role) stay as they were. */
export function hiddenAfterHideOthers(hidden: readonly number[], plotted: readonly number[], keep: number): number[] {
  return [...hidden.filter((c) => !plotted.includes(c)), ...plotted.filter((c) => c !== keep)];
}

/** `hidden` with every plotted curve shown again. */
export const hiddenAfterShowAll = (hidden: readonly number[], plotted: readonly number[]): number[] =>
  hidden.filter((c) => !plotted.includes(c));

const sorted = (v: readonly number[]): number[] => [...v].sort((x, y) => x - y);
const hiddenAmong = (hidden: readonly number[], plotted: readonly number[]): number[] => sorted(hidden.filter((c) => plotted.includes(c)));

/** What the last "Hide others" changed, so "Show all" can undo exactly it:
 *  the plotted curves hidden BEFORE it, and the hidden set it left behind. Held
 *  for the session only, and used only while the layer is still as it left it. */
let hideMemory: { datasetId: string | null; before: number[]; after: number[] } | null = null;

/** Apply `next` to the hidden channels as one undo step; false when nothing changes. */
function setHidden(label: string, next: (hidden: number[]) => number[]): boolean {
  const s = useApp.getState();
  const hiddenChannels = next(s.hiddenChannels);
  if (hiddenChannels.length === s.hiddenChannels.length && hiddenChannels.every((c) => s.hiddenChannels.includes(c))) return false;
  s.recordHistory(label);
  useApp.setState({ hiddenChannels });
  return true;
}

/** Hide every other curve of the layer (the per-series visibility the legend
 *  and Inspector use), one undo step. Remembers which curves were already
 *  hidden, for "Show all". */
export function hideOtherCurves(channel: number, plotted: readonly number[]): void {
  const s = useApp.getState();
  const before = hiddenAmong(s.hiddenChannels, plotted);
  if (!setHidden("hide other curves", (h) => hiddenAfterHideOthers(h, plotted, channel))) return;
  hideMemory = { datasetId: s.activeId, before, after: hiddenAmong(useApp.getState().hiddenChannels, plotted) };
}

/** Show the layer's hidden curves again, one undo step. Straight after "Hide
 *  others" (nothing re-toggled since), that restores the curves that were
 *  already hidden before it; in any other state it shows every curve. */
export function showAllCurves(plotted: readonly number[]): void {
  const s = useApp.getState();
  const m = hideMemory;
  const now = hiddenAmong(s.hiddenChannels, plotted);
  const restore = m && m.datasetId === s.activeId && m.before.length > 0 && m.after.length === now.length && m.after.every((c, i) => c === now[i]) ? m : null;
  hideMemory = null;
  const changed = setHidden("show all curves", (h) => (restore ? [...h.filter((c) => !plotted.includes(c)), ...restore.before] : hiddenAfterShowAll(h, plotted)));
  if (changed && restore) {
    s.setStatus(`restored the ${restore.before.length} curve${restore.before.length === 1 ? "" : "s"} hidden before Hide others — Show all again shows every curve`);
  }
}
