// /api/export/opj wrapper: a native Origin .opj project, one workbook per
// dataset (io/origin_project/writer.py). Its own module so its one consumer,
// the lazy File ▸ Export Origin project command, keeps it off the eager path.
// Data only: the writer takes DataStructs, so no graph or plot state travels.

import type { DataStruct } from "../types";
import { postDownloadHeaders } from "./http";

/** Wire shape of the route's `OpjRequest`: one workbook per item. */
export interface OriginProjectSpec {
  /** `group`/`book`: items sharing a group are the sheets of one book. */
  datasets: { dataset: DataStruct; name?: string; group?: string; book?: string }[];
  filename?: string;
  /** Opt-in: write imported matrix books as Origin matrices (Preferences ▸
   *  "Write matrix books as Origin matrices"); off writes X/Y/Z columns. */
  matrices_as_matrix?: boolean;
}

/** What the writer reports beside the file: how many matrix books it wrote
 *  as X/Y/Z worksheet columns instead of a matrix (`X-Opj-Matrix-Fallback`;
 *  complex, edited, or sharing a workbook — io/origin_project/writer_matrix). */
export interface OriginProjectResult {
  matrixFallbacks: number;
}

/** Write the datasets into one .opj project and download it. */
export async function exportOriginProject(
  body: OriginProjectSpec,
  signal?: AbortSignal,
): Promise<OriginProjectResult> {
  const h = await postDownloadHeaders("/api/export/opj", body, `${body.filename ?? "project"}.opj`, signal);
  const n = Number(h.get("X-Opj-Matrix-Fallback") ?? "0");
  return { matrixFallbacks: Number.isFinite(n) && n > 0 ? Math.floor(n) : 0 };
}
