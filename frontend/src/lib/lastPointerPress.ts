// The last physical pointer press the document saw — one module-level record,
// written by one always-live CAPTURE-phase `pointerdown` listener.
//
// Why it lives here and not in a component: the Library's drag mechanism needs
// to know which pointer was pressed immediately before a drag was published,
// and `activeDrag` has FIVE publishers (the three Tree rows, plus the two flat
// renderers through `useDetailsDragDrop`'s `onDragStart`). A recorder owned by
// one of those publishers can only ever describe that publisher's drags, which
// is exactly the gap round 6 of the Tiles drag review measured. The recorder
// is therefore a leaf module, read by `store/libraryPanel.ts`'s
// `setActiveDrag` — the single place every publisher funnels through — so the
// owner press is captured for every drag without any publisher opting in.
//
// CAPTURE phase, on `document`: React attaches its own handlers at the app's
// root container, strictly below `document`, so this listener runs before any
// of them and no `stopPropagation()` in the app can hide a press from it.
//
// Deliberately NOT a hook and deliberately not reset when a drag ends: it is a
// record of what the hardware did, with no opinion about drags. Consumers
// decide what it means. It is also never invalidated — see the consumer's
// documented residual (`useDetailsDragDrop.ts`'s file header): a `dragstart`
// with no press of its own is snapshotted against the last press this module
// happened to see, which for a pointer-initiated drag is the dragging pointer
// and otherwise is an unrelated one.

/** A press, identified the way Pointer Events identifies one. `id` is always a
 *  number: a dispatch without a numeric `pointerId` (a plain
 *  `new Event("pointerdown")`, say) is never recorded, so `undefined` can
 *  never end up here and compare equal to another `undefined`. */
export interface PointerPress {
  id: number;
  type: string;
}

let record: PointerPress | null = null;
/** The document this module's listener is attached to, so registration is
 *  idempotent (and re-runs for a genuinely different document — a fresh jsdom
 *  environment, say). */
let attachedTo: Document | null = null;

function onPointerDown(event: Event): void {
  const press = event as PointerEvent;
  // The one guard: a non-`PointerEvent` dispatch carries no numeric
  // `pointerId`. Keeping it HERE (rather than in each consumer) means no
  // consumer has to re-derive it, and `PointerPress.id` is a real number by
  // construction everywhere downstream.
  if (typeof press.pointerId !== "number") return;
  record = { id: press.pointerId, type: press.pointerType };
}

/** Attach the recorder if it is not attached to this document already. Safe to
 *  call any number of times, and safe where there is no DOM at all (SSR, a
 *  node-environment test). */
function ensureListening(): void {
  if (typeof document === "undefined" || attachedTo === document) return;
  document.addEventListener("pointerdown", onPointerDown, true);
  attachedTo = document;
}

// Attached at import time, not on first read: the first read happens when a
// drag is published, which is strictly AFTER the press that owns it. A
// lazily-attached recorder would therefore miss the very first drag's press.
// `ensureListening()` runs again on every read so a document that only exists
// later still gets the recorder.
ensureListening();

/** The most recent press seen, or null if none has been seen yet. */
export function lastPointerPress(): PointerPress | null {
  ensureListening();
  return record;
}

/** TEST ONLY — forget the recorded press, so one test's presses cannot leak
 *  into the next. Does not detach the listener. */
export function __resetLastPointerPress(): void {
  record = null;
}
