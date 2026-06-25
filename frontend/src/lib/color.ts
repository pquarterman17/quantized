// Resolve any CSS color (oklch token value, hex, rgb, named) to a #rrggbb hex
// using the browser's own color engine: paint a 1×1 canvas and read the
// rasterized sRGB pixel back. This is exact for OKLCH (which matplotlib can't
// parse) and avoids hand-rolling color-space math. Returns null when there is no
// 2D context (e.g. jsdom in unit tests) so callers can fall back gracefully.

let _ctx: CanvasRenderingContext2D | null | undefined;

function ctx2d(): CanvasRenderingContext2D | null {
  if (_ctx === undefined) {
    _ctx = document.createElement("canvas").getContext("2d");
  }
  return _ctx ?? null;
}

const hex2 = (n: number): string => n.toString(16).padStart(2, "0");

/** Convert a CSS color string to "#rrggbb", or null if it can't be resolved.
 *  Does NOT accept `var(--x)` — resolve the custom property to its value first. */
export function resolveToHex(color: string): string | null {
  const c = color.trim();
  if (!c) return null;
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c.toLowerCase();
  const ctx = ctx2d();
  if (!ctx) return null;
  try {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#000";
    ctx.fillStyle = c; // invalid colors are silently ignored by the setter
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    if (a === 0) return null; // nothing painted → unparseable color
    return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
  } catch {
    return null; // getImageData can throw (tainted canvas / no impl)
  }
}
