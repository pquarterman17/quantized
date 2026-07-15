// Pure geometry: infer a panel grid arrangement from an Origin multi-layer
// graph window's decoded per-layer frame quads (`figure_geometry.py`, page
// units, top-left origin, y increasing downward — same convention as the
// annotation/legend position model). Store-agnostic and dataset-agnostic —
// `store/useApp.ts`'s `applyOriginFigure` zips the result against each
// layer's resolved dataset/channel selection (see `originFigures.ts`'s
// `resolveFigurePanels`) to build the drawn multi-panel view.

export interface FrameQuad {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PageSize {
  width: number;
  height: number;
}

export interface PanelPlacement {
  /** Index into the input `frames` array this placement is for. */
  index: number;
  row: number;
  col: number;
  /** Frame rectangle normalized to the trusted tiled frames' bounding box.
   *  Absent on ordinal fallback placements. */
  rect?: NormalizedFrameRect;
}

export interface NormalizedFrameRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PanelLayout {
  rows: number;
  cols: number;
  /** One entry per input frame, in the SAME order as the input array. */
  placements: PanelPlacement[];
  /** Width / height of the recovered frame composition. Renderers use it to
   *  letterbox the composition instead of stretching it to the stage. */
  aspectRatio?: number;
  /** True when the arrangement came from real frame geometry; false when it
   *  is the ordinal single-column fallback (a missing/degenerate frame, or
   *  frames that overlap rather than tile the page) — callers may still
   *  show it (Origin multi-layer windows are usually vertical stacks even
   *  when this run's frame decode came up empty) but shouldn't claim
   *  spatial fidelity when reporting it back to the user. */
  spatial: boolean;
}

/** Tolerance for clustering frame edges into the same row/col, as a fraction
 *  of the page span — Origin's own panel layouts use clean fractions, but
 *  tolerate real-world slop (rounding in the decoded page-unit ints). */
const CLUSTER_TOL_FRACTION = 0.08;
/** An overlap this large relative to the SMALLER frame's own area means the
 *  two frames aren't tiling the page (a real multi-panel layout never stacks
 *  panels on top of each other) — bail to the ordinal fallback rather than
 *  report a bogus grid. */
const OVERLAP_TOL_FRACTION = 0.02;

/** Overlap fraction — relative to BOTH frames' own areas — above which two
 *  frames are considered to occupy essentially the SAME page rectangle.
 *  Origin's double-Y idiom draws a y2 overlay layer at its host's EXACT
 *  frame (verified against the PNR/S7/Book33 corpus figure: layers 2 and 3
 *  decode byte-identical frame quads), so near-total MUTUAL overlap is a
 *  "same panel" signal — structurally different from the partial/one-sided
 *  overlap `OVERLAP_TOL_FRACTION` guards against above (a real multi-panel
 *  layout whose decoded frames disagree, which should still bail to the
 *  ordinal fallback). Consumed by `originFigures.figureFrameY2Pairs`, which
 *  also checks the figure-level y2-ness heuristics (dataset/curves/y-range/
 *  x-range) before treating a coincident pair as a real double-Y overlay —
 *  this predicate is pure geometry only, so a caller wanting the full
 *  picture must not skip that further check. */
const COINCIDENT_OVERLAP_FRACTION = 0.9;

/** True when `a` and `b` occupy (near enough) the same page rectangle: BOTH
 *  directions of overlap-vs-own-area must clear `COINCIDENT_OVERLAP_FRACTION`,
 *  so a large frame that merely CONTAINS a much smaller one (an inset/legend
 *  box, or the "nested, not tiled" shape `computePanelLayout`'s own fallback
 *  test already covers) never counts as coincidence. Degenerate frames never
 *  coincide. */
export function framesCoincide(a: FrameQuad, b: FrameQuad): boolean {
  if (isDegenerate(a) || isDegenerate(b)) return false;
  const ov = overlapArea(a, b);
  if (ov <= 0) return false;
  const aArea = area(a);
  const bArea = area(b);
  if (aArea <= 0 || bArea <= 0) return false;
  return ov / aArea > COINCIDENT_OVERLAP_FRACTION && ov / bArea > COINCIDENT_OVERLAP_FRACTION;
}

function isDegenerate(f: FrameQuad): boolean {
  return !(f.right > f.left) || !(f.bottom > f.top);
}

function area(f: FrameQuad): number {
  return Math.max(0, f.right - f.left) * Math.max(0, f.bottom - f.top);
}

function overlapArea(a: FrameQuad, b: FrameQuad): number {
  const l = Math.max(a.left, b.left);
  const r = Math.min(a.right, b.right);
  const t = Math.max(a.top, b.top);
  const bo = Math.min(a.bottom, b.bottom);
  if (r <= l || bo <= t) return 0;
  return (r - l) * (bo - t);
}

/** One column, input order top-to-bottom — the safe default for an Origin
 *  multi-layer window when the real geometry can't be trusted. */
function ordinalFallback(n: number): PanelLayout {
  return {
    rows: n,
    cols: 1,
    placements: Array.from({ length: n }, (_, i) => ({ index: i, row: i, col: 0 })),
    spatial: false,
  };
}

/** Cluster `values` into groups whose members are within `tol` of the
 *  group's running start (ascending scan) — returns each input's 0-based
 *  group index, aligned 1:1 with `values`' own order (not sorted order). */
function clusterIndices(values: number[], tol: number): number[] {
  const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
  const groupOf = new Array<number>(values.length).fill(0);
  let group = 0;
  let groupStart = values[order[0]];
  for (const idx of order) {
    if (values[idx] - groupStart > tol) {
      group++;
      groupStart = values[idx];
    }
    groupOf[idx] = group;
  }
  return groupOf;
}

/** How far a frame may exceed the declared page bound and still be trusted
 *  (page-unit rounding slop) — beyond this the frame/page pair disagree
 *  (e.g. a mismatched decode), so the geometry isn't trustworthy. Mirrors
 *  the backend's own `opju_page_size` structural-validation spirit. */
const PAGE_SLOP_FACTOR = 1.1;

/** Infer a grid arrangement for a multi-layer figure's panels from their
 *  decoded frame quads (`null`/`undefined` for an undecoded layer). `page`
 *  is optional — when given, it's used to sanity-check the frames (a frame
 *  that overshoots the page bound means the frame/page pair don't agree,
 *  so the geometry is untrusted); the clustering tolerance itself is always
 *  scaled off the frames' own bounding box. Returns `spatial: false` (a
 *  plain top-to-bottom single-column stack, in input order) when any frame
 *  is missing or degenerate, when frames overlap rather than tile the page,
 *  when the page doesn't plausibly contain them, or when there is nothing
 *  to place. */
export function computePanelLayout(
  frames: ReadonlyArray<FrameQuad | null | undefined>,
  page?: PageSize | null,
): PanelLayout {
  const n = frames.length;
  if (n === 0) {
    return { rows: 0, cols: 0, placements: [], spatial: false };
  }
  if (frames.some((f) => !f || isDegenerate(f))) return ordinalFallback(n);
  const quads = frames as FrameQuad[];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const ov = overlapArea(quads[i], quads[j]);
      if (ov <= 0) continue;
      const smaller = Math.min(area(quads[i]), area(quads[j]));
      if (smaller > 0 && ov / smaller > OVERLAP_TOL_FRACTION) return ordinalFallback(n);
    }
  }
  if (page && page.width > 0 && page.height > 0) {
    const maxRight = Math.max(...quads.map((f) => f.right));
    const maxBottom = Math.max(...quads.map((f) => f.bottom));
    if (maxRight > page.width * PAGE_SLOP_FACTOR || maxBottom > page.height * PAGE_SLOP_FACTOR) {
      return ordinalFallback(n); // frame/page disagree — don't trust either
    }
  }
  const bboxW = Math.max(...quads.map((f) => f.right)) - Math.min(...quads.map((f) => f.left));
  const bboxH = Math.max(...quads.map((f) => f.bottom)) - Math.min(...quads.map((f) => f.top));
  if (bboxW <= 0 || bboxH <= 0) return ordinalFallback(n);
  const rowOf = clusterIndices(quads.map((f) => f.top), CLUSTER_TOL_FRACTION * bboxH);
  const colOf = clusterIndices(quads.map((f) => f.left), CLUSTER_TOL_FRACTION * bboxW);
  const minLeft = Math.min(...quads.map((f) => f.left));
  const minTop = Math.min(...quads.map((f) => f.top));
  return {
    rows: Math.max(...rowOf) + 1,
    cols: Math.max(...colOf) + 1,
    placements: quads.map((frame, i) => ({
      index: i,
      row: rowOf[i],
      col: colOf[i],
      rect: {
        left: (frame.left - minLeft) / bboxW,
        top: (frame.top - minTop) / bboxH,
        width: (frame.right - frame.left) / bboxW,
        height: (frame.bottom - frame.top) / bboxH,
      },
    })),
    aspectRatio: bboxW / bboxH,
    spatial: true,
  };
}
