// Preferences ▸ Interaction ▸ "Origin upload cache" ▸ Clear… — the body
// behind components/overlays/UploadCachePref.tsx (both load with the lazy
// Preferences dialog, so nothing here is in the eager bundle).
//
// An Origin project opened from the file picker is COPIED into the server's
// upload cache so its other books can still load later — including after a
// restart (backend routes/_uploadcache.py; docs/opening_origin_files.md).
// Those copies are the user's research data sitting on disk, so the app has
// to offer a way to see where they are and delete them. This asks first,
// naming the folder, the count and the size, then reports what was removed.

import { askConfirm } from "../components/overlays/ConfirmDialog";
import type { StoreGet } from "../lib/exportActive";
import { deleteJSON, getJSON } from "../lib/api/http";
import { toast } from "../store/toasts";

/** `GET /api/parsers/upload-cache`. */
export interface UploadCacheInfo {
  path: string;
  entries: number;
  bytes: number;
  max_bytes: number;
}

/** `DELETE /api/parsers/upload-cache`; `kept` = uploads an import is reading. */
export interface UploadCacheCleared {
  removed: number;
  bytes: number;
  kept: number;
}

const ROUTE = "/api/parsers/upload-cache";

/** "1.5 MB" / "0.02 MB" / "2.10 GB": enough digits that a small file is not "0". */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  const mb = bytes / 1e6;
  return `${mb >= 10 ? mb.toFixed(0) : mb >= 0.1 ? mb.toFixed(1) : mb.toFixed(2)} MB`;
}

const files = (n: number): string => `${n} Origin project file${n === 1 ? "" : "s"}`;

export async function runClearUploadCache(s: StoreGet): Promise<void> {
  try {
    const info = await getJSON<UploadCacheInfo>(ROUTE);
    if (info.entries === 0) {
      const msg = `the Origin upload cache is already empty (${info.path})`;
      s().setStatus(msg);
      toast(msg, "info");
      return;
    }
    const ok = await askConfirm(
      "Clear the Origin upload cache?",
      `This deletes the stored copies of ${files(info.entries)} (${formatBytes(info.bytes)}) from ` +
        `${info.path}. Books of those projects that have not been opened yet will need a Re-import. ` +
        "Your original files and the data already loaded are not affected.",
      "Clear cache",
      true,
    );
    if (!ok) return;
    const done = await deleteJSON<UploadCacheCleared>(ROUTE);
    const kept = done.kept > 0 ? `; ${done.kept} still being imported ${done.kept === 1 ? "was" : "were"} kept` : "";
    const msg = `cleared the Origin upload cache — removed ${files(done.removed)} (${formatBytes(done.bytes)})${kept}`;
    s().setStatus(msg);
    toast(msg, "ok");
  } catch (e: unknown) {
    const msg = `couldn't clear the Origin upload cache: ${e instanceof Error ? e.message : "error"} — nothing was reported removed`;
    s().setStatus(msg);
    toast(msg, "danger");
  }
}
