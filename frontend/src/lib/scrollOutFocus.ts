// The "the focused item scrolled out of the rendered window" focus fallback,
// shared by the three virtualized Library renderers (Tiles' grid, Tree's row
// list, Details' table).
//
// THE PROBLEM. Under virtualization a row/tile unmounts the moment it leaves
// the window. When it is the element that HOLDS focus, the browser drops focus
// to <body> (jsdom does the same, which is what makes this testable). The
// keyboard then dead-ends — and body focus plus the global Delete binding is
// the very data-loss path `lib/focusGuard.ts` exists to prevent. A KEYBOARD
// scroll never hits this: the arrow handlers call `ensureVisible` and then
// re-focus the target themselves. Only an ORGANIC scroll does — a mouse wheel,
// a scrollbar drag, a trackpad fling, with no keystroke anywhere in the
// interaction.
//
// THE MECHANISM, extracted verbatim from LibraryWorkspace's E-c3 grid (this
// module's only behavioural change there is the attribute's name, which went
// from the Tiles-specific `data-tile-grid-focus` to the shared spelling
// below): the list CONTAINER is made programmatically focusable and catches
// the orphaned focus, and its own keydown resumes navigation from the roving
// item's MODEL position — so the fallback is a waypoint, never a dead end.
//
// `tabIndex: -1` is load-bearing and deliberately NOT 0: the container must be
// focusable by script only. Each renderer keeps exactly ONE sequential Tab
// stop AMONG ITS ROWS/TILES (the roving row/tile) — Details additionally has
// its own independent sort-header roving stop, so its whole component has
// two, by design; see LibraryDetails.tsx. A tabbable container would add a
// further stop and let Tab land somewhere no arrow key means anything.

/** Marker attribute on the container that catches the orphaned focus. The
 *  deferred focus retries (`focusTileWhenRendered`, `focusRowWhenRendered`)
 *  recognise it as a legitimate place for focus to sit mid-retry, so a
 *  fallback that fires while a retry is in flight doesn't abort it. */
export const SCROLL_OUT_FOCUS_ATTR = "data-scroll-out-focus";
export const SCROLL_OUT_FOCUS_SELECTOR = `[${SCROLL_OUT_FOCUS_ATTR}]`;

/** Spread onto the container element. Keeps the two halves — focusable by
 *  script, recognisable to the retries — from drifting apart. */
export const scrollOutFocusProps = { tabIndex: -1, [SCROLL_OUT_FOCUS_ATTR]: "" } as const;

/** True when the container should take focus: the roving item is STILL in the
 *  model but its element is gone from the DOM, and the DOM really did orphan
 *  focus to <body>.
 *
 *  Each guard rules out a case that belongs to someone else:
 *  - `!virtualized` / `rovingSelector == null` — nothing is being windowed.
 *  - `!stillInModel` — the item was REMOVED (deleted, moved, filtered out);
 *    each renderer's own survivor/recovery effect owns that, and lands on a
 *    neighbouring row rather than the container.
 *  - `activeElement !== document.body` — focus is somewhere real (an input the
 *    user clicked, another row). Never steal it.
 *  - the element still resolves — the item is rendered, so focus was lost for
 *    some other reason and this fallback has no business claiming it. */
export function needsScrollOutFocusFallback(
  virtualized: boolean,
  rovingSelector: string | null,
  stillInModel: boolean,
  root?: ParentNode | null,
): boolean {
  if (!virtualized || rovingSelector == null || !stillInModel) return false;
  if (document.activeElement !== document.body) return false;
  return (root ?? document).querySelector(rovingSelector) == null;
}
