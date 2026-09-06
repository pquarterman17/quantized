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
//
// R3 (POST_SPRINT_INDEPENDENT_REVIEW.md, class #196): `commit()` NEVER
// trusts a preview row's own remembered fields AS THE VERDICT OF RECORD. It
// looks up the LIVE dataset and recomputes against ITS recorded
// checksum/mtime/size, against a fresh probe taken right there at commit
// time, through TWO guards (`lib/relink.ts`'s `guardVerdict`): one against
// what's RECORDED, one against what PREVIEW ITSELF showed. A dataset
// removed, or whose `source` OBJECT no longer matches what the row was
// computed against, fails closed with zero mutation, re-checked both before
// the probe and again, synchronously, immediately before the write. Once a
// row clears every guard, provenance is written using the STRICT
// `sourceChangeVerdict` (never `guardVerdict` — a stat MATCH when the
// checksum is unconfirmable only fails to contradict, never CONFIRMS): a
// confirmed "unchanged" row, or a legacy dataset with nothing recorded yet,
// backfills from the fresh probe; an escalated row with something recorded
// that this probe couldn't reconfirm keeps that ORIGINAL provenance
// verbatim — only the path moves.
//
// C1 (relink consent — closes the KNOWN LIMITATION R3's third-pass
// investigation left open): a relink CANDIDATE path used to be permanently
// unconsented (a not-yet-linked path can never join the DECLARED-source set
// `probe_source` checksums against), so a checksum-bearing dataset's verdict
// was always "unknown". `browseNewRoot` fixes this the only sound way found
// — a REAL native folder-picker gesture, never an implicit grant from a
// typed path — via `pickRelinkDirectory` (`desktop_bridge_dialogs
// .pick_relink_directory`), which mints a read-only, session-scoped grant
// over the chosen root; every `probeSource` call for a candidate under it
// (Preview AND the commit re-probe, same grant) can then checksum for real.
// Typing `newRoot` still runs Preview, but mints nothing —
// `newRootConsented` tracks which happened so the view can label a
// typed-path session honestly stat-only. Revoked on panel close; see
// `desktop_consent.py`'s doc for the other two revocation points.

import { create } from "zustand";

import { grantSourceReadPaths, hasDesktopShell, revokeRelinkDir } from "../lib/desktopBridge";
import type { Dataset } from "../lib/types";
import { browseForNewRoot } from "./relinkBrowse";
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
  /** P1.7 slice 2 (collision-safe relinking): set by `runPreview` when this
   *  row's candidate names the SAME file as another row's, from a DIFFERENT
   *  recorded source (`lib/relink.findCandidateCollisions`). Unresolved
   *  (`resolution` undefined) and `"skip"` rows are EXCLUDED from
   *  `commit()`; exactly one row per contested destination may be `"keep"`,
   *  chosen only through `resolveCollision` — never a default winner.
   *  `others` are the display names of the contending rows; `otherIds`
   *  their dataset ids. Reset with every new preview. */
  collision?: { others: string[]; otherIds: string[]; resolution?: "keep" | "skip" };
}

export interface RelinkState {
  open: boolean;
  oldRoot: string;
  newRoot: string;
  preview: RelinkPreviewRow[];
  busy: boolean;
  bridgeAvailable: boolean;
  /** True only right after `browseNewRoot` grants the CURRENT `newRoot` —
   *  cleared by any typed edit; the view labels a typed Preview stat-only. */
  newRootConsented: boolean;
  openPanel: (seed?: { oldRoot?: string; newRoot?: string }) => void;
  closePanel: () => void;
  setOldRoot: (v: string) => void;
  setNewRoot: (v: string) => void;
  /** C1: the ONLY way `newRootConsented` becomes true — a real dialog
   *  return (`pickRelinkDirectory`), never a typed path. */
  browseNewRoot: () => Promise<void>;
  runPreview: () => Promise<void>;
  commit: () => Promise<void>;
  /** Per-row escalation (box 2/5, P1-2 defect 2c): explicit user consent to
   *  commit ONE "unknown" row despite its unresolved checksum. Never a
   *  global bypass — every other unknown row stays excluded. */
  escalateUnknownRow: (datasetId: string) => void;
  /** P1.7 slice 2: the ONE explicit resolution for a contested destination
   *  — `datasetId` keeps the file, every other row in its collision group
   *  is marked `"skip"` (left unchanged by commit). Choosing another row
   *  later moves the `"keep"` to it; there is never more than one. */
  resolveCollision: (datasetId: string) => void;
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
  newRootConsented: false,

  openPanel: (seed) =>
    set({
      open: true,
      oldRoot: seed?.oldRoot ?? "",
      newRoot: seed?.newRoot ?? "",
      preview: [],
      bridgeAvailable: hasDesktopShell(),
      newRootConsented: false, // a seeded path was never picked THIS session
    }),
  // C1: revoke any `browseNewRoot` grant here so it never outlives this
  // session — covers Cancel, the window's own close, AND commit()'s success
  // path (which routes through this).
  closePanel: () => {
    void revokeRelinkDir();
    set({ open: false, newRootConsented: false });
  },
  setOldRoot: (v) => set({ oldRoot: v, preview: [] }),
  // Typing always clears consent — only a fresh `browseNewRoot` pick grants.
  setNewRoot: (v) => set({ newRoot: v, preview: [], newRootConsented: false }),

  // Extracted to store/relinkBrowse.ts (500-line ceiling) — see its doc for
  // the F2/F3/F6 review rulings it carries.
  browseNewRoot: () => browseForNewRoot(get, set),

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
      // Row computation + collision annotation live in store/relinkPreview.ts
      // (500-line ceiling), loaded on the click so the relink core stays out
      // of the eager bundle (store/relinkCommit.ts's header).
      const { buildPreviewRows } = await import("./relinkPreview");
      const rows = await buildPreviewRows(datasets, oldRoot, newRoot, bridgeAvailable);
      set({ preview: rows });
      if (rows.length === 0) {
        toast("no datasets have a source under that folder", "info");
      }
    } finally {
      set({ busy: false });
    }
  },

  // The commit machinery (and lib/relink.ts behind it) loads on the click —
  // see store/relinkCommit.ts's header for the bundle reasoning. The live
  // dataset snapshot the R3 identity guard compares against is taken HERE,
  // synchronously, before the chunk is awaited: a swap landing while the
  // module loads must be caught exactly like one landing during the probe.
  commit: () => {
    const liveById = new Map(useApp.getState().datasets.map((d) => [d.id, d]));
    return import("./relinkCommit").then((m) => m.commitRelink(get, set, liveById));
  },

  escalateUnknownRow: (datasetId) =>
    set((s) => ({
      preview: s.preview.map((r) => (r.datasetId === datasetId ? { ...r, escalated: true } : r)),
    })),

  resolveCollision: (datasetId) =>
    set((s) => {
      const chosen = s.preview.find((r) => r.datasetId === datasetId);
      if (!chosen?.collision) return {};
      const group = new Set([datasetId, ...chosen.collision.otherIds]);
      return {
        preview: s.preview.map((r) =>
          r.collision && group.has(r.datasetId)
            ? { ...r, collision: { ...r.collision, resolution: r.datasetId === datasetId ? "keep" : "skip" } }
            : r,
        ),
      };
    }),

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
  //
  // R6 (POST_SPRINT_INDEPENDENT_REVIEW.md): the `token` `withHistoryBatch`
  // hands `fn` here is threaded explicitly into `importPaths` (which
  // forwards it to every `addDataset` call it makes) so ONLY the datasets
  // THIS operation creates fold into the one undo entry. Any unrelated edit
  // a user makes while `importPaths`'s own `await`s are in flight (network
  // round trips) calls `recordHistory` with no token at all — per that
  // function's doc, an untokened call ALWAYS records its own independent
  // entry, live-state and all, never absorbed into this batch. See
  // `HistoryBatchToken`'s doc (store/history.ts) for why identity, not a
  // boolean, is what makes that true.
  //
  // R6 code-review F1/F2: `presentOutcome: false` keeps the recipe-suggestion
  // cascade's own real awaits OUT of this batch (see `ImportPathsOptions`'s
  // doc); `createdIds` is `importPaths`'s OWN return, never a before/after
  // id-diff (which mislabeled a concurrent paste/demo/merge's dataset too).
  importChangedAsNewVersion: async (datasetId) => {
    const s = useApp.getState();
    const ds = s.datasets.find((d) => d.id === datasetId);
    if (!ds?.source) return;
    const sourcePath = ds.source.path;
    let created = false;
    await useApp.getState().withHistoryBatch(`import "${ds.name}" as a new version`, async (token) => {
      const createdIds = await useApp
        .getState()
        .importPaths([sourcePath], { historyToken: token, presentOutcome: false });
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
