// Keep a newly opened floating plot window clear of the floating tool windows
// (UX pass 4 M5, the root of pass-2 M1 and pass-3 M1). Tool-band windows (Style,
// Data, Analysis, an analysis tool) are painted above every plot frame, so a plot
// window that opens under one is covered and its toolbar and title buttons are
// unreachable: it can never be raised past them. Instead of fighting the stacking,
// a window that would open under one is moved into the free band beside it, or
// narrowed to fit it. Pure: boxes in desk px.

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Space kept between a window and the tool window beside it. */
export const CLEAR_GAP = 8;
/** The narrowest a window is made to fit a free band; a narrower band is left alone. */
export const MIN_CLEAR_W = 300;

const overlapsY = (a: Box, b: Box) => a.y < b.y + b.h && a.y + a.h > b.y;
const overlaps = (a: Box, b: Box) => overlapsY(a, b) && a.x < b.x + b.w && a.x + a.w > b.x;

/** `win`, moved or narrowed so it does not sit under any of `obstacles`, or `win` itself (same object)
 *  when nothing covers it or no free band is wide enough (then the overlap is left, not made worse). */
export function clearOfBoxes(win: Box, obstacles: readonly Box[], desk: { w: number }): Box {
  const rows = obstacles.filter((o) => o.w > 0 && o.h > 0 && overlapsY(win, o));
  if (!rows.some((o) => overlaps(win, o))) return win;
  // The free x-bands of the desk across the rows the window spans.
  const blocked = rows.map((o) => [o.x - CLEAR_GAP, o.x + o.w + CLEAR_GAP] as const).sort((a, b) => a[0] - b[0]);
  const bands: [number, number][] = [];
  let at = 0;
  for (const [from, to] of blocked) {
    if (from > at) bands.push([at, Math.min(from, desk.w)]);
    at = Math.max(at, to);
  }
  if (at < desk.w) bands.push([at, desk.w]);
  const fits = bands.filter(([a, b]) => b - a >= win.w);
  if (fits.length) {
    // Keep the size; the nearest band, as near to where it was as the band allows.
    const nearest = (b: [number, number]) => Math.abs(Math.min(Math.max(win.x, b[0]), b[1] - win.w) - win.x);
    const band = fits.reduce((p, c) => (nearest(c) < nearest(p) ? c : p));
    return { ...win, x: Math.min(Math.max(win.x, band[0]), band[1] - win.w) };
  }
  const widest = bands.reduce<[number, number] | null>((p, c) => (!p || c[1] - c[0] > p[1] - p[0] ? c : p), null);
  if (!widest || widest[1] - widest[0] < MIN_CLEAR_W) return win;
  return { ...win, x: widest[0], w: Math.floor(widest[1] - widest[0]) };
}
