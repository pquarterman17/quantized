// Sprint Day-0 ratchet pre-bank (2026-08-17): this module exists to bank
// store/useApp.ts headroom AHEAD of the sprint, not because a feature paid
// for it. The #152/#153 merge landed useApp.ts 2 lines over its
// architecture.test.ts STORE_PINS pin (the ratchet sums line deltas across
// branches, so two lanes each adding a few lines can collide at merge even
// though neither alone crossed the ceiling) — lib/bookData.ts's
// `installBookData` extraction was that incident's fix. With seven lanes
// landing store-slice registrations in parallel this week, one lane hitting
// the same collision is likely, so this extraction moves a second, larger
// slice out pre-emptively: same "extract a slice, never raise the pin"
// answer, done before the pin is threatened instead of after.
//
// The two actions below are independent — grouped here for the banking, not
// because they share domain logic — but each is genuinely self-contained
// (no state of its own, no closures over anything but shared `datasets`),
// the same shape store/cellEdit.ts and store/datasetMeta.ts already are:
//   - pasteDataFromClipboard (gap #47): imports the OS clipboard's text
//     through the same guess/parse engine the import wizard uses.
//   - ensureBookData / resolvePendingDatasets / resolveDataset /
//     resolveDatasets (ORIGIN_FILE_DECODE_PLAN #38): the resolve* family
//     around lib/bookData.ts's single-flight `installBookData`, covering
//     every caller shape (fire-and-forget UI trigger, await-one, await-many,
//     await-all-pending-before-save).

import { guessImportSettings, parseImportText } from "../lib/api";
import { installBookData } from "../lib/bookData";
import { lit } from "../lib/macro";
import type { Dataset } from "../lib/types";
import { toast } from "./toasts";
import { nextDatasetId, type AppState } from "./useApp";

export interface DataIntakeSlice {
  // Lazy per-book import (ORIGIN_FILE_DECODE_PLAN #38): fire-and-forget fetch
  // of a pending dataset's full data (no-op if it isn't pending, or a fetch
  // for it is already in flight — single-flight, see `installBookData`).
  // Swaps `data` to the fetched full DataStruct and clears `pending` on
  // success; toasts and leaves `pending` set on failure (so the next call —
  // e.g. the user retrying, or simply re-activating the dataset — retries).
  // Call this from any view that's about to READ a dataset's `.data` for
  // real (not just list it): setActive, a plot window binding, a multi-panel
  // cell, the worksheet.
  ensureBookData: (id: string) => void;
  // Awaited version for a caller that needs every pending dataset FULLY
  // resolved before proceeding — the "Save workspace (.dwk)…" command, so an
  // exported .dwk is always self-contained (never references a book by a
  // path/token that may not exist on another machine or after a restart).
  // Rejects if any fetch fails (the caller should abort the save and toast).
  resolvePendingDatasets: () => Promise<void>;
  // Resolve ONE dataset's full data if it's still a lazy-book preview (#38's
  // deferred edge: a compute or export entry point must never silently run
  // on the small preview). No-op — resolves immediately with the dataset
  // as-is — when it isn't pending (or doesn't exist, returning undefined).
  // Toasts only if the fetch is still running past a short grace period (the
  // common cached-parse case resolves in ~20ms, not worth interrupting for).
  // Rejects on fetch failure so the caller's existing error handling (every
  // compute/export entry already has a catch → setError/toast) aborts the
  // operation instead of falling through to the preview.
  resolveDataset: (id: string) => Promise<Dataset | undefined>;
  // Bounded-concurrency batch version of resolveDataset — batch export/
  // folder ops/macro replay can touch dozens of never-activated datasets at
  // once; this caps simultaneous fetches rather than firing them all. Missing
  // ids are silently dropped from the result; a fetch failure rejects (same
  // "abort, don't proceed on a preview" contract as resolveDataset).
  resolveDatasets: (ids: string[]) => Promise<Dataset[]>;
  // Import the OS clipboard's text (gap #47) through the same guess/parse text
  // engine that backs the import wizard, so a pasted Excel/Origin selection or
  // any tab/comma/semicolon/whitespace table (with or without a header row)
  // lands as a correctly-parsed dataset — never a second parser.
  pasteDataFromClipboard: () => Promise<void>;
}

// Names successive clipboard pastes "pasted data 1", "pasted data 2", … (gap #47).
let _pasteSeq = 0;

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

export function createDataIntakeSlice(set: SliceSet, get: SliceGet): DataIntakeSlice {
  return {
    ensureBookData: (id) => {
      const ds = get().datasets.find((d) => d.id === id);
      if (!ds?.pending) return;
      installBookData(set, id, ds.pending).catch((e) => {
        toast(
          `couldn't load full data for "${ds.name}" — ${e instanceof Error ? e.message : "error"}`,
          "danger",
        );
      });
    },
    resolvePendingDatasets: async () => {
      const pending = get().datasets.filter((d) => d.pending);
      await Promise.all(pending.map((d) => installBookData(set, d.id, d.pending!)));
    },
    resolveDataset: async (id) => {
      const ds = get().datasets.find((d) => d.id === id);
      if (!ds?.pending) return ds;
      // Slow-path notice only — a toast on every activation would be noise
      // since the common cached-parse fetch resolves in ~20ms.
      const timer = setTimeout(() => {
        toast(`fetching full data for "${ds.name}"…`);
      }, 400);
      try {
        await installBookData(set, id, ds.pending);
      } finally {
        clearTimeout(timer);
      }
      return get().datasets.find((d) => d.id === id);
    },
    resolveDatasets: async (ids) => {
      const CONCURRENCY = 6;
      const results: (Dataset | undefined)[] = new Array(ids.length);
      let cursor = 0;
      const worker = async (): Promise<void> => {
        for (;;) {
          const i = cursor++;
          if (i >= ids.length) return;
          results[i] = await get().resolveDataset(ids[i]);
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));
      return results.filter((d): d is Dataset => d != null);
    },
    pasteDataFromClipboard: async () => {
      let text: string;
      try {
        text = await navigator.clipboard.readText();
      } catch {
        const msg = "clipboard read failed — check browser permissions";
        get().setStatus(msg);
        toast(msg, "danger");
        return;
      }
      if (!text.trim()) {
        const msg = "clipboard is empty";
        get().setStatus(msg);
        toast(msg, "danger");
        return;
      }
      get().setStatus("parsing pasted data…");
      try {
        const settings = await guessImportSettings(text);
        const data = await parseImportText(text, settings);
        _pasteSeq += 1;
        const id = nextDatasetId();
        const name = `pasted data ${_pasteSeq}`;
        get().addDataset({ id, name, data });
        get().recordMacro(`Paste ${name}`, `qz.pasteData(${lit(name)})`, {
          kind: "import",
          params: { name },
        });
        const msg = `${name} — ${data.time.length} rows, ${data.labels.length} column${data.labels.length === 1 ? "" : "s"}`;
        get().setStatus(msg);
        toast(msg, "ok");
      } catch (e) {
        const msg = e instanceof Error ? e.message : "paste import failed";
        get().setStatus(msg);
        toast(msg, "danger");
      }
    },
  };
}
