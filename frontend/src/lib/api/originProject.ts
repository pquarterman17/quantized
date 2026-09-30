// /api/export/opj wrapper: a native Origin .opj project, one workbook per
// dataset (io/origin_project/writer.py). Its own module so its one consumer,
// the lazy File ▸ Export Origin project command, keeps it off the eager path.
// Data only: the writer takes DataStructs, so no graph or plot state travels.

import type { DataStruct } from "../types";
import { postDownload } from "./http";

/** Wire shape of the route's `OpjRequest`: one workbook per item. */
export interface OriginProjectSpec {
  datasets: { dataset: DataStruct; name?: string }[];
  filename?: string;
}

/** Write the datasets into one .opj project and download it. */
export function exportOriginProject(body: OriginProjectSpec, signal?: AbortSignal): Promise<void> {
  return postDownload("/api/export/opj", body, `${body.filename ?? "project"}.opj`, signal);
}
