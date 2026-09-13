// What a pack actually SENDS — the workspace-content half of
// store/packProjectRun.ts, extracted when BUG-011's resolve-before-serialize
// step pushed that module to 2 lines under the 500-line ceiling (the "extract
// a cohesive sibling, never raise the pin" rule). This is one concern, shared
// by both entry points: preview and "Start pack" derive their content the
// same way, so they can only ever disagree because the project actually
// changed in between.
//
// Not in the eager bundle for the same reason its parent isn't: the store
// `import()`s packProjectRun.ts on the click, and this comes with it.

import { lastBookError, truncateReason } from "../lib/bookData";
import { serializeWorkspace } from "../lib/workspaceSerialize";
import { packError, type PackProjectState } from "./packProject";
import { toast } from "./toasts";
import { useApp } from "./useApp";

// Named `SetPack`, not `Set` (BUG-011 review nit 5): a bare `type Set`
// shadows the global `Set` collection type for the rest of this file —
// harmless today (nothing here needs the real `Set`), but worth not
// inheriting a footgun just because `packProjectRun.ts`'s own local alias
// has the same name.
type SetPack = (partial: Partial<PackProjectState>) => void;

/** Either the serialized workspace, or the reason packing must be refused.
 *  A refusal is never "pack the preview anyway" — see
 *  `serializeCurrentWorkspaceForPack`'s doc. */
export type PackContent = { ok: true; content: string } | { ok: false; message: string };

/** BUG-011: resolve every PENDING lazy book before serializing, exactly as
 *  `store/workspaceIO.ts`'s `prepareWorkspaceState` (its resolve call is
 *  line 73, its abort block lines 69-80) and `store/workbookTransfer.ts`'s
 *  two export paths do. A `pending` dataset's `data` is the backend's
 *  DOWNSAMPLED PREVIEW, not the book — serializing it would write decimated
 *  rows into the packed project as if they were the real measurement, and
 *  hand the recipient a self-contained bundle with no way to tell. Both
 *  entry points that reach this (the pack PREVIEW and the "Start pack"
 *  action) abort on a resolve failure rather than pack what they have.
 *
 *  The store is re-read AFTER the await: `resolvePendingDatasets` replaces
 *  the dataset objects, so a snapshot captured before it would still be the
 *  preview-carrying one this function exists to avoid. That re-read is ALSO
 *  what review finding #2 closes: `resolvePendingDatasets` only awaits the
 *  books that were pending when IT was called, and a lazy import can land a
 *  brand-new pending dataset while that `Promise.all` is still in flight —
 *  so the fresh read below is re-checked for `pending`, not merely used to
 *  build the payload, and refuses rather than pack a book the resolve step
 *  never even knew to wait for. */
export async function serializeCurrentWorkspaceForPack(): Promise<PackContent> {
  const pendingCount = useApp.getState().datasets.filter((d) => d.pending).length;
  if (pendingCount > 0) {
    useApp.getState().setStatus(`fetching ${pendingCount} book${pendingCount === 1 ? "" : "s"} before packing…`);
    try {
      await useApp.getState().resolvePendingDatasets();
    } catch (e) {
      // Same sentence shape as the two siblings (`workspaceIO.ts:75`,
      // `store/workbookTransfer.ts:191`/`:262`), which each spell it out
      // inline — there is no shared helper to reuse. Names the book when a
      // reason was actually recorded for it (review finding #5) — but round
      // 2 finding #5 caught that this only adopted HALF of the sibling's
      // pattern: the NAME came from the lookup below, while the REASON still
      // came from `e`, and `e` is only the FIRST rejection `Promise.all`
      // surfaces — a DIFFERENT book's error than the one named, whenever a
      // still-pending dataset with a stale recorded error (from an EARLIER
      // attempt; `lib/bookData.ts`'s `_bookErrors` is cleared only on
      // success) sorts earlier in `datasets` order than whichever book
      // actually caused THIS rejection. Both name and reason now come from
      // the SAME lookup, `lib/bookData.ts`'s `lastBookError`, exactly as
      // `lib/workbookTransfer.ts:195-196` already does for its own refusal
      // — including that function's own `truncateReason` (an unbounded, or
      // FastAPI-422-array-shaped, backend `detail` has no business in a
      // one-line refusal). With two or more failing books, only the FIRST
      // one in `datasets` order is named — same rule as
      // `lib/workbookTransfer.ts:184`'s own "naming the first such book in
      // `datasets` order" — never every book that failed. Round 3 nit 5: this
      // still names the first PENDING book with ANY recorded reason, which
      // need not be the book whose fetch caused THIS `Promise.all` rejection
      // — a merely-slow book with a stale reason from an earlier attempt can
      // still sort first. Self-consistent (the quoted reason is always that
      // book's own), but the named cause can be a red herring; narrowing to
      // "the book that failed on THIS attempt" is a separate, judgment-call
      // fix left open rather than folded in here.
      const failed = useApp
        .getState()
        .datasets.find((d) => d.pending !== undefined && lastBookError(d.id, d.pending) !== null);
      const reason = failed?.pending ? lastBookError(failed.id, failed.pending) : null;
      const detail = e instanceof Error ? e.message : "error";
      return {
        ok: false,
        message:
          failed && reason
            ? `pack failed — couldn't load full data for every book: "${failed.name}" — ${truncateReason(reason)}`
            : `pack failed — couldn't load full data for every book: ${detail}`,
      };
    }
    // Nit 1 / round 2 nit 3: matches its own "fetching N book(s)…"
    // counterpart above — always naming the count, never dropping it to a
    // bare "book loaded" in the singular case. The status is superseded
    // again, honestly, before either caller's own real terminal point is
    // reached: `runPreviewPackProject` and `pollOnce`'s `completed` branch
    // (`packProjectRun.ts`) both call `notePackOutcome` below once they
    // actually know the outcome, rather than leaving this "packing…"
    // in-flight claim standing into `awaiting_confirmation` or `completed`
    // (round 2 finding N1/F3) — and it is overwritten immediately below by
    // `refusePack`'s own status if the re-check just past this still
    // refuses.
    useApp.getState().setStatus(`${pendingCount} book${pendingCount === 1 ? "" : "s"} loaded — packing…`);
  }
  const s = useApp.getState();
  const stillPending = s.datasets.find((d) => d.pending);
  if (stillPending) {
    // Review finding #2: caught here, not in the `catch` above, because
    // nothing threw — every book pending BEFORE this call resolved fine;
    // this one started pending only DURING the await this function itself
    // awaited, so `resolvePendingDatasets` never had a reason to touch it.
    // Round 2 nit 5: names the book — the datum was already sitting right
    // there in the predicate above, immediately below the F5 change whose
    // whole point was naming the OTHER refusal's book.
    return {
      ok: false,
      message: `pack failed — couldn't load full data for every book: "${stillPending.name}" was still loading`,
    };
  }
  // No `projectDir` here on purpose: the content sent to the backend
  // always names its ORIGINAL absolute source paths (`kind: "path"`) —
  // `pack_project`'s own `rewrite_payload_for_bundle` is what turns the
  // packed sources into `kind: "bundle"` entries; this is a different
  // concern from a native Save's own bundle-relative round trip.
  return { ok: true, content: serializeWorkspace({ ...s, plotWindows: s.windowsForSave() }) };
}

/** The shared abort for a refused `serializeCurrentWorkspaceForPack` —
 *  a named `pending_unresolved` error in the pack panel PLUS the status
 *  line and danger toast the sibling save path raises, so the refusal is
 *  visible whether or not the pack panel is on screen. Never reached with
 *  a bridge call already made: both callers refuse BEFORE touching the
 *  bridge, so `NOTHING_MODIFIED_NOTE` holds literally. */
export function refusePack(set: SetPack, message: string): void {
  useApp.getState().setStatus(message);
  toast(message, "danger");
  set({ phase: "failed", errors: [packError("pending_unresolved", message)] });
}

/** Round 2 finding N1/F3: a real OUTCOME for the app status line, never the
 *  in-flight "…packing…" claim `serializeCurrentWorkspaceForPack` sets while
 *  it is still fetching. `packProjectRun.ts` calls this at the two points
 *  that claim was found lingering past — the preview reaching
 *  `awaiting_confirmation` (nothing has been copied yet) and `pollOnce`'s
 *  `completed` branch (the pack actually finished) — kept HERE rather than
 *  in that module so its own documented boundary holds: `packProjectRun.ts`
 *  never touches `useApp` directly, only through this sibling. */
export function notePackOutcome(message: string): void {
  useApp.getState().setStatus(message);
}

export function deriveProjectName(): string {
  const name = useApp.getState().currentProject?.name;
  if (!name) return "workspace";
  return name.replace(/\.(dwk|json)$/i, "") || "workspace";
}

/** A comparable fingerprint of serialized workspace content that ignores
 *  `serializeWorkspace`'s own `savedAt` stamp — `savedAt` is a FRESH
 *  timestamp on every single call, so a raw string compare between two
 *  serializations of the IDENTICAL workspace would always read as
 *  "changed" purely from the clock, never actually detecting a real edit.
 *  Never throws: malformed input (never produced by our own serializer,
 *  but defensive regardless) falls back to the raw string, which still
 *  degrades safely to "treat as different" rather than crashing. */
export function contentFingerprint(content: string): string {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    delete parsed.savedAt;
    return JSON.stringify(parsed);
  } catch {
    return content;
  }
}
