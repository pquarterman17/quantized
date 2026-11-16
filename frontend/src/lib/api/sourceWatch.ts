// The source watch's two wire calls (gap audit 5 lane J, item 10). Their only
// consumer is the lazy watcher (lib/sourceWatch.ts + store/reimportLive.ts), so
// they live here, NOT re-exported by lib/api.ts.
//   * `/api/source-watch/stat`: the state and change stamp of each watched file
//     (routes/source_watch.py; `pending` = the stat has not answered yet).
//   * `/api/parsers/import` in LIVE mode (routes/_liveimport.py): one byte
//     snapshot, an unfinished last line held, 409 when the file changed during
//     the read, and the source baseline in headers.

import { rememberHandle } from "./datasetCache";
import { ensureOk, postJSON } from "./http";
import type { components } from "./schema";
import type { DataStruct } from "../types";

export type SourceStat = components["schemas"]["SourceStat"];

/** Stat `paths` (at most 64), answered in request order. Never reads a file's bytes. */
export async function statSources(paths: string[], signal?: AbortSignal): Promise<SourceStat[]> {
  const res = await postJSON<components["schemas"]["SourceStatResponse"]>("/api/source-watch/stat", { paths }, signal);
  return res.entries;
}

/** One live read: the parsed data plus what exactly was read. */
export interface LiveRead {
  data: DataStruct;
  /** The stat route's stamp of the bytes read. */
  stamp: string;
  /** `st_mtime` (epoch s) -- the very float the desktop probe reports -- size and `sha256:<hex>`. */
  mtime: number;
  size: number;
  checksum: string;
  /** An unfinished last line was left out (`hold`). */
  held: boolean;
}

/** Re-read `path` as one consistent snapshot; `hold` leaves an unterminated last line out.
 *  Throws `HttpError` 409 when the file changed during the read (or has no complete line). */
export async function importLive(path: string, hold: boolean, signal?: AbortSignal): Promise<LiveRead> {
  const res = await ensureOk(
    await fetch("/api/parsers/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, live: true, hold_partial: hold }),
      signal,
    }),
  );
  const data = (await res.json()) as DataStruct;
  rememberHandle(data, res.headers.get("X-Dataset-Handle"));
  const h = (k: string): string => res.headers.get(k) ?? "";
  return {
    data,
    stamp: h("X-Source-Stamp"),
    mtime: Number(h("X-Source-Mtime")),
    size: Number(h("X-Source-Size")),
    checksum: h("X-Source-Checksum"),
    held: h("X-Live-Held") === "1",
  };
}
