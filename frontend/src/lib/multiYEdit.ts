// The edits behind the multiple-Y-axes gestures (gap audit 4 G11): pure
// patch builders, and the two commits (one undo step each) the Inspector and
// Plot ▸ Y Axis Settings… run. Loaded with them, never eagerly.

import { useApp } from "../store/useApp";
import { MAX_EXTRA_Y, newExtraYAxis, type ExtraYAxis } from "./multiY";

export interface MultiYState {
  y2Keys: number[] | null;
  yAxes: ExtraYAxis[];
  yAxisOf: Record<number, number>;
}

/** Drop the assignments whose axis does not exist (orphans). */
function liveOnly(of: Record<number, number>, count: number): Record<number, number> {
  return Object.fromEntries(Object.entries(of).filter(([, n]) => n - 3 < count));
}

/** Put channel `ch` on Y axis `n` (1 = Y1, 2 = Y2, 3 = Y3 ...). `n` one past
 *  the last extra axis creates it -- after dropping any orphan assignment,
 *  so a new axis never silently adopts a stale one. Null when `n` is out of
 *  range (a new axis past MAX_EXTRA_Y, or a gap). */
export function assignYAxis(s: MultiYState, ch: number, n: number): Partial<MultiYState> | null {
  if (!Number.isInteger(n) || n < 1 || n - 3 > s.yAxes.length || n - 3 >= MAX_EXTRA_Y) return null;
  const grow = n - 3 === s.yAxes.length;
  const yAxisOf = grow ? liveOnly(s.yAxisOf, s.yAxes.length) : { ...s.yAxisOf };
  delete yAxisOf[ch];
  if (n >= 3) yAxisOf[ch] = n;
  const others = (s.y2Keys ?? []).filter((k) => k !== ch);
  const y2 = n === 2 ? [...others, ch].sort((a, b) => a - b) : others;
  return {
    yAxisOf,
    y2Keys: y2.length ? y2 : null,
    ...(grow ? { yAxes: [...s.yAxes, newExtraYAxis()] } : {}),
  };
}

/** Change extra axis `i` (0 = Y3), or remove it (`patch` null): its series go
 *  back to Y1 and every later axis moves down one number, keeping its series. */
export function editYAxis(s: MultiYState, i: number, patch: Partial<ExtraYAxis> | null): Partial<MultiYState> | null {
  if (!s.yAxes[i]) return null;
  if (patch) return { yAxes: s.yAxes.map((a, k) => (k === i ? { ...a, ...patch } : a)) };
  const n = i + 3;
  const yAxisOf: Record<number, number> = {};
  for (const [ch, m] of Object.entries(s.yAxisOf)) if (m !== n) yAxisOf[Number(ch)] = m > n ? m - 1 : m;
  return { yAxes: s.yAxes.filter((_, k) => k !== i), yAxisOf };
}

/** The store side of the two gestures: their patch as one undo step. */
interface MultiYStore extends MultiYState {
  recordHistory: (label: string) => void;
  setStatus: (status: string) => void;
  setY2Keys: (y2Keys: number[] | null) => void;
}

function commit(get: () => MultiYStore, label: string, patch: Partial<MultiYState>): void {
  get().recordHistory(label);
  useApp.setState(patch);
}

/** Put channel `ch` on Y axis `n` (one undo step), or say why not. A move
 *  that changes Y2's membership goes through `setY2Keys`, so it is recorded
 *  as a macro step and the last series leaving Y2 resets Y2's range, scale
 *  and title exactly as the Y2 pill always did; the Y3+ half of the same
 *  move then lands in that one undo step. */
export function setSeriesYAxis(get: () => MultiYStore, ch: number, n: number): void {
  const before = get();
  const patch = assignYAxis(before, ch, n);
  if (!patch) return before.setStatus(`Y${n}: at most ${MAX_EXTRA_Y + 2} Y axes, numbered in order`);
  const { y2Keys, ...rest } = patch;
  if (String(y2Keys ?? null) === String(before.y2Keys ?? null)) return commit(get, `move series to Y${n}`, patch);
  before.setY2Keys(y2Keys ?? null); // records the undo step (pre-move state) and the macro
  useApp.setState(rest);
}

/** Change or remove extra axis `i` (one undo step). */
export function setExtraYAxis(get: () => MultiYStore, i: number, patch: Partial<ExtraYAxis> | null): void {
  const next = editYAxis(get(), i, patch);
  if (next) commit(get, patch ? `format Y${i + 3} axis` : `remove Y${i + 3} axis`, next);
}
