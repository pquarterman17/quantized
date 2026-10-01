// Cross-instance workbook Copy/Paste/Duplicate (PR I, LIBRARY_WORKBOOK_UX_PLAN
// L0.23/L0.24) — the thin store orchestrator around lib/workbookTransfer.ts's
// pure build/parse/paste core. Composed into the ONE useApp store instance
// exactly like store/reimport.ts (see that file's header): owns no state of
// its own, calls get()/set() directly, one `recordHistory` per successful
// gesture.
//
// TRANSPORT RULING (frozen-scope item 2, "clipboard is the natural
// transport; if... unreliable, a file-based transport is acceptable —
// document the ruling"): this slice ships CLIPBOARD-TEXT ONLY, via the same
// `copyText`/`navigator.clipboard.readText()` pair every other clipboard
// feature in this app already uses (lib/clipboard.ts's `copyText`,
// components/Stage/worksheet/useWorksheetBlockOps.ts's `readText` paste).
// The package is plain JSON text carrying its own `format`/`version`
// envelope (lib/workbookTransfer.ts) — no separate marker prefix is added,
// because `parseTransferPackage` already length-guards BEFORE attempting
// `JSON.parse` (so pasting arbitrary non-Quantized clipboard text, however
// large, is cheap to reject) and its `format` field check IS the "compatible
// payload present" test a Paste command gates on (`canPasteWorkbook` below).
// LARGE WORKBOOKS (Group F, which supersedes PR I's booked defer of a
// file-based fallback): above `MAX_TRANSFER_PACKAGE_CHARS` Copy no longer
// refuses — `buildCopyText` stores the package in the backend's guarded,
// expiring temporary store and the clipboard gets a small versioned
// descriptor instead; Paste's `resolvePasteText` fetches and validates it
// through the SAME `parseTransferPackage`. Below the bound the clipboard text
// is byte-identical to PR I's. The write-authority answer PR I asked for
// (caller sends bytes, never a path; server-owned cache dir, server-minted
// id, bounded size/count/lifetime) lives in lib/workbookTransferRef.ts and
// src/quantized/io/workbook_transfer_store.py. Every failure there — store
// offline on Copy; missing/expired/incomplete/incompatible on Paste — is a
// named refusal reported below like any other, never a partial paste.
//
// FAILURE-SAFE CLEANUP (frozen-scope item 5): every failure path below
// (empty/oversize workbook, unparseable clipboard text, wrong format/
// version) returns BEFORE `recordHistory`/`set` is ever called — the
// destination is provably byte-identical on any refusal, because nothing
// mutates until `pasteTransferPackage` has ALREADY produced the complete
// replacement arrays ("build fully, swap once"). A successful paste is
// exactly one `recordHistory` call immediately followed by exactly one
// `set()` call touching every affected array together, so undo restores the
// pre-paste project in one step.

import { copyTextAsync } from "../lib/clipboard";
import { plural } from "../lib/plural";
import type { BuildTransferResult } from "../lib/workbookTransfer";
import type { AppState } from "./useApp";
import { nextFigureId } from "./figureLifecycle";
import { toast } from "./toasts";

export type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
export type SliceGet = () => AppState;

/** `lib/workbookTransfer.ts` — the pure build/parse/paste core: the package
 *  envelope, the fresh-id rewrite and the lineage repair — is reached from
 *  NOTHING in the entry graph except the four actions below, and all four were
 *  already `async` (Copy and Duplicate await `resolvePendingDatasets`, Paste
 *  and the Paste-availability probe await the clipboard). Loading it on the
 *  first Copy/Paste/Duplicate of a session instead of at startup therefore
 *  changes no public signature: every action still returns the same `Promise`
 *  it did before, resolving after the same single `recordHistory` entry and
 *  the same one `set()`.
 *
 *  A chunk-load failure is reported through this slice's OWN `fail()` (status
 *  line + danger toast), exactly like every other refusal here, rather than
 *  surfacing as an unhandled rejection — and, like them, it returns before
 *  anything mutates, so the project is provably untouched. `canPasteWorkbook`
 *  answers `false` instead: its contract is already "false covers no bridge,
 *  not our format, and read denied alike", and a core that will not load
 *  cannot paste either. A failed load is not cached, so the next gesture
 *  retries. Measured: 912,461 -> 910,631 B eager.
 *
 *  Copy is the one action that does NOT simply `await` the core first — see
 *  `buildForCopy` below for why the clipboard write has to start before it.
 *
 *  Bundle diet slice 17: Paste and Duplicate load their bodies
 *  (store/workbookTransferRun.ts, which imports the core statically) instead
 *  of the bare core, so the id generators, the merge and the success report
 *  leave the eager bundle too. Same failure contract, same messages. */
type TransferRun = typeof import("./workbookTransferRun");
type CopyBuilt = Extract<BuildTransferResult, { ok: true }>;

/** The Paste/Duplicate bodies, or null after reporting that `what` could not run. */
async function transferRun(get: SliceGet, what: string): Promise<TransferRun | null> {
  try {
    return await import("./workbookTransferRun");
  } catch (e) {
    fail(get, `${what} failed: ${e instanceof Error ? e.message : "error"}`);
    return null;
  }
}

/** Copy's half of the seam, as a promise the caller STARTS INSIDE the click's
 *  own task and hands, still pending, to `copyTextAsync`.
 *
 *  `copyTextAsync` (lib/clipboard.ts) wraps it in a `Promise<Blob>` and hands
 *  that to `ClipboardItem`, so `navigator.clipboard.write` is reached with
 *  ZERO awaits after the gesture while the chunk fetch and the package build
 *  are still in flight.
 *  Awaiting the core first — the first cut of this seam did — spends the
 *  transient user activation the Clipboard API requires, and the copy then
 *  fails reporting "clipboard unavailable", which is not what went wrong.
 *  It is the same rule that kept `lib/openWorkspaceCommand.ts` out of the
 *  bundle diet: its `openFilePicker()` must run in the click's own task too.
 *
 *  Rejects with the COMPLETE user-facing message so the caller reports it
 *  verbatim — both wordings Copy has always used are unchanged. */
async function buildForCopy(
  workbookId: string,
  name: string,
  get: SliceGet,
): Promise<CopyBuilt> {
  let core: typeof import("../lib/workbookTransfer");
  try {
    core = await import("../lib/workbookTransfer");
  } catch (e) {
    throw new Error(`copy "${name}" failed: ${e instanceof Error ? e.message : "error"}`);
  }
  const built = await core.buildCopyText(workbookId, get());
  if (!built.ok) throw new Error(`copy "${name}" unavailable: ${built.reason}`);
  return built;
}

/** Every refusal in this slice reports the SAME way — the persistent status
 *  line AND a danger toast, one message built once. Nine sites open-coded some
 *  part of that: five repeated the pair (three of them building their message
 *  string TWICE — duplicated logic and duplicated bytes in an eager module),
 *  and four of Paste's refusals toasted WITHOUT touching the status line, so a
 *  refused paste left the previous action's success message standing on the
 *  status bar. All nine go through here now (store/workbookTransferRun.ts's
 *  bodies get it through their `TransferCtx`). */
function fail(get: SliceGet, msg: string): void {
  get().setStatus(msg);
  toast(msg, "danger");
}

export interface WorkbookTransferSlice {
  /** Copy — build a versioned package for `workbookId` and write it to the
   *  system clipboard as plain JSON text. Resolves any not-yet-loaded
   *  ("pending") member first (the same precondition `.dwk` save enforces).
   *  Reports the exact refusal reason on failure (too large, no worksheets,
   *  clipboard unavailable); never partially copies. */
  copyWorkbookToClipboard: (workbookId: string) => Promise<void>;
  /** Is there a compatible workbook package on the clipboard right now?
   *  `false` covers "no bridge", "not our format", and "clipboard read
   *  denied" alike — a UI Paste command gates on this rather than guessing.
   *  Group F: a large-workbook DESCRIPTOR counts only while it is unexpired
   *  and of a supported version (checked locally, never fetched) — an
   *  expired one could only be refused, like an incompatible inline package.
   *  NOTE (2026-09-15): no production caller reads it yet. The shipped Paste
   *  command (`commands/workbookTransferCommands.ts`) is unconditionally
   *  enabled and there is no paste shortcut, so the "must not toast / must
   *  not flip a menu item falsely disabled" contract below is currently held
   *  only by this slice's own tests. It is stated as the contract a future
   *  gate must meet, not as a description of a live one. */
  canPasteWorkbook: () => Promise<boolean>;
  /** Paste — read the clipboard, validate the package, and land a fresh-id
   *  workbook + its members at `targetFolderId` (undefined = Library root).
   *  Leaves the project COMPLETELY untouched on any failure (bad/missing
   *  clipboard content, wrong format/version) — see this module's header.
   *  One history entry on success. */
  pasteWorkbookFromClipboard: (targetFolderId?: string) => Promise<void>;
  /** Duplicate — the same-project fast path (frozen-scope item 6): shares
   *  the identical build -> (JSON round trip) -> fresh-id-rewrite core as
   *  Copy/Paste, landing the duplicate in the SAME folder as the source
   *  workbook. Returns the new workbook's id, or `null` on refusal. */
  duplicateWorkbook: (workbookId: string) => Promise<string | null>;
}

export function createWorkbookTransferSlice(set: SliceSet, get: SliceGet): WorkbookTransferSlice {
  const ctx = { set, get, fail, figureId: nextFigureId };
  return {
    copyWorkbookToClipboard: async (workbookId) => {
      const workbook = get().workbooks.find((w) => w.id === workbookId);
      const name = workbook?.name ?? "workbook";
      const hasPending = get().datasets.some((d) => d.workbookId === workbookId && d.pending);
      if (hasPending) {
        get().setStatus(`resolving worksheets before copying "${name}"…`);
        try {
          await get().resolvePendingDatasets();
        } catch (e) {
          fail(get, `copy "${name}" failed — couldn't load every worksheet: ${e instanceof Error ? e.message : "error"}`);
          return;
        }
      }
      // Start the build and the clipboard write TOGETHER, the write first —
      // see `buildForCopy` above. A refusal from the build is reported in
      // preference to the write's own `false`, because it is the specific
      // reason; "clipboard unavailable" is only ever the fallback wording.
      const build = buildForCopy(workbookId, name, get);
      const wrote = await copyTextAsync(build.then((b) => b.text));
      let built: CopyBuilt;
      try {
        built = await build;
      } catch (e) {
        fail(get, e instanceof Error ? e.message : `copy "${name}" failed: error`);
        return;
      }
      if (!wrote) {
        // A package already stored for a descriptor that never reached the
        // clipboard is unreachable: drop it now rather than let it hold
        // transfer-store room until it expires (Group F).
        void built.discard?.();
        fail(get, `copy "${name}" failed: clipboard unavailable`);
        return;
      }
      const n = built.pkg.datasets.length;
      get().setStatus(`copied "${name}" (${n} worksheet${plural(n)})${built.note ?? ""}`);
      toast(`copied "${name}"`, "ok");
    },

    canPasteWorkbook: async () => {
      try {
        const text = await navigator.clipboard?.readText();
        if (typeof text !== "string") return false;
        // Not `transferRun()`: this probe answers a plain boolean and must
        // never toast — a Paste command merely asking "is anything pastable?"
        // has not failed at anything the user did.
        return (await import("../lib/workbookTransfer")).canPasteText(text);
      } catch {
        return false;
      }
    },

    pasteWorkbookFromClipboard: async (targetFolderId) => {
      let text: string;
      try {
        const read = await navigator.clipboard?.readText();
        if (typeof read !== "string") {
          fail(get, "paste workbook: clipboard unavailable");
          return;
        }
        text = read;
      } catch {
        fail(get, "paste workbook: clipboard read denied");
        return;
      }
      const run = await transferRun(get, "paste workbook");
      if (run) await run.pasteWorkbook(ctx, text, targetFolderId);
    },

    duplicateWorkbook: async (workbookId) => {
      const workbook = get().workbooks.find((w) => w.id === workbookId);
      const name = workbook?.name ?? "workbook";
      const hasPending = get().datasets.some((d) => d.workbookId === workbookId && d.pending);
      if (hasPending) {
        get().setStatus(`resolving worksheets before duplicating "${name}"…`);
        try {
          await get().resolvePendingDatasets();
        } catch (e) {
          fail(get, `duplicate "${name}" failed — couldn't load every worksheet: ${e instanceof Error ? e.message : "error"}`);
          return null;
        }
      }
      const run = await transferRun(get, `duplicate "${name}"`);
      return run ? run.duplicateWorkbook(ctx, workbookId, name, workbook?.folderId) : null;
    },
  };
}
