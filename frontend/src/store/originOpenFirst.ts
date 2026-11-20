// What an Origin project import does with its graphs (split from
// importDatasets.ts, which sits at the module ceiling): register the Library's
// figure entries and the fidelity manifest, then do what Origin itself does on
// opening a project -- show its FIRST graph, not the first worksheet raw.
//
// "First" is the first RESOLVED figure in project order: the backend sends
// figures in the file's window order and carries no active-window hint (the
// payload's per-figure fields are geometry/axes/curves only), so there is
// nothing better to key on. The apply is the user's own gesture
// (`applyOriginFigure`: one undo step, one macro entry, lazy source loading);
// a figure that does not resolve to a dataset is skipped, never guessed.
import { figureLabel, type OriginFigureEntry } from "../lib/originFigures";
import { buildOriginFigureEntries } from "../lib/originFigureEntries";
import { originImportNotice } from "../lib/originImportNotice";
import { plural } from "../lib/plural";
import type { Dataset, OriginFidelityManifest, OriginFigure } from "../lib/types";
import { toast } from "./toasts";
import type { AppState } from "./useApp";

/** Per-batch state: only the first Origin project of a batch opens its graph. */
export interface OpenFirstGraph {
  opened: boolean;
}

/** The first figure that resolved to a dataset, and its place among the
 *  project's graph windows (layers of one window count once). */
export function firstOpenableFigure(entries: OriginFigureEntry[]): { entry: OriginFigureEntry; nth: number; total: number } | null {
  const entry = entries.find((e) => e.datasetId != null);
  if (!entry) return null;
  const windows = [...new Set(entries.map((e) => e.figure.name || e.id))];
  return { entry, nth: windows.indexOf(entry.figure.name || entry.id) + 1, total: windows.length };
}

export function attachOriginGraphs(
  get: () => AppState,
  stem: string,
  figures: OriginFigure[] | undefined,
  fidelity: OriginFidelityManifest | undefined,
  newIds: string[],
  openFirst: OpenFirstGraph | undefined,
): void {
  const siblings: Dataset[] = get().datasets.filter((d) => newIds.includes(d.id));
  const entries = figures?.length ? buildOriginFigureEntries(stem, figures, siblings) : [];
  if (entries.length) get().addOriginFigures(entries);
  let lead = "";
  const first = openFirst && !openFirst.opened ? firstOpenableFigure(entries) : null;
  if (openFirst && first) {
    openFirst.opened = true;
    get().applyOriginFigure(first.entry.id);
    lead = `Opened ${first.entry.figure.name || figureLabel(first.entry)} (${first.nth} of ${first.total} Origin graph${plural(first.total)}) — Library ▸ Origin figures to browse`;
  }
  if (fidelity) {
    get().addOriginFidelity(stem, fidelity, newIds);
    const note = originImportNotice(stem, fidelity, () => {
      if (!get().originFidelitySectionExpanded) get().toggleOriginFidelitySectionExpanded();
    }); // truncated file / lost worksheet data -> danger with "Show what is missing"
    if (!lead) toast(note.msg, note.kind, note.opts);
    else if (note.kind === "danger") toast(`${lead} · ${note.msg}`, note.kind, note.opts);
    else toast(lead, "info");
  } else if (lead) toast(lead, "info");
}
