// Line polish for a plotted series (plan item 17, Origin's Plot Details › Line):
// the pure geometry of "gap to symbol" and the double (compound) line, shared
// in spirit and in numbers with the export's `calc/figure_line_style.py` and
// pinned to the same wire fixture (`tests/fixtures/wire/line_style.json`).
//
// Everything here works on DISPLAY coordinates in one length unit: the canvas
// passes device pixels, the export passes pixels at its figure dpi, and the
// fixture's kernel cases pass points. The gap, the symbol radius and the
// separation are in that same unit, so the rule is unit-free.
//
// * Gap to symbol: where a point carries a symbol, a segment ending there stops
//   `radius + gap` short of its centre. A segment too short to keep any line
//   between its two trims is not drawn. Without a gap the whole run is one line.
// * Double line: every piece of the (trimmed) line is drawn as two parallel
//   strokes `sep` apart, each offset `sep / 2` along the vertex normals, with a
//   mitre limited to `MITRE_LIMIT` so a sharp turn cannot spike.
// * A point with a non-finite coordinate breaks the line, as it does everywhere.
//
// These options are display-only: they never change data or analysis.

/** Longest mitre, as a multiple of the half separation. */
export const MITRE_LIMIT = 4;
type Pt = readonly [number, number];

/** The pieces of the line over `xs`/`ys` after the symbol gap: each a polyline of points. */
export function gappedPieces(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  marked: (i: number) => boolean,
  radius: number,
  gap: number,
): Pt[][] {
  const n = Math.min(xs.length, ys.length);
  const ok = (i: number) => Number.isFinite(xs[i]) && Number.isFinite(ys[i]);
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  const flush = () => {
    if (cur.length >= 2) out.push(cur);
    cur = [];
  };
  const trim = radius + gap;
  for (let i = 0; i + 1 < n; i++) {
    if (!ok(i) || !ok(i + 1)) {
      flush();
      continue;
    }
    const dx = xs[i + 1] - xs[i];
    const dy = ys[i + 1] - ys[i];
    const len = Math.hypot(dx, dy);
    if (len === 0) continue; // a repeated point: no segment, the line carries on
    const ts = gap > 0 && marked(i) ? trim : 0;
    const te = gap > 0 && marked(i + 1) ? trim : 0;
    if (ts + te >= len) {
      flush();
      continue;
    }
    const ux = dx / len;
    const uy = dy / len;
    if (ts > 0) {
      flush();
      cur = [[xs[i] + ux * ts, ys[i] + uy * ts]];
    } else if (cur.length === 0) {
      cur = [[xs[i], ys[i]]];
    }
    cur.push([xs[i + 1] - ux * te, ys[i + 1] - uy * te]);
    if (te > 0) flush();
  }
  flush();
  return out;
}

/** One parallel copy of `piece`, `h` to the left of its direction (negative `h`: the right). */
export function offsetPiece(piece: readonly Pt[], h: number): Pt[] {
  const m = piece.length;
  const nx: number[] = [];
  const ny: number[] = [];
  for (let k = 0; k + 1 < m; k++) {
    const dx = piece[k + 1][0] - piece[k][0];
    const dy = piece[k + 1][1] - piece[k][1];
    const len = Math.hypot(dx, dy);
    nx.push(-dy / len);
    ny.push(dx / len);
  }
  return piece.map(([x, y], k) => {
    if (k === 0) return [x + nx[0] * h, y + ny[0] * h];
    if (k === m - 1) return [x + nx[k - 1] * h, y + ny[k - 1] * h];
    const sx = nx[k - 1] + nx[k];
    const sy = ny[k - 1] + ny[k];
    const sl = Math.hypot(sx, sy);
    if (sl < 1e-12) return [x + nx[k] * h, y + ny[k] * h]; // a full reversal: no mitre exists
    const mx = sx / sl;
    const my = sy / sl;
    const scale = Math.min(1 / (mx * nx[k] + my * ny[k]), MITRE_LIMIT);
    return [x + mx * scale * h, y + my * scale * h];
  });
}

/** The strokes to draw for a line: the gapped pieces, each doubled when `sep` > 0 (left copy, then right). */
export function lineStrokes(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  marked: (i: number) => boolean,
  radius: number,
  gap: number,
  sep: number,
): Pt[][] {
  const pieces = gappedPieces(xs, ys, marked, radius, gap);
  if (!(sep > 0)) return pieces;
  return pieces.flatMap((p) => [offsetPiece(p, sep / 2), offsetPiece(p, -sep / 2)]);
}
