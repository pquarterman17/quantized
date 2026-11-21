// Wire types of an imported Origin figure's map plot (`OriginFigure.map` /
// `.ternary`, backend `io/origin_project/opju_map_plots.py`). Types only.
// `coordinates` beside them in `OriginFigure` is the polar layer
// (`opju_layer_kind.py`).

/** A heatmap / contour / image of a matrix book (no x/y/z: the matrix's own
 *  X, Y, Z), or an XYZ contour's X, Y, Z column letters. */
export interface OriginMapSpec {
  book: string;
  kind: "heatmap" | "contour" | "image";
  x?: string;
  y?: string;
  z?: string;
}

/** An Origin ternary plot: its A, B, C column letters, in axis order. */
export interface OriginTernarySpec {
  book: string;
  a: string;
  b: string;
  c: string;
}

/** An Origin pie / doughnut layer (io/origin_project/opju_pie.py): wedge
 *  values from each Y column (one ring per column, the first innermost),
 *  labels from the X column, `hole` the doughnut hole / outer radius. */
export interface OriginPieSpec {
  book: string;
  x: string;
  y: string[];
  hole: number;
}
