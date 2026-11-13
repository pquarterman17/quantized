// The eager face of <ContextMenu> (bundle diet slice 26,
// `plans/BUNDLE_HEADROOM.md`). The menu body (`./ContextMenu.tsx`, its
// popup/flyout boxes, the keyboard-navigation math and the Help footer) only
// ever renders after a click or a right-click, yet five startup components
// import it: the menu bar, a plot window's title buttons, the plot stage's
// menus, the legend and the plot toolbar. Those five import THIS module
// instead, so the body leaves the entry chunk. Lazy panels, which load after
// a user action anyway, keep importing `./ContextMenu` directly.
//
// FIRST-OPEN LATENCY. `MenuBar` warms the body once the shell has mounted
// (`preloadContextMenu`, next to the menu-model load it already starts
// there), so a menu opened after first paint renders from the cached module
// on the click's own frame, exactly as the eager import did. A menu opened
// before that fetch lands waits for it, not for React's Suspense retry
// throttle: `useRegionLoaded` renders nothing until the chunk is in and then
// commits the menu synchronously (BUG-031's `flushSync`), the same gate the
// promise dialogs use (`lib/lazyRegion.tsx`). The body captures the focus
// to return to on its own mount, and nothing moves focus before then, so
// Escape still hands focus back to whatever opened the menu.
//
// LOAD FAILURE. A chunk that will not load closes the menu through the
// host's own `onClose` and says so in a toast, instead of leaving an open
// flag with nothing on screen. The next open tries again.

import type { ComponentProps } from "react";

import { lazyRegion, useRegionLoaded } from "../../lib/lazyRegion";
import { toast } from "../../store/toasts";

export type { ContextMenuItem, Swatch } from "./contextMenuTypes";

const Menu = lazyRegion(() => import("./ContextMenu"), "Menu");
type Props = ComponentProps<typeof import("./ContextMenu").default>;

/** Fetch the menu body ahead of the first open. Failures are ignored here:
 *  nothing is cached on failure, and an open reports its own. */
export function preloadContextMenu(): Promise<void> {
  return Menu.preload().catch(() => {});
}

export default function ContextMenu(props: Props) {
  const ready = useRegionLoaded(Menu, true, () => {
    toast("Could not load the menu. Try again.", "danger");
    props.onClose();
  });
  return ready || Menu.loaded() ? <Menu {...props} /> : null;
}
