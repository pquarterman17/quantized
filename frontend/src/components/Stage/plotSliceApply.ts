// The writes behind the plot's data-slicer menu entries (lib/plotSlice.ts), loaded
// on demand from the right-click menu. Both reuse existing paths: the Data Filter
// (`applyViewFilter` -> `setDatasetFilter`) and the worksheet's Extract rows
// (`planExtract` + `commitExtract`, one undo step, linked to its source).

import { effectiveChannels } from "../../lib/plotdata";
import { liveSelectedRows, type SlicePlan } from "../../lib/plotSlice";
import { dropChannels, subsetSeries, type SubsetDestination } from "../../lib/subsetColumns";
import type { Dataset } from "../../lib/types";
import { excludedSet, filteredOutSet } from "../../lib/rowstate";
import { applyViewFilter } from "../../store/graphBrowserActions";
import { useApp } from "../../store/useApp";
import { nextWorkbookId } from "../../store/workbookIds";
import { toast } from "../../store/toasts";
import { openWorksheet } from "../../store/worksheetOpen";
import type { AppState } from "../../store/useApp";
import { askSubsetChoices } from "./subsetRegionDialog";
import { describeExtract, planExtract } from "./worksheet/extractRows";
import { commitExtract } from "./worksheet/extractRowsCommit";

/** The live store snapshot, passed in by the menu (a component file must not reach for the store itself). */
type Get = () => AppState;

/** Keep only the rows inside the box: the plan's range predicates become the sheets' Data Filters. */
export function applyBoxFilter({ plan, skippedY }: SlicePlan, get: Get): boolean {
  if (!applyViewFilter(plan)) return false;
  if (skippedY && plan.ok) get().setStatus(`${plan.summary}; X window only: ${skippedY}`);
  return true;
}

/** "Create subset from region": the selected points' rows to a new worksheet linked back to its source rows (the
 *  worksheet's Extract, over the plot's selection). It first asks which plotted series go into the subset (each with
 *  its row count in the region) and which workbook it lands in (the source's by default). Added beside the source
 *  WITHOUT activating it, so the graph keeps focus; the toast's Open goes to it, and Go to Source (its worksheet menu)
 *  comes back to exactly these rows. A series left unticked is left out of the subset's columns; a sheet whose per-column
 *  metadata cannot be renumbered refuses that (the status says why) and makes no subset. */
export async function createSubsetFromRegion(get: Get): Promise<void> {
  const s = get();
  const ds = s.datasets.find((d) => d.id === s.activeId);
  if (!ds || s.selection?.datasetId !== ds.id) return void toast("select points with the Select rows tool first", "danger");
  if (ds.pending) return void toast(`“${ds.name}” is still loading: extract again in a moment`, "danger");
  const rows = liveSelectedRows(s.selection.rows, excludedSet(ds), filteredOutSet(ds));
  const plan = planExtract(ds.data, rows);
  if (!plan) return s.setStatus(describeExtract(plan, ds.data.time.length));
  const plotted = effectiveChannels(ds.data, s.yKeys, s.xKey, ds.channelRoles, s.seriesOrder).filter((c) => !s.hiddenChannels.includes(c));
  const sourceBook = ds.workbookId ? s.workbooks.find((w) => w.id === ds.workbookId)?.name ?? null : null;
  const choices = await askSubsetChoices(subsetSeries(ds.data, plotted, plan.rows), s.workbooks.filter((w) => w.id !== ds.workbookId), sourceBook, plan.extracted);
  if (!choices) return;
  if (plotted.length > 0 && choices.keep.length === 0) return s.setStatus("subset not created: tick at least one series", "danger");
  const dropped = dropChannels(plan.data, new Set(plotted.filter((c) => !choices.keep.includes(c))));
  if ("refusal" in dropped) return s.setStatus(`subset not created: ${dropped.refusal}`, "danger");
  const where = landing(get, ds, choices.destination);
  let added: string | null = null;
  const stopped = commitExtract(ds, { ...plan, data: dropped.data }, (id) => get().datasets.find((d) => d.id === id)?.name, { quiet: true, onAdded: (id) => { added = id; where.made?.(); }, patch: where.patch });
  if (stopped) return s.setStatus(stopped.status, stopped.tone);
  s.setStatus(describeExtract(plan, ds.data.time.length));
  if (added) toast("subset created beside its source", "ok", { action: { label: "Open", onClick: () => openWorksheet({ datasetId: added! }) } });
}

/** The workbook (and folder) the new subset joins: the source's, another existing one, or a new one made right after the subset is
 *  added, so the subset's one undo step takes it away too (its history snapshot predates both). */
function landing(get: Get, source: Dataset, destination: SubsetDestination): { patch?: Partial<Dataset>; made?: () => void } {
  if (destination.kind === "workbook") {
    const book = get().workbooks.find((w) => w.id === destination.id);
    return book ? { patch: { workbookId: book.id, ...(book.folderId ? { folderId: book.folderId } : {}) } } : {};
  }
  if (destination.kind === "new") {
    const id = nextWorkbookId();
    const name = `${source.name.replace(/\.[^.]+$/, "")} (subset)`;
    return {
      patch: { workbookId: id, ...(source.folderId ? { folderId: source.folderId } : {}) },
      made: () => useApp.setState((st) => ({ workbooks: [...st.workbooks, { id, name, ...(source.folderId ? { folderId: source.folderId } : {}) }] })),
    };
  }
  return source.workbookId ? { patch: { workbookId: source.workbookId, ...(source.folderId ? { folderId: source.folderId } : {}) } } : {};
}
