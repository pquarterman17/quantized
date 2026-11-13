// The bodies of Plot > "Facet by column…" and "Break x-axis at gaps…", moved
// out of commands/plotCommands.ts so they load on demand (both only run
// after an explicit menu/palette pick, and both open a parameter dialog
// first). Moved verbatim; paid for the figures-audit window fixes' eager
// growth (2026-11-13) instead of raising the bundle budget.

import { askParams } from "../components/overlays/ParamDialog";
import { toast } from "../store/toasts";
import type { StoreGet } from "../lib/exportActive";

/** Facet the active dataset by a column the user picks. */
export async function runFacetByColumn(s: StoreGet): Promise<void> {
  const ds = s().datasets.find((d) => d.id === s().activeId);
  if (!ds) {
    toast("no active dataset", "danger");
    return;
  }
  if (ds.data.labels.length === 0) {
    toast("active dataset has no columns to facet by", "danger");
    return;
  }
  // Disambiguate duplicate labels (real instrument imports can repeat
  // a column name) so the reverse `indexOf` lookup below always maps
  // the picked option back to the SAME channel the user saw.
  const raw = ds.data.labels.map((lab, i) => lab || `Column ${i + 1}`);
  const counts = new Map<string, number>();
  for (const lab of raw) counts.set(lab, (counts.get(lab) ?? 0) + 1);
  const options = raw.map((lab, i) => (counts.get(lab)! > 1 ? `${lab} (col ${i + 1})` : lab));
  const params = await askParams("Facet by column", [
    {
      key: "column",
      label: "Column",
      type: "select",
      default: options[0],
      options,
      hint: "One small-multiples panel per distinct level, sharing the x-axis",
    },
  ]);
  if (!params) return;
  const col = options.indexOf(String(params.column));
  if (col < 0) return;
  s().facetByColumn(ds.id, col);
}

/** Break the active dataset's x-axis at gaps wider than a picked factor. */
export async function runBreakXAxis(s: StoreGet): Promise<void> {
  const ds = s().datasets.find((d) => d.id === s().activeId);
  if (!ds) {
    toast("no active dataset", "danger");
    return;
  }
  const params = await askParams("Break x-axis at gaps", [
    {
      key: "gapFactor",
      label: "Gap factor",
      type: "number",
      default: 4,
      hint: "A gap at least this many times the median x-spacing becomes a break",
    },
  ]);
  if (!params) return;
  s().breakAtGaps(ds.id, undefined, Number(params.gapFactor));
}
