import { useEffect, useState } from "react";
import { bookFetchSettled, lastBookError } from "../../../lib/bookData";
import type { BookSource, Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";

/** ORIGIN_FILE_DECODE_PLAN #38: opening the worksheet on a still-lazy Origin
 *  book fetches its full data (the grid renders the preview rows until then —
 *  a real DataStruct, just fewer of them, so nothing crashes). A failed fetch
 *  (an expired upload, a moved file) must not leave the banner promising
 *  "Loading full data" forever: remember which source failed, and why
 *  (`lastBookError`), once the kicked fetch has settled. Returns that reason
 *  for the CURRENT pending source, else null. */
export function useBookLoad(ds: Dataset): string | null {
  const [loadFailure, setLoadFailure] = useState<{ source: BookSource; reason: string } | null>(null);
  useEffect(() => {
    const source = ds.pending;
    if (!source) return;
    let live = true;
    useApp.getState().ensureBookData(ds.id);
    void bookFetchSettled(ds.id, source)?.then(() => {
      const reason = lastBookError(ds.id, source);
      if (live && reason) setLoadFailure({ source, reason });
    });
    return () => {
      live = false;
    };
  }, [ds.id, ds.pending]);
  return loadFailure && loadFailure.source === ds.pending ? loadFailure.reason : null;
}
