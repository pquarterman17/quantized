// The overlay layer App mounts (MAIN_PLAN #1, component-ceiling ratchet): the
// always-on infrastructure, plus the flag-gated workshop panels and on-demand
// dialogs, which live in AppOverlayPanels.tsx.
//
// BUNDLE DIET SLICE 31 (plans/BUNDLE_HEADROOM.md). AppOverlayPanels.tsx is
// ~60 `lazyPanel()` seams and their open-flag selectors, and every one of
// them renders nothing until the user opens something. It loads as one chunk
// right after this shell mounts (the warm-up timing MenuBar, the palette gate
// and the Appearance menu use), so the first open of any panel finds it in
// the module cache, as it found the eager module before. A flag set before
// that chunk lands (a startup recovery prompt, a shortcut in the first
// milliseconds) is read when it does: the panels mount reading the stores'
// current state, and each panel was already a chunk fetch of its own.
//
// What stays here is what must work before any chunk arrives:
//  * ParamDialog and ConfirmDialog expose promise APIs (askParams /
//    askConfirm) that eager code awaits; they mount LAST among the dialogs
//    (R12, see below).
//  * Toaster and TooltipLayer are on screen from first paint.
//  * InteractionHints registers its SHOW_INTERACTION_HINTS listener on mount
//    and shows the first-run card.
//  * The SQLite dialog's open listener (store/sqliteQueryDialog.ts) is
//    registered here, so the Data command can dispatch before any panel
//    chunk is loaded.
//
// DOM ORDER is unchanged: the panel module renders in three parts placed
// around TooltipLayer and InteractionHints exactly where the single component
// rendered them.
//
// LOAD FAILURE. A danger toast says the panels could not load, and the next
// click or key press anywhere loads again (a failed load is not cached), so
// the gesture that opens a panel is also the one that retries. Nothing else
// on screen depends on the chunk.

import { useEffect, useLayoutEffect, useState } from "react";

import ConfirmDialog from "./components/overlays/ConfirmDialog";
import ParamDialog from "./components/overlays/ParamDialog";
import Toaster from "./components/overlays/Toaster";
import ConnectionBanner from "./components/Shell/ConnectionBanner";
import TooltipLayer from "./components/overlays/TooltipLayer";
import InteractionHints from "./components/overlays/InteractionHints";
import { lazyRegion, useRegionLoaded } from "./lib/lazyRegion";
import { listenForSqliteQuery } from "./store/sqliteQueryDialog";
import { toast } from "./store/toasts";

const Panels = lazyRegion(() => import("./AppOverlayPanels"), "Panels and dialogs");

const PANELS_LOAD_FAILED = "Panels and dialogs could not load. Your next click or key press tries again.";
/** A load retried on every keystroke while the server is away would toast on
 *  every keystroke; one report per this many ms is enough. */
const FAIL_TOAST_GAP_MS = 10_000;
let lastFailToast = -Infinity;

/** True once the panel module is loaded, starting the load on mount
 *  (`useRegionLoaded`, so the flip is `flushSync`ed: a dialog whose flag was
 *  set before the chunk landed arrives with its focus and Tab-trap effects in
 *  the task that paints it, BUG-031). After a failure, the next pointer or
 *  key press anywhere loads again; that gesture is usually the one opening a
 *  panel, whose flag is then read when the chunk lands. */
function usePanelsLoaded(): boolean {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const ready = useRegionLoaded(
    Panels,
    true,
    () => {
      setFailed(true);
      const now = Date.now();
      if (now - lastFailToast < FAIL_TOAST_GAP_MS) return;
      lastFailToast = now;
      toast(PANELS_LOAD_FAILED, "danger");
    },
    attempt,
  );
  // A layout effect, so the listener is in place in the commit that shows
  // the failure toast: a key press the moment the toast is on screen retries.
  useLayoutEffect(() => {
    if (!failed) return;
    const retry = (): void => {
      setFailed(false);
      setAttempt((a) => a + 1);
    };
    const opts = { capture: true };
    window.addEventListener("pointerdown", retry, opts);
    window.addEventListener("keydown", retry, opts);
    return () => {
      window.removeEventListener("pointerdown", retry, opts);
      window.removeEventListener("keydown", retry, opts);
    };
  }, [failed]);
  return ready;
}

export default function AppOverlays() {
  // Heard while the dialog chunk is still unloaded -- the store owns the
  // listener so the Data command can dispatch before anything is mounted.
  useEffect(listenForSqliteQuery, []);
  // `loaded()` as well: once the chunk is cached, a fresh mount renders the
  // panels on its first render.
  const panels = usePanelsLoaded() || Panels.loaded();

  return (
    <>
      {panels && <Panels part="lead" />}
      <TooltipLayer />
      {panels && <Panels part="whatIsThis" />}
      <InteractionHints />
      {panels && <Panels part="main" />}
      {/* LAST among the dialogs (R12): every dialog backdrop has the same
          z-index, so tree order is paint order, and the active modal is the
          one last in the document (lib/modalInert.ts). A confirmation or a
          parameter prompt is always asked OVER whatever is open — the Delete
          key with Preferences open asks one — so it must paint, and be, on
          top; mounted first, it rendered underneath the dialog it was
          asked over. */}
      <ParamDialog />
      <ConfirmDialog />
      <Toaster />
      <ConnectionBanner />
    </>
  );
}
