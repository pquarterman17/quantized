// The question-and-commit half shared by every "subset of these rows" gesture that asks (ROW_RANGE_CONTRACT section 4):
// the plot's "Create subset from region" and the worksheet's "Extract rows...". It asks which series go into the subset
// (each with its row count) and where it lands, drops the unticked columns (refused, never guessed, when the sheet
// carries per-column metadata a drop cannot renumber), and commits through `commitExtract`. Ticking every series and
// keeping the source's workbook is the subset the one-click Extract makes.

import { dropChannels, subsetSeries, type SubsetDestination } from "../../lib/subsetColumns";
import type { Dataset } from "../../lib/types";
import type { AppState } from "../../store/useApp";
import { useApp } from "../../store/useApp";
import { nextWorkbookId } from "../../store/workbookIds";
import { toast } from "../../store/toasts";
import { openWorksheet } from "../../store/worksheetOpen";
import { askSubsetChoices } from "./subsetRegionDialog";
import { describeExtract, type ExtractPlan } from "./worksheet/extractRows";
import { commitExtract } from "./worksheet/extractRowsCommit";

type Get = () => AppState;

/** Ask which of `channels` go into the subset of `plan`'s rows and where it lands, then add it. `quiet`: beside the
 *  source without activating it (the plot keeps focus; a toast offers Open); else the worksheet's own behaviour. */
export async function subsetWithChoices(get: Get, ds: Dataset, plan: ExtractPlan, channels: readonly number[], quiet: boolean): Promise<void> {
  const s = get();
  const sourceBook = ds.workbookId ? s.workbooks.find((w) => w.id === ds.workbookId)?.name ?? null : null;
  const choices = await askSubsetChoices(subsetSeries(ds.data, channels, plan.rows), s.workbooks.filter((w) => w.id !== ds.workbookId), sourceBook, plan.extracted);
  if (!choices) return;
  if (channels.length > 0 && choices.keep.length === 0) return s.setStatus("subset not created: tick at least one series", "danger");
  const dropped = dropChannels(plan.data, new Set(channels.filter((c) => !choices.keep.includes(c))));
  if ("refusal" in dropped) return s.setStatus(`subset not created: ${dropped.refusal}`, "danger");
  const where = landing(get, ds, choices.destination);
  let added: string | null = null;
  const stopped = commitExtract(ds, { ...plan, data: dropped.data }, (id) => get().datasets.find((d) => d.id === id)?.name, { quiet, onAdded: (id) => { added = id; where.made?.(); }, patch: where.patch });
  if (stopped) return s.setStatus(stopped.status, stopped.tone);
  s.setStatus(describeExtract(plan, ds.data.time.length));
  if (quiet && added) toast("subset created beside its source", "ok", { action: { label: "Open", onClick: () => openWorksheet({ datasetId: added! }) } });
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
