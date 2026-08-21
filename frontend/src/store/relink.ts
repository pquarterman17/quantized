// P1.7 box 3/4/5: relink-one and relink-folder with a dry-run preview, and
// "changed source, import as a new version". A standalone Zustand store —
// the store/fitYByX.ts / store/toasts.ts precedent — rather than composed
// into useApp.ts: that store sits at its size-ratchet pin
// (architecture.test.ts's STORE_PINS, 2818, zero headroom), and none of
// this panel's own open/preview state needs to round-trip `.dwk`. Mutations
// to `Dataset.source` go through `useApp.getState()` directly (recordHistory
// + set), the same "standalone store, direct useApp.getState() calls" shape
// store/reimport.ts and store/importDatasets.ts already use.
//
// Path matching (`lib/relink.relinkedCandidate`) and the provenance diff
// (`lib/relink.sourceChangeVerdict`) are pure and unit-tested on their own;
// this module is the thin orchestrator: it calls the desktop bridge to
// PROBE each candidate (never guessing a state without one — see below),
// then either commits an atomic batch update (ONE `recordHistory` call, so
// undo restores every relinked dataset's old path in a single step — box 3's
// "commit is atomic + one undo entry") or reports why a row can't commit.
//
// Browser degrade (box 4's "degrade honestly in browser — no bridge means
// source checks are unavailable, say so, never guess"): `hasDesktopShell()`
// gates the whole preview; with no bridge every row reports `"unavailable"`
// rather than a guessed reachability state.

import { create } from "zustand";

import { grantSourceReadPaths, hasDesktopShell, probeSource } from "../lib/desktopBridge";
import { relinkedCandidate, sourceChangeVerdict } from "../lib/relink";
import type { Dataset } from "../lib/types";
import { toast } from "./toasts";
import { useApp } from "./useApp";

export type RelinkRowStatus =
  | "resolved" // candidate exists and is readable
  | "missing"
  | "offline"
  | "permission_denied"
  | "no_candidate" // oldPath isn't under the chosen oldRoot — not this relink's concern
  | "unavailable"; // no desktop bridge — cannot probe at all (honest browser degrade)

export interface RelinkPreviewRow {
  datasetId: string;
  datasetName: string;
  oldPath: string;
  candidatePath: string | null;
  status: RelinkRowStatus;
  /** "changed" rows are EXCLUDED from `commit()` — box 5: a changed source
   *  warns and can be imported as a new version, it is never silently
   *  folded into the existing dataset by a plain relink. "unknown" rows
   *  (P1-2 defect 2) are ALSO excluded from a bulk commit by default — a
   *  recorded checksum that couldn't be freshly confirmed this session
   *  (`lib/relink.sourceChangeVerdict`'s defect-1 fix) must never commit
   *  silently as if verified. `escalated` is the one way past that: an
   *  explicit PER-ROW "use anyway" click (never a global bypass). */
  changeVerdict: "unchanged" | "changed" | "unknown";
  /** Set only by `escalateUnknownRow(datasetId)` — per-row consent to commit an
   *  "unknown" row despite the unresolved checksum. Never true on a row
   *  fresh out of `runPreview`; cleared implicitly whenever a new preview
   *  replaces the row (Preview always resets `preview`). */
  escalated?: boolean;
  candidateChecksum: string | null;
  candidateMtime: number | null;
  candidateSize: number | null;
}

interface RelinkState {
  open: boolean;
  oldRoot: string;
  newRoot: string;
  preview: RelinkPreviewRow[];
  busy: boolean;
  bridgeAvailable: boolean;
  openPanel: (seed?: { oldRoot?: string; newRoot?: string }) => void;
  closePanel: () => void;
  setOldRoot: (v: string) => void;
  setNewRoot: (v: string) => void;
  runPreview: () => Promise<void>;
  commit: () => Promise<void>;
  /** Per-row escalation (box 2/5, P1-2 defect 2c): explicit user consent to
   *  commit ONE "unknown" row despite its unresolved checksum. Never a
   *  global bypass — every other unknown row stays excluded. */
  escalateUnknownRow: (datasetId: string) => void;
  importChangedAsNewVersion: (datasetId: string) => Promise<void>;
}

/** A dataset known (by the type system, not just at runtime) to carry a
 *  real `source` — the narrowed shape `relinkableDatasets` returns. */
export type SourcedDataset = Dataset & { source: NonNullable<Dataset["source"]> };

/** The datasets a relink can possibly act on: every dataset carrying a real
 *  `source.path` (a browser-only import never has one — see
 *  `Dataset.source`'s own doc — and is correctly invisible to relink, there
 *  is nothing to point anywhere). Exported for the view to render an
 *  "N datasets have a source" hint before a root is even chosen. */
export function relinkableDatasets(): SourcedDataset[] {
  return useApp.getState().datasets.filter((d): d is SourcedDataset => Boolean(d.source));
}

export const useRelink = create<RelinkState>((set, get) => ({
  open: false,
  oldRoot: "",
  newRoot: "",
  preview: [],
  busy: false,
  bridgeAvailable: false,

  openPanel: (seed) =>
    set({
      open: true,
      oldRoot: seed?.oldRoot ?? "",
      newRoot: seed?.newRoot ?? "",
      preview: [],
      bridgeAvailable: hasDesktopShell(),
    }),
  closePanel: () => set({ open: false }),
  setOldRoot: (v) => set({ oldRoot: v, preview: [] }),
  setNewRoot: (v) => set({ newRoot: v, preview: [] }),

  runPreview: async () => {
    const { oldRoot, newRoot } = get();
    if (!oldRoot.trim() || !newRoot.trim()) {
      toast("enter both the old and new folder paths", "danger");
      return;
    }
    set({ busy: true });
    try {
      const datasets = relinkableDatasets();
      const bridgeAvailable = hasDesktopShell();
      set({ bridgeAvailable });
      // P1.7 consent ruling (desktop_bridge.py's module doc): these are
      // ALREADY the project's own recorded source paths, not arbitrary
      // picks, so read consent is extended up front — reusing
      // desktop_consent's existing per-path grant store, never a new
      // consent kind — so a checksum can be computed below without a
      // native dialog per file.
      if (bridgeAvailable) {
        await grantSourceReadPaths(datasets.map((d) => d.source.path));
      }
      const rows: RelinkPreviewRow[] = [];
      for (const ds of datasets) {
        const oldPath = ds.source.path;
        const candidate = relinkedCandidate(oldRoot, newRoot, oldPath);
        if (candidate === null) continue; // outside the moved tree entirely
        if (!bridgeAvailable) {
          rows.push({
            datasetId: ds.id,
            datasetName: ds.name,
            oldPath,
            candidatePath: candidate,
            status: "unavailable",
            changeVerdict: "unknown",
            candidateChecksum: null,
            candidateMtime: null,
            candidateSize: null,
          });
          continue;
        }
        const probe = await probeSource(candidate);
        if (probe === null || probe.state !== "ok") {
          const status: RelinkRowStatus =
            probe?.state === "permission_denied"
              ? "permission_denied"
              : probe?.state === "offline"
                ? "offline"
                : "missing";
          rows.push({
            datasetId: ds.id,
            datasetName: ds.name,
            oldPath,
            candidatePath: candidate,
            status,
            changeVerdict: "unknown",
            candidateChecksum: null,
            candidateMtime: null,
            candidateSize: null,
          });
          continue;
        }
        const verdict = sourceChangeVerdict(
          { checksum: ds.source.checksum, mtime: ds.source.mtime, size: ds.source.size },
          { checksum: probe.checksum, mtime: probe.mtime, size: probe.size },
        );
        rows.push({
          datasetId: ds.id,
          datasetName: ds.name,
          oldPath,
          candidatePath: candidate,
          status: "resolved",
          changeVerdict: verdict,
          candidateChecksum: probe.checksum,
          candidateMtime: probe.mtime,
          candidateSize: probe.size,
        });
      }
      set({ preview: rows });
      if (rows.length === 0) {
        toast("no datasets have a source under that folder", "info");
      }
    } finally {
      set({ busy: false });
    }
  },

  commit: async () => {
    const { preview } = get();
    const candidates = preview.filter(
      (r) =>
        r.status === "resolved" &&
        r.candidatePath &&
        r.changeVerdict !== "changed" &&
        // P1-2 defect 2: an "unknown" row commits ONLY once explicitly
        // escalated via `escalateUnknownRow` — a bulk commit never sweeps it in.
        (r.changeVerdict !== "unknown" || r.escalated),
    );
    if (candidates.length === 0) {
      toast("nothing to relink — no resolved, unchanged candidates", "danger");
      return;
    }
    set({ busy: true });
    let resolved: RelinkPreviewRow[];
    try {
      // P2 (adversarial review, TOCTOU): the preview can go stale between
      // when it ran and when the user clicks Relink — a file deleted or
      // overwritten in that window must never write a stale checksum
      // silently. Re-probe every committing candidate right here, right
      // before the write, and drop (never trust) anything whose
      // reachability changed or whose content changed AGAIN since the
      // preview ran.
      const reprobed = await Promise.all(
        candidates.map(async (row) => {
          const probe = await probeSource(row.candidatePath!);
          if (probe === null || probe.state !== "ok") return null;
          if (
            row.candidateChecksum != null &&
            probe.checksum != null &&
            probe.checksum !== row.candidateChecksum
          ) {
            return null; // changed again since Preview — do not trust it
          }
          return {
            ...row,
            candidateChecksum: probe.checksum,
            candidateMtime: probe.mtime,
            candidateSize: probe.size,
          };
        }),
      );
      resolved = reprobed.filter((r): r is RelinkPreviewRow => r !== null);
    } finally {
      set({ busy: false });
    }
    const staleSinceCommit = candidates.length - resolved.length;
    if (resolved.length === 0) {
      toast("nothing to relink — every candidate changed or became unreachable since Preview", "danger");
      return;
    }
    const byId = new Map(resolved.map((r) => [r.datasetId, r]));
    const s = useApp.getState();
    // ONE recordHistory call for the whole batch — undo restores every
    // relinked dataset's old path in a single step (box 3).
    s.recordHistory(`relink ${resolved.length} source${resolved.length === 1 ? "" : "s"}`);
    useApp.setState((state) => ({
      datasets: state.datasets.map((d) => {
        const row = byId.get(d.id);
        if (!row || !row.candidatePath || !d.source) return d;
        return {
          ...d,
          source: {
            kind: "path" as const,
            path: row.candidatePath,
            // Backfill provenance from the RE-PROBED fresh read (not the
            // stale preview one): for an "unchanged" verdict this is the
            // SAME bytes already recorded (no silent rewrite — it still
            // describes the identical content); for "unknown" (nothing was
            // recorded before, e.g. a legacy or browser-imported dataset)
            // this fills a genuine gap rather than leaving it forever
            // blank. A "changed" row never reaches here — filtered out
            // above, both at Preview and again at re-probe.
            ...(row.candidateChecksum != null ? { checksum: row.candidateChecksum } : {}),
            ...(row.candidateMtime != null ? { mtime: row.candidateMtime } : {}),
            ...(row.candidateSize != null ? { size: row.candidateSize } : {}),
          },
        };
      }),
    }));
    const skippedChanged = preview.filter((r) => r.changeVerdict === "changed").length;
    // P1-2 defect 2: named separately from `skippedChanged` — "unknown" isn't
    // a rejection (the content might well be fine), it's a row nothing
    // committable was ever confirmed for. Escalated rows aren't counted here
    // (they were candidates, not exclusions).
    const skippedUnknown = preview.filter((r) => r.changeVerdict === "unknown" && !r.escalated).length;
    const summary = `relinked ${resolved.length} dataset${resolved.length === 1 ? "" : "s"}`;
    const notes = [
      skippedChanged > 0 ? `${skippedChanged} changed source${skippedChanged === 1 ? "" : "s"} skipped (import as new version instead)` : null,
      skippedUnknown > 0
        ? `${skippedUnknown} needs verification (unresolved checksum) skipped — use "use anyway" per row to include`
        : null,
      staleSinceCommit > 0 ? `${staleSinceCommit} candidate${staleSinceCommit === 1 ? "" : "s"} changed since Preview, skipped` : null,
    ].filter((n): n is string => n !== null);
    toast(notes.length > 0 ? `${summary} — ${notes.join("; ")}` : summary, "ok");
    set({ open: false, preview: [] });
  },

  escalateUnknownRow: (datasetId) =>
    set((s) => ({
      preview: s.preview.map((r) => (r.datasetId === datasetId ? { ...r, escalated: true } : r)),
    })),

  // Box 5: "changed source warns and can import as a NEW VERSION" — reuses
  // the EXISTING import path (never an in-place refresh, per L0.32), then
  // tags the freshly created dataset(s) with `versionOf` so the link back
  // to the original survives.
  //
  // P1-2 defect 3: `importPaths` records ONE history entry PER created
  // dataset (`addDataset` calls `recordHistory` every time it's called —
  // see useApp.ts), and a multi-book Origin source creates several. Left
  // alone, the trailing versionOf `setState` below would ride on whatever
  // entry happened to land last, so Undo only reverted the LAST book and
  // stranded every earlier one's versionOf tag. `withHistoryBatch` collapses
  // the whole thing — import of ALL created datasets + versionOf tagging —
  // into exactly ONE undo step, the same guarantee `commit()` above already
  // has (its own comment: "ONE recordHistory call for the whole batch").
  importChangedAsNewVersion: async (datasetId) => {
    const s = useApp.getState();
    const ds = s.datasets.find((d) => d.id === datasetId);
    if (!ds?.source) return;
    const sourcePath = ds.source.path;
    let created = false;
    await useApp.getState().withHistoryBatch(`import "${ds.name}" as a new version`, async () => {
      const before = new Set(useApp.getState().datasets.map((d) => d.id));
      await useApp.getState().importPaths([sourcePath]);
      const createdIds = useApp
        .getState()
        .datasets.filter((d) => !before.has(d.id))
        .map((d) => d.id);
      if (createdIds.length === 0) return;
      created = true;
      const createdSet = new Set(createdIds);
      useApp.setState((state) => ({
        datasets: state.datasets.map((d) => (createdSet.has(d.id) ? { ...d, versionOf: datasetId } : d)),
      }));
    });
    if (created) toast(`imported "${ds.name}" as a new version`, "ok");
  },
}));
