// Background `inert` for the app's backdrop dialogs, and the exemptions that
// keep the app's live regions reachable while one is open
// (PRIMARY_SOFTWARE_AUDIT_PLAN P3.3, residual R12).
//
// WHAT WAS WRONG. Every backdrop dialog carried `aria-modal="true"`, which
// tells assistive tech to treat EVERYTHING outside the dialog as not there.
// The app announces through `aria-live` regions outside every dialog — the
// toast stack (`overlays/Toaster.tsx`) and the status bar's "Background
// operations" region and autosave alert (`Shell/StatusBar.tsx`) — so an
// announcement raised while any dialog was open was silently lost.
//
// WHAT THIS DOES INSTEAD. `aria-modal` is gone from every dialog
// (`architecture.test.ts` keeps it gone) and the BACKGROUND is made `inert`:
// the browser, not the screen reader, drops it from the accessibility tree
// and refuses it focus and pointer events — and it does so PER ELEMENT, so an
// element left unmarked keeps working. That per-element property is the fix.
//
// THE WALK. From the ACTIVE dialog's root up to `document.body`, every
// sibling off that path is marked. A dialog stacked underneath is a sibling
// off the path, so it goes inert with the rest of the background (exactly one
// active modal); the dialog's own backdrop is ON the path, so click-to-dismiss
// is untouched.
//
// ONE ORDER FOR EVERYTHING (R16). "Active" is the dialog OPENED LAST — the
// order `lib/escapeStack.ts` already ranks Escape by — and this module makes
// it the dialog PAINTED on top, too: every walk stamps each open dialog's
// `.qz-overlay-backdrop` with a z-index in open order (101, 102, …; the
// stylesheet's 100 is the floor, the toast stack at 200 stays above). Before
// that, equal z-index painted in TREE order, so `?` pressed in Help opened
// Shortcuts (earlier in `AppOverlays`) underneath Help: invisible, yet the
// first Escape closed it (measured in Chromium, main and this branch). Now
// Escape, the Tab trap (`isTopModal`), the inert walk and the paint all name
// the same dialog.
//
// THE EXEMPTIONS.
//  * `data-live-region`: never marked. An element that CONTAINS one is
//    descended into instead, leaving the region standing in an inert
//    surround. (A body-level portal would not help: the walk reaches body, so
//    the host would be a marked sibling. The marker does the work.)
//  * `data-modal-layer`: a popover portaled to <body> (the rich-label symbol
//    palette). Exempt ONLY when it appears while a dialog is top, and then
//    only for that dialog: with the background inert, nothing but that
//    dialog can have summoned it. One that predates the dialog is background.
//
// THE DOM-MUTATION GAP (R12 hypothesis b). A node added while a dialog is open
// in a place no marked ancestor covers — a child of a path node (a toast
// stack, a window, a lazy panel resolving into the shell) or of a descended
// container — would otherwise be live. A MutationObserver, attached only
// while a dialog is open, re-runs the walk for exactly those additions (and
// for a live region added under a marked ancestor, which needs the descent).
// Anything inside an already-marked subtree inherits `inert` for free and is
// skipped by an ancestor check, so the observer's cost is that check per
// added node (measured in the plan's R12 entry).
//
// FALLBACK (R12 hypothesis a). Every engine the SPA is built for supports
// `inert` (Vite's default target is Chrome/Edge 111, Firefox 114, Safari
// 16.4; `inert` shipped in 102 / 112 / 15.5). An engine without it gets the
// classic per-element `aria-hidden="true"` on the same elements instead —
// still per element, so the live regions stay exposed; Tab stays trapped by
// `useFocusTrap`, the pointer by the backdrop, and script-driven focus by a
// focusin guard (fallback mode only) that sends it back into the dialog.
//
// jsdom implements neither the property nor its effects (measured: no
// `inert` in HTMLElement.prototype, `focus()` lands inside an inert subtree),
// so `src/test/setup.ts` reflects the property and the unit tests pin WHERE
// the attribute lands; `e2e/specs/modal-inert.spec.ts` pins what it DOES.

import type { RefObject } from "react";

import { holdModal } from "./appShortcuts";

/** Marks an app-level live region: never inert while a modal is open. The
 *  eager components spell it as a literal (importing this module would pull
 *  it into the entry chunk); `modalInert.test.tsx` pins the spelling. */
export const LIVE_REGION_ATTR = "data-live-region";
/** Marks a body-level popover that belongs to whichever dialog was top when
 *  it appeared. */
export const MODAL_LAYER_ATTR = "data-modal-layer";

const LIVE = `[${LIVE_REGION_ATTR}]`;

type ModalEntry = { ref: RefObject<HTMLElement | null>; layers: Set<Element> };

const openModals: ModalEntry[] = [];
/** Exactly the elements THIS module marked, so a release never lifts an
 *  attribute somebody else set. */
const marked = new Set<Element>();
let attr: "inert" | "aria-hidden" = "inert";
let observer: MutationObserver | null = null;
/** The backdrops this module gave an open-order z-index. */
const stamped = new Set<HTMLElement>();
/** The root the current marks were walked from. */
let walkedFrom: HTMLElement | null = null;

function topmost(): { entry: ModalEntry; el: HTMLElement } | null {
  // Newest-opened first. A root React already detached (or swapped for
  // another element) is skipped; reading `ref.current` live is what lets a
  // dialog that re-renders into a different root element stay the modal.
  for (let i = openModals.length - 1; i >= 0; i--) {
    const el = openModals[i].ref.current;
    if (el?.isConnected) return { entry: openModals[i], el };
  }
  return null;
}

function mark(el: Element, keep: Set<Element>): void {
  if (el.hasAttribute(LIVE_REGION_ATTR) || keep.has(el)) return;
  if (el.querySelector(LIVE)) {
    for (const child of el.children) mark(child, keep);
    return;
  }
  if (el.hasAttribute(attr)) return; // someone else's; not ours to lift later
  el.setAttribute(attr, attr === "inert" ? "" : "true");
  marked.add(el);
}

/** Recompute the background from scratch: idempotent, so every caller can
 *  just ask for a resync. */
function sync(): void {
  // `disconnect` also drops queued records — the additions this walk is
  // about to account for — so a dialog mounted in this same commit is never
  // judged by the walk it replaces.
  observer?.disconnect();
  document.removeEventListener("focusin", guardFocus, true);
  for (const el of marked) el.removeAttribute(attr);
  marked.clear();
  for (const b of stamped) b.style.zIndex = "";
  stamped.clear();
  let z = 101;
  for (const entry of openModals) {
    const b = entry.ref.current?.closest<HTMLElement>(".qz-overlay-backdrop");
    if (b) {
      b.style.zIndex = String(z++);
      stamped.add(b);
    }
  }
  const top = topmost();
  walkedFrom = top?.el ?? null;
  if (top === null) return;
  attr = "inert" in HTMLElement.prototype ? "inert" : "aria-hidden";
  // `aria-hidden` hides the background from AT only; script-driven focus
  // (a window's focus-on-mount, a programmatic `.focus()`) could still land
  // there, which real `inert` refuses. The fallback refuses it here instead.
  if (attr !== "inert") document.addEventListener("focusin", guardFocus, true);
  let node: Element = top.el;
  while (node !== document.body && node.parentElement) {
    const parent: Element = node.parentElement;
    for (const sibling of parent.children) if (sibling !== node) mark(sibling, top.entry.layers);
    node = parent;
  }
  (observer ??= new MutationObserver(onAdded)).observe(document.body, { childList: true, subtree: true });
}

function onAdded(records: MutationRecord[]): void {
  const top = topmost();
  // The walked-from root went away or was replaced without a release (a
  // re-render into another root element, an abnormal removal): re-walk from
  // whatever is top now — or lift everything if nothing is.
  let dirty = top?.el !== walkedFrom;
  // Every added node is looked at even once a re-walk is due: a popover that
  // arrives in the same batch as some other uncovered node must still be
  // claimed for the dialog before that re-walk runs.
  for (const record of top ? records : []) {
    for (const node of record.addedNodes) {
      if (!top || !(node instanceof Element) || !node.isConnected) continue;
      // Nearest ancestor that already decided this node's fate.
      let a = node.parentElement;
      while (a && !(marked.has(a) || a === top.el || top.entry.layers.has(a) || a.hasAttribute(LIVE_REGION_ATTR))) a = a.parentElement;
      if (a === null) {
        // Uncovered: a child of a path node or of a descended container.
        if (node.hasAttribute(MODAL_LAYER_ATTR)) top.entry.layers.add(node);
        dirty = true;
      } else if (!dirty && marked.has(a) && (node.hasAttribute(LIVE_REGION_ATTR) || node.querySelector(LIVE))) {
        dirty = true; // a live region under a marked ancestor needs the descent
      }
    }
  }
  if (dirty) sync();
}

/** Fallback mode only: focus that lands in a marked subtree goes back into
 *  the active dialog. */
function guardFocus(e: FocusEvent): void {
  const top = topmost();
  let a = e.target instanceof Element ? e.target : null;
  while (a && !marked.has(a)) a = a.parentElement;
  if (top && a) (top.el.matches("[tabindex]") ? top.el : top.el.querySelector<HTMLElement>("button,input,select,textarea,[href],[tabindex]"))?.focus();
}

/** Register an open modal root (read live from `ref`) and recompute. */
export function registerModal(ref: RefObject<HTMLElement | null>): void {
  openModals.push({ ref, layers: new Set() });
  // R15: an open modal also gates the app's window-level shortcuts.
  holdModal(ref, true);
  sync();
}

/** Is `ref` the ACTIVE modal — the one left live? The Tab trap's question. */
export function isTopModal(ref: RefObject<HTMLElement | null>): boolean {
  return topmost()?.entry.ref === ref;
}

/** Drop a modal and recompute. Idempotent — releasing one already gone still
 *  resyncs — so the eager focus restore and the unmount cleanup can both
 *  call it. */
export function releaseModal(ref: RefObject<HTMLElement | null>): void {
  for (let i = openModals.length - 1; i >= 0; i--) if (openModals[i].ref === ref) openModals.splice(i, 1);
  holdModal(ref, false);
  sync();
}

/** Test-only: how many modal roots the registry holds, so a test can prove
 *  the registry empties and not just that the attributes were lifted. */
export function openModalCount(): number {
  return openModals.length;
}
