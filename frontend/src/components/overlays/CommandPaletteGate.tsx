// The eager mount point of the ⌘K palette (bundle diet slice 26,
// `plans/BUNDLE_HEADROOM.md`). `./CommandPalette.tsx` (the fuzzy matcher,
// the list, its Tab trap and opener restore) renders nothing until
// `cmdkOpen` is true, so App mounts this gate instead and the palette body
// leaves the entry chunk. The shortcut that opens it (`useGlobalShortcuts`),
// the menu bar's Search button and the `cmdkOpen` flag all stay eager.
//
// FIRST-OPEN LATENCY. Slice 5 banked this seam rather than land it because it
// spent a chunk fetch on the first ⌘K of a session. The gate removes that
// cost: it fetches the body once the shell has mounted (the effect below,
// the same after-first-paint timing `MenuBar` uses for its menu model), so
// by the time anyone presses ⌘K the module is cached and the palette mounts
// on the keystroke's own frame. A ⌘K pressed before that fetch lands opens
// the palette as soon as it does, through `useRegionLoaded`, which commits it
// synchronously instead of through Suspense's retry throttle. Once mounted
// the palette stays mounted while closed, as it always was, so its own
// open/close handling is unchanged. It reads the opener on the render that
// first sees `cmdkOpen` true, which on the cold path is its first render, and
// nothing moves focus before then.
//
// LOAD FAILURE. The open flag is cleared and a toast says the palette could
// not load. The next ⌘K tries again.

import { useEffect } from "react";

import { lazyRegion, useRegionLoaded } from "../../lib/lazyRegion";
import { PALETTE_LABEL, type Action } from "../../store/commands";
import { toast } from "../../store/toasts";
import { useApp } from "../../store/useApp";

const Palette = lazyRegion(() => import("./CommandPalette"), PALETTE_LABEL);

export default function CommandPaletteGate({ actions }: { actions: Action[] }) {
  const open = useApp((s) => s.cmdkOpen);
  const setCmdk = useApp((s) => s.setCmdk);
  useEffect(() => {
    // Warm only; a failed fetch is not cached, and an open reports its own.
    Palette.preload().catch(() => {});
  }, []);
  const ready = useRegionLoaded(Palette, open, () => {
    setCmdk(false);
    toast("Could not load the command palette. Try again.", "danger");
  });
  // `loaded()` as well as `ready`: once the warm fetch has landed, the render
  // that first sees `cmdkOpen` true mounts the palette itself, without waiting
  // for the gate's effect to confirm what the module cache already holds.
  return ready || Palette.loaded() ? <Palette actions={actions} /> : null;
}
