// Shared workbench shell (lane WB4): the identity half of a tool's run key.
// The store replaces a Dataset's data / exclusion list / filter / error roles
// / channel roles object on every edit of that thing, so a new object means
// possibly-new inputs. Rename, tags and unrelated fields are NOT inputs.
import { tokenOf } from "../../../lib/previewKey";
import { rowStateIdentity } from "../../../lib/rowstate";
import type { Dataset } from "../../../lib/types";

const part = (v: unknown): number | null => (typeof v === "object" && v !== null ? tokenOf(v) : null);

/** A string naming the dataset's identity-bearing inputs (rows, data, error
 *  and channel roles); "" when there is no dataset. Put it in a run key. */
export function datasetInputsToken(ds: Dataset | null | undefined): string {
  if (!ds) return "";
  return JSON.stringify([ds.id, ...rowStateIdentity(ds).map(part), part(ds.errorRoles), part(ds.channelRoles)]);
}
