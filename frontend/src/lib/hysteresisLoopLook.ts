// Does a curve look like a magnetic hysteresis loop (M against H)? Only used to point the level-crossings
// chip at the Hysteresis tool: a coercivity is where the loop crosses M = 0, and the tool measures it with
// remanence, saturation and squareness, where a bare level crossing on a noisy loop gives a burst of them
// (acceptance pass 6 usability 2, pass 7 usability 4).
//
// Three things must hold, in acquisition order: X takes both signs; X sweeps out and back (at least one
// reversal of more than REVERSAL_FRACTION of its range, which ignores noise on a sweep); and the two
// branches differ: the signed area between the longest rising sweep and the longest falling sweep, over
// their shared X, is more than LOOP_AREA_FRACTION of the bounding box. A curve that is swept both ways and
// retraces itself (a slope, a sine against a linear X) has no area, and noise on the two branches cancels
// in the signed sum.

const REVERSAL_FRACTION = 0.05;
/** A soft loop is narrow: its area over its box is about Hc / Hmax (about 1 % for the corpus file
 *  quantum-design/magnetometry/vsm_mh_ip_b.dat). Noise alone, 5 % of the Y range over 400 points, gives
 *  well under 0.1 %, so this sits between the two. */
const LOOP_AREA_FRACTION = 0.003;
const MIN_POINTS = 20;

type Branch = { x: number[]; y: number[]; dir: 1 | -1 };

/** Split into monotone sweeps at every reversal larger than `step`. */
function sweeps(px: readonly number[], py: readonly number[], step: number): Branch[] {
  const out: Branch[] = [];
  let dir = 0;
  let extreme = 0; // index of the running extreme of the current sweep
  let from = 0;
  const close = (end: number, d: 1 | -1) => out.push({ x: px.slice(from, end + 1), y: py.slice(from, end + 1), dir: d });
  for (let i = 1; i < px.length; i++) {
    if (dir === 0) {
      if (px[i] - px[0] > step) { dir = 1; extreme = i; }
      else if (px[0] - px[i] > step) { dir = -1; extreme = i; }
    } else if (dir === 1) {
      if (px[i] > px[extreme]) extreme = i;
      else if (px[extreme] - px[i] > step) { close(extreme, 1); from = extreme; dir = -1; extreme = i; }
    } else if (px[i] < px[extreme]) extreme = i;
    else if (px[i] - px[extreme] > step) { close(extreme, -1); from = extreme; dir = 1; extreme = i; }
  }
  if (dir !== 0) close(px.length - 1, dir === 1 ? 1 : -1);
  return out;
}

const span = (b: Branch): number => Math.max(...b.x) - Math.min(...b.x);

/** y of a branch at `v` by linear interpolation (the branch sorted by X); null outside it. */
function interpolator(b: Branch): (v: number) => number | null {
  const order = b.x.map((_, i) => i).sort((i, j) => b.x[i] - b.x[j]);
  const xs = order.map((i) => b.x[i]);
  const ys = order.map((i) => b.y[i]);
  return (v) => {
    if (v < xs[0] || v > xs[xs.length - 1]) return null;
    let lo = 0;
    let hi = xs.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] <= v) lo = mid;
      else hi = mid;
    }
    return xs[hi] === xs[lo] ? ys[lo] : ys[lo] + ((ys[hi] - ys[lo]) * (v - xs[lo])) / (xs[hi] - xs[lo]);
  };
}

export function looksLikeHysteresisLoop(x: ArrayLike<number>, y: ArrayLike<number>): boolean {
  const px: number[] = [];
  const py: number[] = [];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (Number.isFinite(x[i]) && Number.isFinite(y[i])) {
      px.push(x[i]);
      py.push(y[i]);
    }
  }
  if (px.length < MIN_POINTS) return false;
  const xlo = Math.min(...px);
  const xhi = Math.max(...px);
  const ylo = Math.min(...py);
  const yhi = Math.max(...py);
  if (!(xlo < 0 && xhi > 0) || yhi <= ylo) return false;
  const all = sweeps(px, py, (xhi - xlo) * REVERSAL_FRACTION);
  const up = all.filter((b) => b.dir === 1).sort((a, b) => span(b) - span(a))[0];
  const down = all.filter((b) => b.dir === -1).sort((a, b) => span(b) - span(a))[0];
  if (!up || !down) return false;
  const yUp = interpolator(up);
  let area = 0;
  let prev: { x: number; d: number } | null = null;
  const sorted = down.x.map((_, i) => i).sort((i, j) => down.x[i] - down.x[j]);
  for (const i of sorted) {
    const u = yUp(down.x[i]);
    if (u === null) continue;
    const d = u - down.y[i];
    if (prev && down.x[i] > prev.x) area += ((prev.d + d) / 2) * (down.x[i] - prev.x);
    prev = { x: down.x[i], d };
  }
  return Math.abs(area) > LOOP_AREA_FRACTION * (xhi - xlo) * (yhi - ylo);
}
