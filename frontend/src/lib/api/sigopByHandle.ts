// `/api/transform/sigop` by dataset handle (plans/LARGE_PAYLOAD_PLAN.md; backend
// routes/transform.py `dataset_handle`). Lazy: the signal-processing workshop
// and the lazy transform runner only.

import { hasDatasetHandle, postJSONDatasetAware } from "./datasetCache";
import { fetchJSON } from "./http";
import { sigopDataset, type SigopRequest, type SigopResult } from "./sigop";
import type { DataStruct } from "../types";

/** `sigopDataset` on `held`, the dataset object the server may already hold:
 *  with a remembered handle (lib/api/datasetCache) the request names it
 *  (`dataset_handle`; 56 MB of JSON at 1M x 7 rows) and a miss (409) resends
 *  `held` once, which is the old request (the route ignores fields it does
 *  not read, such as an Origin project's `books`). No handle: `plain` is
 *  posted as before. */
export function sigopOf(
  held: DataStruct,
  plain: SigopRequest["dataset"],
  rest: Omit<SigopRequest, "dataset">,
  signal?: AbortSignal,
): Promise<SigopResult> {
  if (!hasDatasetHandle(held)) return sigopDataset({ dataset: plain, ...rest }, signal);
  return postJSONDatasetAware<SigopResult>("/api/transform/sigop", { dataset: held, ...rest }, signal, fetchJSON);
}
