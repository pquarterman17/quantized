// The Layer properties dialog's draft (origin gap audit 3 #15): a graph
// layer as the text the user edits — its position in percent of the plot
// frame, an inset's axes (blank = automatic) and curves, a table's cells —
// and back. Pure; the dialog applies `layerFromDraft` as ONE undo step and
// holds Apply back while `draftErrors` has anything to say.

import {
  clampLayerAt,
  parseTableText,
  tableText,
  type GraphLayer,
  type LayerAxis,
  type LayerMark,
  type LayerScale,
} from "./graphLayers";
import type { LinkedCurve } from "./types";

export interface AxisDraft {
  from: string;
  to: string;
  scale: LayerScale;
  label: string;
  step: string;
}

export interface LayerDraft {
  /** Left, top, width, height in % of the plot frame. */
  at: [string, string, string, string];
  x: AxisDraft;
  y: AxisDraft;
  mark: LayerMark;
  curves: LinkedCurve[];
  cells: string;
  header: boolean;
  name: string;
}

const pct = (f: number) => String(Number((f * 100).toFixed(2)));
const num = (s: string) => (s.trim() === "" ? null : Number(s));

function axisDraft(a: LayerAxis | undefined): AxisDraft {
  return {
    from: a?.lim ? String(a.lim[0]) : "",
    to: a?.lim ? String(a.lim[1]) : "",
    scale: a?.scale ?? "linear",
    label: a?.label ?? "",
    step: a?.step != null ? String(a.step) : "",
  };
}

export function draftOf(l: GraphLayer): LayerDraft {
  return {
    at: [pct(l.at[0]), pct(l.at[1]), pct(l.at[2]), pct(l.at[3])],
    x: axisDraft(l.kind === "inset" ? l.x : undefined),
    y: axisDraft(l.kind === "inset" ? l.y : undefined),
    mark: l.kind === "inset" ? l.mark : "line",
    curves: l.kind === "inset" ? l.curves.map((c) => ({ ...c })) : [],
    cells: l.kind === "table" ? tableText(l.rows) : "",
    header: l.kind === "table" ? l.header : true,
    name: l.kind === "image" ? l.name : "",
  };
}

function axisErrors(name: string, a: AxisDraft): string[] {
  const out: string[] = [];
  const [from, to, step] = [num(a.from), num(a.to), num(a.step)];
  if ((from === null) !== (to === null)) out.push(`${name}: give both From and To, or neither (automatic).`);
  else if (from !== null && to !== null) {
    if (!Number.isFinite(from) || !Number.isFinite(to) || !(from < to)) out.push(`${name}: From must be a number below To.`);
    else if (a.scale === "log" && from <= 0) out.push(`${name}: a log axis needs a positive From.`);
  }
  if (step !== null && !(Number.isFinite(step) && step > 0)) out.push(`${name}: the tick step must be a positive number.`);
  return out;
}

/** Why the draft cannot apply yet (empty = it can). */
export function draftErrors(d: LayerDraft, kind: GraphLayer["kind"]): string[] {
  const out: string[] = [];
  const at = d.at.map(Number);
  if (!at.every(Number.isFinite)) out.push("Position: every field must be a number (percent of the plot).");
  else if (!(at[2] > 0 && at[3] > 0)) out.push("Position: width and height must be above 0%.");
  if (kind === "inset") out.push(...axisErrors("X axis", d.x), ...axisErrors("Y axis", d.y));
  if (kind === "table" && !d.cells.trim()) out.push("Table: type at least one cell.");
  return out;
}

function axisOf(a: AxisDraft): LayerAxis {
  const [from, to, step] = [num(a.from), num(a.to), num(a.step)];
  return { lim: from !== null && to !== null ? [from, to] : null, scale: a.scale, label: a.label.trim(), step };
}

/** `l` with the draft applied (call only when `draftErrors` is empty). */
export function layerFromDraft(l: GraphLayer, d: LayerDraft): GraphLayer {
  const at = clampLayerAt(d.at.map((s) => Number(s) / 100), l.at);
  if (l.kind === "inset") return { ...l, at, x: axisOf(d.x), y: axisOf(d.y), mark: d.mark, curves: d.curves.map((c) => ({ ...c })) };
  if (l.kind === "table") return { ...l, at, rows: parseTableText(d.cells), header: d.header };
  return { ...l, at, name: d.name.trim() || l.name };
}
