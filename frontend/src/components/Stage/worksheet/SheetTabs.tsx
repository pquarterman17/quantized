// Sheet tab strip (WORKSHEET_PLAN item 5 / key decision 4): a bottom strip
// listing the viewed dataset's `originSheetGroups` siblings (Origin's own
// worksheet-tab convention for a multi-sheet workbook). Composes ONLY over
// `lib/grouping.originSheetGroups` + the store's `setActive` — no book
// container object, no store slice, no persistence (the active sheet IS
// `activeId`, already round-tripped via `.dwk`). Hidden entirely for
// non-Origin / single-sheet datasets, so it costs nothing in the common case.
//
// Clicking a tab calls `setActive`, verified safe here: `nextStageTab` returns
// `current` when the stage tab is already "worksheet", so switching sheets can
// never yank the user to the Plot/Map tab (it DOES reset the singleton plot
// view block, identical to a Library click today — acceptable and consistent).

import { originSheetGroups, originSheetNumber } from "../../../lib/grouping";
import { useApp } from "../../../store/useApp";

export interface SheetTabsProps {
  /** The dataset currently shown in the worksheet (WorksheetPane's own
   *  `datasetId` prop) — used to find its sheet-group siblings and highlight
   *  the active tab. Reading the full `datasets` list (below) to compute the
   *  group is NOT a singleton-view read; it's the same "all datasets" read
   *  the Library's BookFamiliesSection already does. */
  datasetId: string;
}

export default function SheetTabs({ datasetId }: SheetTabsProps) {
  const datasets = useApp((s) => s.datasets);
  const setActive = useApp((s) => s.setActive);

  const group = originSheetGroups(datasets).find((g) => g.members.some((m) => m.id === datasetId));
  if (!group) return null; // non-Origin or single-sheet dataset — no strip

  return (
    <div className="qzk-sheet-tabs" role="tablist" aria-label="Origin worksheet sheets">
      {group.members.map((m) => {
        const n = originSheetNumber(m);
        const meta = m.data.metadata as Record<string, unknown> | undefined;
        const long = String(meta?.["origin_book_long"] ?? "");
        const active = m.id === datasetId;
        return (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={`qzk-sheet-tab${active ? " active" : ""}`}
            title={long || m.name}
            onClick={() => setActive(m.id)}
          >
            <span className="qzk-sheet-tab-num">{n}</span>
            <span className="qzk-sheet-tab-name">{long || `sheet ${n}`}</span>
          </button>
        );
      })}
    </div>
  );
}
