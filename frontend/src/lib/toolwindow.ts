// Pure geometry helpers for the floating workshop `ToolWindow`
// (GUI_INTERACTION_PLAN #10 — "floating workshops recoverable"): the clamp
// math shared by drag-end, viewport-resize, and .dwk-restore clamping, plus
// the persisted-layout shape and its untrusted-input validator. Kept
// dependency-free (no store, no DOM) so it's unit-testable in isolation —
// `components/overlays/ToolWindow.tsx` and `store/toolwindows.ts` both build
// on this.

export interface ToolWindowLayout {
  x: number;
  y: number;
  width: number;
  /** null = auto/content-sized (the user has never dragged a resize handle). */
  height: number | null;
  collapsed: boolean;
}

/** Fallback title-bar height used before the real DOM element is measured
 *  (initial mount, or a DOM-less unit test) — close to the rendered
 *  `.qzk-win-title`'s padding + line height (shell.css). */
export const TITLE_BAR_HEIGHT = 32;

export const MIN_WIDTH = 200;
export const MIN_HEIGHT = 120;

function clampAxis(pos: number, size: number, viewport: number): number {
  if (!Number.isFinite(viewport) || viewport <= 0) return pos;
  // A window/title-bar as big as (or bigger than) the viewport can't have
  // BOTH edges on-screen at once — pin to the origin (best effort) rather
  // than picking an arbitrary negative offset.
  if (size >= viewport) return 0;
  return Math.min(Math.max(pos, 0), viewport - size);
}

/** Clamp a window's top-left so its ENTIRE title bar — the full window
 *  WIDTH, `titleBarHeight` tall — stays inside `viewport`, never just the
 *  top-left corner (the pre-#10 behavior). Applies on drag end and on every
 *  viewport resize, so a window can never end up with its title bar
 *  unreachable. */
export function clampToolWindowPos(
  x: number,
  y: number,
  width: number,
  titleBarHeight: number,
  viewport: { width: number; height: number },
): { x: number; y: number } {
  return {
    x: clampAxis(x, width, viewport.width),
    y: clampAxis(y, titleBarHeight, viewport.height),
  };
}

/** A window that has never been dragged/resized/collapsed — the component's
 *  own `x`/`y`/`width` props, verbatim. "Reset window positions" restores
 *  every persisted entry back to exactly this shape (per-id, via each
 *  ToolWindow's own default props). */
export function defaultToolWindowLayout(x: number, y: number, width: number): ToolWindowLayout {
  return { x, y, width, height: null, collapsed: false };
}

/** Validate one persisted layout entry from an untrusted `.dwk` — anything
 *  malformed degrades to `null` (the caller drops the key entirely, so that
 *  window falls back to its own component default props rather than
 *  restoring garbage). */
function sanitizeOne(v: unknown): ToolWindowLayout | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.x !== "number" || !Number.isFinite(o.x)) return null;
  if (typeof o.y !== "number" || !Number.isFinite(o.y)) return null;
  if (typeof o.width !== "number" || !Number.isFinite(o.width) || o.width < MIN_WIDTH) return null;
  const height =
    typeof o.height === "number" && Number.isFinite(o.height) && o.height >= MIN_HEIGHT ? o.height : null;
  const collapsed = o.collapsed === true;
  return { x: o.x, y: o.y, width: o.width, height, collapsed };
}

/** Validate + clamp a persisted `toolWindowLayout` map from a `.dwk`
 *  (GUI_INTERACTION_PLAN #10 item 3): drops malformed entries, and clamps
 *  every surviving position to `viewport` — a workspace saved on a big
 *  monitor must stay reachable on a laptop. `viewport` defaults to the real
 *  browser window so callers only need to override it in tests. */
export function sanitizeToolWindowLayout(
  v: unknown,
  viewport: { width: number; height: number } = {
    width: typeof window !== "undefined" ? window.innerWidth : 1280,
    height: typeof window !== "undefined" ? window.innerHeight : 800,
  },
): Record<string, ToolWindowLayout> {
  if (typeof v !== "object" || v === null) return {};
  const out: Record<string, ToolWindowLayout> = {};
  for (const [id, raw] of Object.entries(v as Record<string, unknown>)) {
    const layout = sanitizeOne(raw);
    if (!layout) continue;
    const { x, y } = clampToolWindowPos(layout.x, layout.y, layout.width, TITLE_BAR_HEIGHT, viewport);
    out[id] = { ...layout, x, y };
  }
  return out;
}
