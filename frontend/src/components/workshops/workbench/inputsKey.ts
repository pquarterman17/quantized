// Shared workbench shell (lane WB4): the identity half of a tool's run key.
// The store replaces a Dataset's data / exclusion list / filter / error roles
// / channel roles object on every edit of that thing, so a new object means
// possibly-new inputs. Rename, tags and unrelated fields are NOT inputs.
import { lazyLineage } from "../../../lib/bookData";
import { tokenOf } from "../../../lib/previewKey";
import { rowStateIdentity } from "../../../lib/rowstate";
import type { Dataset } from "../../../lib/types";

const part = (v: unknown): number | null => (typeof v === "object" && v !== null ? tokenOf(v) : null);

// Lane LZ: while a dataset's rows are still its lazy book's own (the preview, or
// the data an install wrote and nothing edited since) the data part is the book's
// identity instead of the object's, so the install of the same source does not
// move the key but a user edit (a new data object) or a change of the exclusions
// or filter (still tokens below; an install that drops or translates exclusions
// moves them) does.
/** A string naming the dataset's identity-bearing inputs (rows, data, error
 *  and channel roles); "" when there is no dataset. Put it in a run key. */
export function datasetInputsToken(ds: Dataset | null | undefined): string {
  if (!ds) return "";
  const [excluded, filter, data] = rowStateIdentity(ds);
  const lineage = lazyLineage(ds);
  const dataPart = lineage !== null ? `lazy:${lineage}` : part(data);
  return JSON.stringify([ds.id, part(excluded), part(filter), dataPart, part(ds.errorRoles), part(ds.channelRoles)]);
}

/** `datasetInputsToken` of each dataset id in `ids` (a missing one reads ""), joined. */
export function datasetsInputsToken(ids: readonly string[], datasets: readonly Dataset[]): string {
  return ids.map((id) => datasetInputsToken(datasets.find((d) => d.id === id))).join("|");
}
