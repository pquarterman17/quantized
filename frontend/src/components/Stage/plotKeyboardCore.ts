// The lazy half of usePlotKeyboard (kept off the eager bundle): the keystroke
// handlers. See usePlotKeyboard.ts for the contract; this file owns the
// behaviour — data-order cursor walk, zoom/pan through `setScalesPx` +
// `onViewChange` (-> store.recordView, coalesced 160 ms like a wheel burst so a
// held key is ONE undo step), and reset mirroring usePlotStageActions.resetView.

import type uPlot from "uplot";

import type { PlotPayload } from "../../lib/plotdata";
import { setScalesPx, viewBounds, type PlotViewBounds, type Readout } from "../../lib/uplotTools";

const ZOOM_STEP = 1.18; // = wheelZoomPlugin's step
const PAN_FRAC = 0.1;
export const COMMIT_MS = 160; // = viewHistoryPlugin's wheel idle window

/** Everything the handlers need; owned and refreshed each render by usePlotKeyboard. */
export interface KbCtx {
  plotRef: { current: uPlot | null };
  payload: PlotPayload | null;
  hidden?: boolean[];
  onViewChange?: (before: PlotViewBounds, after: PlotViewBounds) => void;
  onReadout?: (r: Readout | null) => void;
  setLive: (text: string) => void;
  cur: { s: number; i: number } | null; // s = data column (1-based)
  pending: PlotViewBounds | null;
  timer: ReturnType<typeof setTimeout> | null;
}

type Col = (number | null)[];
const ok = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);
const fmt = (v: number) => v.toPrecision(5);

/** Next index from `i` in `dir` (data order) where x and y are finite; -1 if none. */
export function stepIndex(x: Col, y: Col, i: number, dir: 1 | -1): number {
  for (let k = i + dir; k >= 0 && k < x.length; k += dir) if (ok(x[k]) && ok(y[k])) return k;
  return -1;
}

/** Commit a half-coalesced zoom/pan to the view history. */
export function flush(c: KbCtx): void {
  if (c.timer) clearTimeout(c.timer);
  c.timer = null;
  const u = c.plotRef.current, before = c.pending;
  c.pending = null;
  if (u && before) c.onViewChange?.(before, viewBounds(u));
}

const yKey = (c: KbCtx, u: uPlot, s: number) => (c.payload!.series[s - 1]?.axis === 1 && u.scales.y2 ? "y2" : "y");

function show(c: KbCtx, u: uPlot, s: number, i: number): void {
  const p = c.payload!;
  const xv = (p.data[0] as Col)[i] as number, yv = (p.data[s] as Col)[i] as number;
  c.cur = { s, i };
  const rows = p.series.flatMap((sp, k) => {
    const v = (p.data[k + 1] as Col)[i];
    return c.hidden?.[k] || sp.muted || !ok(v) ? [] : [{ label: sp.label, y: v }];
  });
  c.onReadout?.({ x: xv, rows });
  const name = p.series[s - 1]?.label;
  c.setLive(`x = ${fmt(xv)}, y = ${fmt(yv)}${name ? ` (${name})` : ""}`);
  let m = u.over.querySelector<HTMLElement>("[data-kb-cursor]");
  if (!m) {
    m = document.createElement("div");
    m.setAttribute("data-kb-cursor", "");
    m.setAttribute("aria-hidden", "true");
    m.style.cssText = "position:absolute;width:10px;height:10px;margin:-5px 0 0 -5px;border-radius:50%;border:2px solid var(--accent);pointer-events:none";
    u.over.appendChild(m);
  }
  m.style.left = `${u.valToPos(xv, "x")}px`;
  m.style.top = `${u.valToPos(yv, yKey(c, u, s))}px`;
}

function view(c: KbCtx, u: uPlot, apply: () => void): void {
  c.pending ??= viewBounds(u);
  apply();
  if (c.timer) clearTimeout(c.timer);
  c.timer = setTimeout(() => flush(c), COMMIT_MS);
  if (c.cur) show(c, u, c.cur.s, c.cur.i);
}

/** Handle one (already filtered) keystroke. */
export function handleKey(c: KbCtx, k: string, shift: boolean): void {
  const u = c.plotRef.current, payload = c.payload;
  if (!u || !payload) return;
  const wid = u.over.clientWidth || 1, hgt = u.over.clientHeight || 1;
  const x = payload.data[0] as Col, n = payload.series.length;
  const usable = (s: number) => !!payload.series[s - 1] && !c.hidden?.[s - 1] && !payload.series[s - 1].muted;
  const arrow = k.startsWith("Arrow");
  if (arrow && !shift) {
    const cur = c.cur;
    if (k === "ArrowLeft" || k === "ArrowRight") {
      const dir = k === "ArrowRight" ? 1 : -1;
      let s = cur?.s ?? 1;
      if (!cur) while (s <= n && !usable(s)) s++;
      if (s > n) return;
      const y = payload.data[s] as Col;
      const i = cur ? stepIndex(x, y, cur.i, dir) : stepIndex(x, y, dir === 1 ? -1 : x.length, dir);
      if (i >= 0) show(c, u, s, i);
      return;
    }
    if (!cur) return; // up/down only switch an existing cursor's series
    const dir = k === "ArrowDown" ? 1 : -1;
    for (let s = cur.s + dir; s >= 1 && s <= n; s += dir) {
      if (!usable(s)) continue;
      const y = payload.data[s] as Col;
      const i = ok(y[cur.i]) ? cur.i : Math.max(stepIndex(x, y, cur.i, 1), stepIndex(x, y, cur.i, -1)); // nearest valid
      if (i >= 0) show(c, u, s, i);
      return;
    }
    return;
  }
  if (arrow) {
    const dx = k === "ArrowLeft" ? -PAN_FRAC * wid : k === "ArrowRight" ? PAN_FRAC * wid : 0;
    const dy = k === "ArrowUp" ? -PAN_FRAC * hgt : k === "ArrowDown" ? PAN_FRAC * hgt : 0;
    view(c, u, () => setScalesPx(u, (key) => (key === "x" ? [dx, wid + dx] : [dy, hgt + dy])));
    return;
  }
  if (k === "Home" || k === "0") {
    flush(c);
    const before = viewBounds(u);
    u.setData(payload.data, true);
    c.onViewChange?.(before, viewBounds(u, true));
    if (c.cur) show(c, u, c.cur.s, c.cur.i);
    return;
  }
  // + = zoom in, - _ zoom out, about the cursor point (else the centre).
  const f = k === "+" || k === "=" ? 1 / ZOOM_STEP : ZOOM_STEP;
  const pos = (v: number, hi: number) => Math.min(hi, Math.max(0, Number.isFinite(v) ? v : hi / 2));
  const cur = c.cur;
  const cx = cur ? pos(u.valToPos(x[cur.i] as number, "x"), wid) : wid / 2;
  const cy = cur ? pos(u.valToPos((payload.data[cur.s] as Col)[cur.i] as number, yKey(c, u, cur.s)), hgt) : hgt / 2;
  view(c, u, () => setScalesPx(u, (key) => (key === "x" ? [cx - cx * f, cx + (wid - cx) * f] : [cy - cy * f, cy + (hgt - cy) * f])));
}
