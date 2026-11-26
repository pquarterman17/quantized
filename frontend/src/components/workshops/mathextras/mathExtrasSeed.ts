// "Open in Math extras": the recorded settings of an output made by one of the
// four worksheet-making jobs, read back strictly. Pure. `formSettings` is what
// a commit records (only the fields its mode reads); `mathSeed` is its inverse.
// A record that does not read back completely is null: the panel then opens
// with plain defaults and says so, never a guessed mixture.

import { seedChoice } from "../resultcommit/useReopenSession";
import { emptyForm, type MathForm, type MathMode } from "./mathExtrasForm";

/** The jobs that make a worksheet, so the only ones whose result can reopen. */
export const OUTPUT_MODES: readonly MathMode[] = ["trace", "bspline", "scatter", "correlate"];

const FIELDS: Readonly<Record<string, readonly (keyof MathForm)[]>> = {
  trace: ["sizing", "n", "spacing", "kind", "periodic"],
  bspline: ["sizing", "n", "spacing", "degree", "smoothing"],
  scatter: ["dims", "method", "nearestFill", "queries", "queriesFrom"],
  correlate: ["blanksOk"],
};

/** The form fields `mode` reads, for the commit record. */
export function formSettings(mode: MathMode, form: MathForm): Partial<MathForm> {
  const out: Record<string, unknown> = {};
  for (const key of FIELDS[mode] ?? []) out[key] = form[key];
  return out as Partial<MathForm>;
}

export interface MathSeed {
  mode: MathMode;
  form: MathForm;
  picks: number[];
  /** The labels of the picked columns when the result was made (the check that they are still where they were). */
  pickLabels: string[];
  /** Scatter with query points from a worksheet: that worksheet's id, picks and labels. */
  query: { id: string; picks: number[]; labels: string[] } | null;
}

const isNumbers = (v: unknown): v is number[] => Array.isArray(v) && v.every((x) => typeof x === "number" && Number.isInteger(x));
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

export function mathSeed(settings: Readonly<Record<string, unknown>> | null | undefined): MathSeed | null {
  if (!settings) return null;
  const mode = seedChoice<MathMode | "">(settings["mode"], OUTPUT_MODES, "");
  const raw = settings["form"];
  if (mode === "" || !raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const form = emptyForm();
  const want = FIELDS[mode] ?? [];
  for (const key of want) {
    const v = rec[key];
    if (v === undefined || typeof v !== typeof form[key]) return null; // a field the mode needs is missing or the wrong kind
    (form as unknown as Record<string, unknown>)[key] = v;
  }
  form.sizing = seedChoice(form.sizing, ["n", "spacing"], "n");
  form.kind = seedChoice(form.kind, ["linear", "pchip", "cubic"], "linear");
  form.dims = seedChoice(form.dims, ["2", "3"], "2");
  form.method = seedChoice(form.method, ["linear", "nearest", "rbf"], "linear");
  form.queriesFrom = seedChoice(form.queriesFrom, ["typed", "sheet"], "typed");
  const picks = settings["picks"];
  const labels = settings["pickLabels"];
  if (!isNumbers(picks) || !isStrings(labels) || picks.length !== labels.length) return null;
  let query: MathSeed["query"] = null;
  if (mode === "scatter" && form.queriesFrom === "sheet") {
    const q = settings["queryFrom"];
    const r = q && typeof q === "object" && !Array.isArray(q) ? (q as Record<string, unknown>) : null;
    if (!r || typeof r["id"] !== "string" || !isNumbers(r["picks"]) || !isStrings(r["labels"]) || r["picks"].length !== r["labels"].length) return null;
    query = { id: r["id"], picks: r["picks"], labels: r["labels"] };
  }
  return { mode, form, picks, pickLabels: labels, query };
}
