// The eager half of the Origin-escape rewrite (`\+(..)` sup, `\-(..)` sub,
// `\g(..)` Greek, `\b(..)` bold, `\i(..)` italic -- lib/originEscapes.ts,
// a LAZY chunk for the eager-bundle budget): the one-line detector, the
// loader, and the signals a renderer redraws on. Split out of
// lib/richtext.ts (its module-size ceiling), which parses with the rewrite.
//
// Only the one-line detector below stays eager. The import starts the moment this
// module loads — app startup, before any plot can have data to label — so
// it is usually in place by the first labelled render. A label parsed in the
// window before it lands renders literally (the safe fallback every invalid
// label already takes), so whatever drew one waits for `originEscapesSettled`
// and draws again: the plot viewport rebuilds
// (`Stage/useLazyPlotParts.ts`, via `awaitsOriginEscapes`) and `RichText`
// re-renders (`subscribeOriginEscapes`). A first plot never stays literal.
export const ORIGIN_ESCAPE = /(?<!\\)\\[+\-gbi]\(/; // an unescaped backslash (lib/originEscapes.ts)
let rewrite: ((s: string) => string) | null = null;
let escapesSettled = false;
const escapeListeners = new Set<() => void>();
/** Settles once the escape chunk has loaded -- or failed to (offline): then
 *  escapes stay literal, never a crash. Either way a redraw is final. */
export const originEscapesSettled: Promise<void> = import("./originEscapes")
  .then(
    (m) => {
      rewrite = m.originEscapesToMarkup;
    },
    () => {},
  )
  .then(() => {
    escapesSettled = true;
    for (const f of escapeListeners) f();
  });

/** Whether `s` carries an Origin escape that would still render literally
 *  because the rewrite chunk has not settled yet. */
export function awaitsOriginEscapes(s: string | null | undefined): boolean {
  return !escapesSettled && !!s && ORIGIN_ESCAPE.test(s);
}

/** `useSyncExternalStore` pair for a DOM renderer of rich labels. */
export function subscribeOriginEscapes(onChange: () => void): () => void {
  escapeListeners.add(onChange);
  return () => escapeListeners.delete(onChange);
}
export const originEscapesReady = (): boolean => escapesSettled;

/** The loaded rewrite (escapes -> rich-text markup), or null before it lands. */
export const originRewrite = (): ((s: string) => string) | null => rewrite;
