// Where focus goes back to when a tool's window closes. Two things react to that close and used to
// race: LayoutToolWindow's timer (it asks "is focus stranded?") and LayoutAnnouncer's frame (it hands
// stranded focus to the front window). If the timer ran before React removed the window, focus was
// still on the doomed ✕, the timer stood down, and the announcer then gave focus to a plot's title
// bar instead of the opener. The tool now leaves the opener here, and whoever finds focus lost uses
// it first, so the order of the two no longer matters.

const FRESH_MS = 1000;
let pending: { el: HTMLElement; at: number } | null = null;

export function setFocusReturn(el: HTMLElement): void {
  pending = { el, at: Date.now() };
}

/** The opener a closing tool left, if it is still fresh and in the document; consumed. */
export function takeFocusReturn(): HTMLElement | null {
  const p = pending;
  if (!p || Date.now() - p.at >= FRESH_MS || !p.el.isConnected) return null;
  pending = null;
  return p.el;
}

/** The tool's own timer already restored `el`: nothing is left for the layout to do. */
export function clearFocusReturn(el: HTMLElement): void {
  if (pending?.el === el) pending = null;
}
