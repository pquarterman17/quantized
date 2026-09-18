// L1.4 drag/drop parity for the Details renderer — and, since 2026-09-13, for
// the TILE workspace too (LIBRARY_WORKBOOK_UX_PLAN). Nothing in this contract
// is Details-shaped: it decides from the node KIND and the store's published
// `activeDrag`, never from a <tr>, a column, or a table. `useTileDragDrop.ts`
// is therefore an import surface over this hook, not a second copy of it — the
// file name is kept (and the exported names with it) so this module's history
// stays readable, but read "Details" below as "the two flat renderers".
//
// The Tree's drag contract, which this reuses verbatim rather than restating:
//   * The dataTransfer TYPES are `dnd.ts`'s three (`FOLDER_DND`,
//     `WORKBOOK_DND`, `DATASET_DND`) — so a Details drag and a Tree drag are
//     indistinguishable to every existing drop target (a Details worksheet
//     can be dropped on a plot window exactly like a Tree one, and a Details
//     workbook can be dropped on a TREE folder row).
//   * A drag may only start from the dedicated `.qzk-drag-handle` grip
//     (GUI_INTERACTION #13 sub-item 1) — never the row body, whose click is
//     select and whose double-click is open.
//   * `activeDrag` is published so every legal drop target can light up at
//     REST (#3 sub-item 2b), not only the one under the pointer: this hook
//     returns FolderRow's two cue classes with FolderRow's two meanings —
//     `drop-candidate` (dashed: this row would accept the drag in flight) on
//     every legal target, `dropinto` (solid: this is where it would land) on
//     the row actually hovered. shell.css carries the Details-scoped rules.
//   * The MOVE itself is `moveFolder` / `moveWorkbookToFolder` — the same two
//     store actions `FolderRow`'s drop and the "Move to …" menu items call.
//     There is no Details-specific move path.
//
// Two deliberate differences from `FolderRow`'s drop target, both forced by
// what a Details table IS:
//   1. "Into" only — no above/below reposition zones. Details is a FLAT,
//      user-sortable projection whose sort never mutates canonical manual
//      order (PR D), so "drop above this row" has no stable meaning to
//      commit; offering it would write a manual reorder the visible order
//      does not reflect. Reposition stays a Tree gesture.
//   2. A WORKSHEET is a drag source but never a drop target, because folder
//      placement is owned by the WORKBOOK, not by any one worksheet's own
//      `folderId` (see dnd.ts's WORKBOOK_DND note). Its drag is the
//      plot-target `DATASET_DND` the Tree row publishes, not a move.
//
// Every store read lives in `useDetailsDragDropContext`, which the TABLE
// calls once and passes down (review round: the per-row hook held five
// subscriptions, so a 40-row window carried 200). The per-row hook keeps only
// its own hover flag.
//
// SECOND review round (2026-09-13, finding 3): a drag must survive its own
// SOURCE unmounting. Both flat renderers window their rows/tiles, so
// scrolling the dragged node out of the rendered window is the routine case
// virtualization exists for, not an edge case — and the first cut of this fix
// cancelled the drag right there (a per-row effect that cleared `activeDrag`
// on unmount if the node owned it), which meant every folder silently
// refused the drop the instant its source scrolled out of view. The cancel
// moved ONCE to the CONTAINER (`useDetailsDragDropContext`, called once per
// table/grid, never per row): CAPTURE-phase `document` `dragend` and `drop`
// listeners, installed only while a drag is in flight. Capture (not bubble)
// matters — a legal drop's own handler calls `event.stopPropagation()` once
// it commits the move (so a refused, ancestor-scoped drop target never sees
// a drop meant for a more specific one), which would stop a bubble-phase
// document listener from ever running for the success case; capture runs
// top-down, before that target is even reached, so it cannot be skipped by
// anything a descendant's handler does later in the same dispatch.
//
// That `dragend`/`drop` catch covers a drag whose relevant element — the
// drop target (a `drop` always fires on a live, visible target), or a
// source whose own row/tile is still mounted (its `dragend` bubbles like any
// other) — is attached to `document`. It does NOT cover a `dragend` fired at
// a source that has since unmounted: a detached node's event has no
// ancestor chain left to bubble through, so it never reaches `document` at
// all. An abandoned drag (released over nothing, after its source scrolled
// out) therefore still leaked `activeDrag` — the cosmetic version of the
// original bug, a stale drop-candidate cue on every legal folder until the
// next `dragstart` — which the round-2 fix and its own test did not
// actually prove closed (that test dispatched `dragend` AT `document`,
// begging the question it was meant to settle).
//
// THIRD review round (2026-09-14, finding 1): the round-2 fix's premise did
// not hold. "A user agent suppresses `pointermove` for as long as a drag is
// under way" is true of the HTML Standard's device-input suppression for
// MOUSE, but Pointer Events' own suppression is a one-shot `pointercancel`
// / `pointerout` / `pointerleave` fired once at drag start — nothing in it
// bars a later `pointermove`, and Chromium keeps the pointer stream live for
// the WHOLE operation on touch and pen (measured cross-engine in
// whatwg/html#11771). A `pointermove` catch therefore cleared `activeDrag`
// mid-drag on those pointer types: the specific target's `legalDrag` check
// closes over `activeDrag` at render time, so once it went null the target
// stopped calling `preventDefault()` on `dragover` and the browser refused
// the drop outright — worse than the stale cue this was fixing. Removed.
//
// Replacement, round 3: a CAPTURE-phase `pointerdown` listener on `document`,
// live only while `activeDrag != null`, cleared it whenever `event.isPrimary
// !== false`. ROUND 4 found that filter still wrong, for the same shape of
// reason round 3 found the `pointermove` catch wrong: `isPrimary` is defined
// PER POINTER TYPE (the first active pointer of each type is primary), not
// "the pointer driving this interaction" — a mouse pointer is always
// primary, so on a hybrid device (touchscreen laptop, pen display) a live
// mouse drag is still ended by the user's very first finger touching the
// screen, because that touch is primary for its own type. Measured in-repo
// (tiles_review4.md probe P1): a `PointerEvent("pointerdown", {pointerType:
// "touch", isPrimary: true})` mid-drag cleared `activeDrag` and the drop was
// refused exactly as the removed `pointermove` catch refused it — a smaller
// blast radius (needs a second input modality, not just any drag) but the
// same category of bug. Removed.
//
// ROUND 4 replacement: the SAME listener shape — one ALWAYS-live capture-
// phase `pointerdown` listener on `document`, registered once in this hook's
// effect and not re-gated on `activeDrag` — but the STRICT same-pointer rule
// instead of `isPrimary`: it recorded the `{pointerId, pointerType}` of every
// press, and cleared `activeDrag` when the incoming press's id AND type both
// matched the PREVIOUSLY recorded press. — premise disproved and this
// mechanism REMOVED in ROUND 5 below: the rule "the pointer holding the drag
// cannot satisfy its own rule" is true, but round 5 found the comparison
// target was wrong — it compared against whichever pointer happened to press
// immediately before the incoming one, not against the pointer that started
// the drag. A different, non-dragging pointer that presses twice in a row
// (two mouse clicks, whose id stays constant across presses) matched itself
// and cleared a drag it had not touched — measured in-repo (tiles_review5.md
// probe P3): a live touch drag was killed by two consecutive mouse clicks
// fired between `dragover` and `drop`, and this round's own "different
// pointer" test had locked in that counterexample as intended behaviour.
//
// ROUND 5 replacement: the same listener shape again, but the comparison
// target changes from "the immediately preceding press" to "the press
// recorded when THIS drag started" — a `dragPress` snapshot this hook took in
// its own `onDragStart`, matched against instead of whatever pressed right
// before the incoming press. That closed the round-5 counterexample, but it
// put the snapshot in the WRONG PLACE, which ROUND 6 measured: see below.
//
// ROUND 5 also closes a separate, latent gap (finding 4): a dispatch that is
// not a real `PointerEvent` — a plain `new Event("pointerdown")`, say —
// carries no numeric `pointerId`, and two such dispatches compared equal to
// each other under the old check (`undefined === undefined`). Any press whose
// `pointerId` is not a `number` is ignored before it can be recorded or
// matched. That guard now lives in `lib/lastPointerPress.ts`, the one place a
// press is ever recorded, so `PointerPress.id` is a real number by
// construction and nothing downstream re-derives the check. Nothing under
// `frontend/src` outside tests dispatches a synthetic `pointerdown` today, so
// this was latent, not live.
//
// ROUND 6 (2026-09-14, finding 1): round 5's `dragPress` was an ownership
// snapshot that nothing validated against the drag it claimed to own. This
// hook's own `onDragStart` was its only writer, while `activeDrag` has FIVE
// publishers — `FolderRow.tsx`, `WorkbookRow.tsx` and `DatasetRowParts.tsx`
// publish into the same store field, and the Tree is virtualized exactly like
// the flat renderers, so a Tree drag can be abandoned in precisely the way
// this mechanism exists to recover from. Two measured consequences: an
// abandoned Tiles drag left a snapshot with no owning drag, and the next
// Tree-published drag INHERITED it — one press from the abandoned drag's
// pointer then refused a live, unrelated drop (review probe N1); and a
// Tree-published drag recorded no snapshot at all, so nothing could ever
// self-heal its stale cue (probe N2). "Every publisher must remember to call
// `noteDragPointer`" is an invariant nothing enforced.
//
// ROUND 6 fix: the press record moved NEXT TO `activeDrag` in the store.
// `lib/lastPointerPress.ts` owns one always-live capture-phase `pointerdown`
// recorder on `document`, and `setActiveDrag` (store/libraryPanel.ts) reads it
// into `activeDragPress` in the SAME `set()` that publishes the drag. One
// publish path now sets both, so no publisher can skip it, no snapshot can
// outlive its drag, and replacing a drag replaces its press. This hook's
// `lastPress`/`dragPress` refs and `noteDragPointer` are gone; its
// capture-phase `pointerdown` listener now reads the live `activeDrag` /
// `activeDragPress` pair from the store and clears the drag only when the
// incoming press equals `activeDragPress`.
//
// The rule in plain words: the store remembers which pointer pressed last
// before a drag was published; a later press from that same pointer clears the
// drag; every other press is ignored by this mechanism; a drag published with
// no prior press has no owner press and is ended only by `dragstart`,
// `dragend` or `drop`.
//
// Residuals (honest, named, not closed):
//   * On touch and pen the browser hands out a fresh `pointerId` per contact,
//     so an abandoned drag's stale cue does not self-heal on the user's next
//     press of that modality — clearing it still needs a `dragstart`,
//     `dragend` or `drop`.
//   * The module-level press record is never invalidated. It is not "null
//     until a drag starts": once this page has seen one press, a `dragstart`
//     with no press of its own INHERITS the last press the recorder saw —
//     which for a pointer-initiated drag is the dragging pointer, and for a
//     programmatic or synthetic one is an unrelated pointer that may press
//     again and end the drag (review finding 2; the round-5 header's claim
//     that the snapshot is null in that case was wrong).
//   * The owner press is the last press recorded before the drag was
//     published, NOT the press that started the drag — those two differ
//     whenever another pointer presses between the dragging pointer's own
//     `pointerdown` and its `dragstart` (a hybrid device, inside the
//     initiation window): that other pointer is recorded as the owner
//     instead, and its next press clears the drag (measured, review round 7
//     probe B1). Not closed in code: the only invariant-free fix visible is
//     tracking which pointers are still DOWN at publish time and preferring
//     one of those, and that collides with the pointercancel-at-dragstart
//     behaviour ROUND 3 above records (Pointer Events fires `pointercancel`
//     for the dragging pointer at drag start, so the down-set can be empty
//     exactly when it would be needed).

import { useCallback, useEffect, useState } from "react";

import { DATASET_DND, FOLDER_DND, WORKBOOK_DND } from "./dnd";
import { isSelfOrDescendant } from "../../lib/foldertree";
import type { LibraryNode } from "../../lib/libraryHierarchy";
import type { FolderNode } from "../../lib/types";
import type { WorkbookNode } from "../../lib/workbooks";
import { useApp } from "../../store/useApp";
import { getLibraryState, useLibraryStore } from "../../store/hooks/useLibraryStore";
import type { ActiveDrag } from "../../store/libraryPanel";

/** The dataTransfer type a node kind drags as, paired with the `activeDrag`
 *  kind it publishes — or null when the kind has no drag source in the Tree
 *  either (folders/workbooks/worksheets do; the five artifact kinds do not,
 *  so Details offers no grip for them). A worksheet publishes
 *  `kind: "dataset"` because `ActiveDrag` predates the hierarchy's
 *  "worksheet" naming (store/libraryPanel.ts). */
function dragSourceOf(node: LibraryNode): { type: string; drag: ActiveDrag["kind"] } | null {
  if (node.kind === "folder") return { type: FOLDER_DND, drag: "folder" };
  if (node.kind === "workbook") return { type: WORKBOOK_DND, drag: "workbook" };
  if (node.kind === "worksheet") return { type: DATASET_DND, drag: "dataset" };
  return null;
}

export interface DetailsDragDropContext {
  activeDrag: ActiveDrag | null;
  setActiveDrag: (drag: ActiveDrag | null) => void;
  // Mutable, not `readonly`: `isSelfOrDescendant` takes `FolderNode[]`.
  folders: FolderNode[];
  /** Only `folderId` is read, and only at drop time, to refuse a move to the
   *  folder the workbook is already in. Subscribed (not `getState()`) because
   *  `getState()` anywhere under components/ counts against
   *  architecture.test.ts's getState()-in-render ratchet, which sits at its
   *  pin — and at ONE subscription for the whole table it is not worth a
   *  ratchet move. */
  workbooks: readonly WorkbookNode[];
  moveFolder: (id: string, newParentId: string | null, beforeId?: string) => void;
  moveWorkbookToFolder: (id: string, folderId: string | null) => void;
}

/** ONE subscription set for the whole table. `folders`/`workbooks` and
 *  `activeDrag` must be subscribed rather than read imperatively: legality is
 *  computed in the render body, and a `getState()` there would freeze the
 *  folder tree at the render that happened to precede the drag
 *  (architecture.test.ts's getState()-in-render ratchet). The two move
 *  actions are stable identities, so they add no rerenders.
 *
 *  Also owns the CONTAINER-level terminal-signal catch — see the file header
 *  above (findings 3, 1, and ROUNDs 4-6) for the full contract: a
 *  CAPTURE-phase `document` `dragend`/`drop` pair, live only while
 *  `activeDrag` is non-null, plus a SEPARATE, ALWAYS-live capture-phase
 *  `pointerdown` listener that clears `activeDrag` only when the press
 *  matches (same `pointerId` AND `pointerType`) the store's
 *  `activeDragPress` — the press `setActiveDrag` snapshotted when the LIVE
 *  drag was published. Not `isPrimary` (round 4 found that unsafe), not the
 *  immediately preceding press (round 5 found that unsafe too), and not a
 *  snapshot this hook keeps for itself (round 6 found that unsafe as well —
 *  four of the five `activeDrag` publishers never wrote one). The per-row
 *  `onDragEnd` still fires too when its element survives; it is redundant
 *  with, not a third mechanism alongside, these.
 *
 *  This hook is called once per mounted flat-renderer instance
 *  (`LibraryWorkspace` and `LibraryDetails` each have their own call site,
 *  and both can be mounted at once), so each instance registers its own
 *  listener. Harmless: they read the same store fields and reach the same
 *  verdict, and a redundant `setActiveDrag(null)` from a second instance is a
 *  no-op on an already-null store field. */
export function useDetailsDragDropContext(): DetailsDragDropContext {
  const setActiveDrag = useLibraryStore((s) => s.setActiveDrag);
  const activeDrag = useLibraryStore((s) => s.activeDrag);
  const folders = useApp((s) => s.folders);
  const workbooks = useApp((s) => s.workbooks);
  const moveFolder = useApp((s) => s.moveFolder);
  const moveWorkbookToFolder = useApp((s) => s.moveWorkbookToFolder);

  // A plain wrapper, not a mechanism: `dragend`/`drop` listeners are called
  // with an Event, which must not reach `setActiveDrag`'s `drag` parameter.
  // Clearing the owner press is `setActiveDrag`'s own job now (ROUND 6).
  const clearDrag = useCallback((): void => setActiveDrag(null), [setActiveDrag]);

  useEffect(() => {
    if (activeDrag == null) return;
    // Capture phase (the `true` third argument) — see the file header:
    // it runs before any specific drop target's own handler, so a
    // committed move's `event.stopPropagation()` cannot suppress it.
    document.addEventListener("dragend", clearDrag, true);
    document.addEventListener("drop", clearDrag, true);
    return () => {
      document.removeEventListener("dragend", clearDrag, true);
      document.removeEventListener("drop", clearDrag, true);
    };
  }, [activeDrag, clearDrag]);

  // ROUND 4/5/6: a SEPARATE, ALWAYS-live listener — registered once,
  // independent of `activeDrag`, so it can end a drag whose source element no
  // longer exists. RECORDING the press is not its job (lib/lastPointerPress.ts
  // does that, for every press, whether or not this hook is mounted); its only
  // job is to ask whether this press is the one the live drag was published
  // under.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      // An event listener, not a render body: reading the pair imperatively is
      // the point — it must be the LIVE drag and ITS press, not whatever they
      // were at the render that installed this listener.
      const { activeDrag: live, activeDragPress: owner } = getLibraryState();
      // `owner.id` is a real number (lib/lastPointerPress.ts never records a
      // non-numeric `pointerId`), so a plain `new Event("pointerdown")` — whose
      // `pointerId` is `undefined` — can never match one.
      if (live == null || owner == null) return;
      if (event.pointerId === owner.id && event.pointerType === owner.type) clearDrag();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [clearDrag]);

  return {
    activeDrag,
    setActiveDrag,
    folders,
    workbooks,
    moveFolder,
    moveWorkbookToFolder,
  };
}

export interface DetailsDragDrop {
  /** Props for the row's `.qzk-drag-handle` grip, or null when this kind has
   *  no drag source. */
  handleProps: {
    draggable: true;
    onDragStart: (event: React.DragEvent) => void;
    onDragEnd: () => void;
    onClick: (event: React.MouseEvent) => void;
    onDoubleClick: (event: React.MouseEvent) => void;
  } | null;
  /** Props for the row itself as a drop target — empty for every kind but
   *  folder, and inert for a folder that is not a legal destination. */
  rowProps: {
    onDragOver?: (event: React.DragEvent) => void;
    onDragLeave?: () => void;
    onDrop?: (event: React.DragEvent) => void;
  };
  /** The cue class this row should carry, or null — see the header note.
   *  `dropinto` beats `drop-candidate` on the hovered row, exactly as
   *  FolderRow's `isDropCandidate && !dropZone` guard arranges. */
  dropCue: "dropinto" | "drop-candidate" | null;
}

export function useDetailsDragDrop(node: LibraryNode, ctx: DetailsDragDropContext): DetailsDragDrop {
  const { activeDrag, setActiveDrag, folders, workbooks, moveFolder, moveWorkbookToFolder } = ctx;
  const [hovered, setHovered] = useState(false);

  const source = dragSourceOf(node);
  const handleProps = source
    ? {
        draggable: true as const,
        onDragStart: (event: React.DragEvent): void => {
          event.stopPropagation();
          event.dataTransfer.setData(source.type, node.entityId);
          event.dataTransfer.effectAllowed = "move";
          // One call publishes the drag AND its owner press (ROUND 6) — this
          // source has no press bookkeeping of its own to forget, and neither
          // does any Tree row.
          setActiveDrag({ kind: source.drag, id: node.entityId });
        },
        onDragEnd: (): void => setActiveDrag(null),
        // The grip is not a select/open target (Tree convention) — neither on
        // one click nor on two.
        onClick: (event: React.MouseEvent): void => event.stopPropagation(),
        onDoubleClick: (event: React.MouseEvent): void => event.stopPropagation(),
      }
    : null;

  if (node.kind !== "folder") return { handleProps, rowProps: {}, dropCue: null };
  const folderId = node.entityId;

  // Only the drag KIND is readable during dragover (the payload is
  // drop-only), so legality for a folder-onto-folder drag is decided from
  // the store's published `activeDrag` — exactly how FolderRow decides
  // whether to light itself up. A workbook may land in any folder; a folder
  // may not land in itself or in its own descendant. `isSelfOrDescendant`
  // walks up from THIS folder and returns true the moment it meets the
  // dragged id, so the identity case (dropped on itself) is already covered
  // and needs no separate clause.
  // `legalDrag` is a RENDER-TIME closure over `activeDrag`, and a committed
  // drop's correctness depends on that: the container-level catch (file
  // header) nulls the store before this target's own `onDrop` runs, so if
  // this ever became a live `getState()` read instead, every legal drop
  // would incorrectly refuse itself.
  const legalDrag =
    activeDrag != null
    && (activeDrag.kind === "workbook"
      || (activeDrag.kind === "folder" && !isSelfOrDescendant(folders, activeDrag.id, folderId)));

  return {
    handleProps,
    dropCue: !legalDrag ? null : hovered ? "dropinto" : "drop-candidate",
    rowProps: {
      onDragOver: (event: React.DragEvent): void => {
        const types = event.dataTransfer.types;
        if (!types.includes(WORKBOOK_DND) && !types.includes(FOLDER_DND)) return;
        if (!legalDrag) return;
        event.preventDefault();
        if (!hovered) setHovered(true);
      },
      onDragLeave: (): void => setHovered(false),
      // Review round: this handler re-decides everything for itself. It never
      // consults `hovered` (the flag dragover sets), so a `drop` that arrives
      // with no preceding dragover — a synthetic event, or a browser that lost
      // it — is held to exactly the same rules; and it refuses a drop onto the
      // container the dragged node is ALREADY in, because both store actions
      // record their undo step BEFORE doing anything and a no-op move would
      // leave a do-nothing entry on the history stack.
      onDrop: (event: React.DragEvent): void => {
        setHovered(false);
        const types = event.dataTransfer.types;
        if (!types.includes(WORKBOOK_DND) && !types.includes(FOLDER_DND)) return;
        // The SAME predicate `onDragOver` applies, not a flag it set: with no
        // drag in flight (`activeDrag == null`) nothing is legal here.
        if (!legalDrag) return;
        if (types.includes(WORKBOOK_DND)) {
          const id = event.dataTransfer.getData(WORKBOOK_DND);
          if (!id) return;
          const workbook = workbooks.find((w) => w.id === id);
          if (!workbook || (workbook.folderId ?? null) === folderId) return;
          event.preventDefault();
          event.stopPropagation();
          moveWorkbookToFolder(id, folderId);
          return;
        }
        const draggedId = event.dataTransfer.getData(FOLDER_DND);
        // Dropped on itself, on its own descendant, or back into the parent it
        // already has: a no-op, NOT a move — `moveFolder` would refuse the
        // cycle (or reparent to where it already is) only after recording the
        // undo step. (`isSelfOrDescendant` covers the identity case, see
        // above; it is re-checked here against the PAYLOAD, which `activeDrag`
        // is not a substitute for.)
        if (!draggedId || isSelfOrDescendant(folders, draggedId, folderId)) return;
        const dragged = folders.find((f) => f.id === draggedId);
        if (!dragged || dragged.parentId === folderId) return;
        event.preventDefault();
        event.stopPropagation();
        moveFolder(draggedId, folderId);
      },
    },
  };
}
