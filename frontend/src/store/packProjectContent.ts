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

import { lastBookError } from "../lib/bookData";
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
      // `workbookTransfer.ts:191`/`:256`), which each spell it out inline —
      // there is no shared helper to reuse. Names the book when a reason was
      // actually recorded for it (review finding #5) — `lib/bookData.ts`'s
      // `lastBookError`, the same lookup `workbookTransfer.ts:195-196`
      // already uses for its own refusal. `e` is only the FIRST rejection
      // `Promise.all` surfaces and carries no id/name of its own; a still-
      // `pending` dataset with a recorded error is what does.
      const failed = useApp
        .getState()
        .datasets.find((d) => d.pending !== undefined && lastBookError(d.id, d.pending) !== null);
      const detail = e instanceof Error ? e.message : "error";
      return {
        ok: false,
        message: failed
          ? `pack failed — couldn't load full data for every book: "${failed.name}" — ${detail}`
          : `pack failed — couldn't load full data for every book: ${detail}`,
      };
    }
    // Nit 1: the transient "fetching…" status must not linger once every
    // book requested above has actually arrived — mirrors the Save
    // sibling's own habit of always ending on a terminal status
    // (workspaceIO.ts's `msg`/`setStatus(msg)` pairs on each success path),
    // even though this function's own "success" is only "the payload is
    // ready", not "the pack finished" (that lives in the pack panel's own
    // `phase`, not the app status line). Overwritten immediately below by
    // `refusePack`'s own status if the re-check just past this still
    // refuses.
    useApp.getState().setStatus(pendingCount === 1 ? "book loaded — packing…" : `${pendingCount} books loaded — packing…`);
  }
  const s = useApp.getState();
  if (s.datasets.some((d) => d.pending)) {
    // Review finding #2: caught here, not in the `catch` above, because
    // nothing threw — every book pending BEFORE this call resolved fine;
    // this one started pending only DURING the await this function itself
    // awaited, so `resolvePendingDatasets` never had a reason to touch it.
    return {
      ok: false,
      message: "pack failed — couldn't load full data for every book: a book was still loading",
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
