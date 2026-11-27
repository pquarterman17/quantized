// "Go to Source rows" for a subset worksheet (ROW_RANGE_CONTRACT section 4): the entry of the worksheet's cell and
// row menus. Present only when the sheet records a row link (`__quantized_source_rows`); the action is lazy.

import { onLoadFailure, runLazy } from "../../../lib/runLazy";
import { sourceLinkId } from "../../../lib/sourceRowLink";
import type { Dataset } from "../../../lib/types";
import type { ContextMenuItem } from "../../overlays/ContextMenu";

const lazyStore = () => runLazy("Opening the source…", () => import("../../../store/sourceRowLink"));

/** The source worksheet's name for `ds`'s row link; null when `ds` has none or the source is gone. */
export function subsetSourceName(ds: Dataset, datasets: readonly Dataset[]): string | null {
  const id = sourceLinkId(ds.data.metadata);
  return id ? datasets.find((d) => d.id === id)?.name ?? null : null;
}

/** The entries for worksheet `ds`: none unless it is a linked subset. `sourceName` is the source's worksheet name, or
 *  undefined when that worksheet is gone (the entry stays, disabled, saying so). */
export function subsetItems(ds: Dataset, sourceName: string | null): ContextMenuItem[] {
  if (!sourceLinkId(ds.data.metadata)) return [];
  return [
    {
      label: sourceName === null ? "Go to Source rows (source deleted)" : `Go to Source rows (${sourceName})`,
      disabled: sourceName === null,
      title: sourceName === null ? "the worksheet these rows were extracted from no longer exists" : "Open the source worksheet with exactly these rows selected, wherever they are now",
      run: () => void lazyStore().then((m) => m.goToSourceRows(ds.id), onLoadFailure),
    },
    { separator: true },
  ];
}
