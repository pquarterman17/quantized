// The plot-decoration element types (reference lines + XRD sticks, region shades,
// text annotations, drawn shapes), split out of types.ts when it outgrew its line
// pin and re-exported from there verbatim, so no importer changed.

/** Display and provenance carried by an XRD reference-pattern stick. Fractions
 * are relative to the plot frame, so the overlay remains readable on linear
 * and logarithmic intensity axes without pretending the stick intensity is a
 * measured Y value. */
export interface ReferenceStick {
  /** Relative intensity normalized to the strongest imported reflection. */ intensity: number;
  /** Baseline and maximum stick height as fractions of the plot height. */
  baseline: number;
  height: number;
  color: string;
  visible: boolean;
  showLabel: boolean;
}

/** A reference line drawn across the plot at a fixed X or Y value (mark Hc, Tc,
 * zero, a critical edge…), or an XRD reference stick when `stick` is present.
 * Rendered by the uPlot refLinePlugin. */
export interface RefLine {
  id: string;
  axis: "x" | "y";
  value: number;
  /** Optional scientific identity for generated lines (for example hkl). */
  label?: string;
  /** Lines created by one analysis action can be removed as one undo step. */
  groupId?: string;
  groupLabel?: string;
  stick?: ReferenceStick;
}

/** A filled rectangular region pinned at data coordinates (Origin `Rect*`
 *  region bands — film-stack shading on an SLD profile, decode-plan #41).
 *  Drawn translucently BEHIND the data by the uPlot regionShadePlugin
 *  (Origin's fill-transparency field is undecoded — the render alpha is a
 *  fixed presentation choice, see the plugin). `x1 < x2`, `y1 < y2`. */
export interface RegionShade {
  id: string;
  x1: number;
  x2: number;
  y1: number;
  y2: number;
  /** Fill colour "#RRGGBB", decoded from Origin's ocolor — shades whose
   *  colour didn't decode are never mapped into the store (no guessing). */
  fill: string;
  /** Which Y scale y1/y2 are expressed in: 0/undefined = primary, 1 =
   *  secondary (y2) — same convention as `Annotation.axis`. */
  axis?: 0 | 1;
  /** Span the whole plot height (y1/y2 ignored) — the default for a newly
   *  inserted shade: it reads the same on a linear or log axis and never
   *  depends on the data's y range (publication-figures audit #11). */
  fullHeight?: boolean;
}

/** A text annotation pinned at a data coordinate (label a peak, a feature, a
 *  transition…). Drawn by the uPlot annotationPlugin as a dot + label.
 *  `y` is always in the coordinate space named by `axis`. */
export interface Annotation {
  id: string;
  /** Optional persistent Object Manager group. Grouping changes selection and
   *  bulk-edit behavior only; it never changes rendering coordinates. */
  groupId?: string;
  x: number;
  y: number;
  text: string;
  /** Which Y scale `y` is expressed in: 0/undefined = primary, 1 = secondary
   *  (y2). Only ever set for the upper layer's marks in an Origin double-Y
   *  apply (`originFigureAnnotations`); manual annotations never set it, so
   *  they always plot on the primary axis. Ignored (falls back to the
   *  primary axis) when the plot has no y2 scale. */
  axis?: 0 | 1;
  /** Font size override, px (MAIN #18 — the pointer tool's corner-handle
   *  resize gesture). Absent = the plot's default annotation font size (the
   *  axis tick font — see `uplotOpts.buildOpts`'s `font`). Clamped to
   *  [MIN_ANNOTATION_SIZE, MAX_ANNOTATION_SIZE] (`lib/uplotOverlays.ts`)
   *  wherever it's set. */
  size?: number;
  /** Coordinate space for `x`/`y` (MAIN #21 — Origin's page-text model).
   *  Absent/"data" (the default, back-compat with every annotation created
   *  before this field existed): `x`/`y` are data coordinates through
   *  `valToPos`/`posToVal` — the annotation moves with zoom/pan, exactly
   *  today's behaviour. "page": `x`/`y` are CANVAS FRACTIONS in [0, 1] (x
   *  rightward, y downward — canvas convention, NOT matplotlib's
   *  figure-fraction convention, which grows upward — see
   *  `calc/figure_overrides.py`'s y-flip for the export-parity boundary
   *  between the two) — the annotation stays pinned to the same spot on the
   *  PAGE through zoom/pan, resize-stable the same way `PlotView.legendXY`
   *  is. The right-click object menu's "Pin to page/data" toggle
   *  (`useAnnotationEdit.openMenu`) converts `x`/`y` in place when flipping
   *  this field so the label never visibly jumps. */
  anchor?: "data" | "page";
  /** A rect drawn BEHIND this annotation's text (MAIN #27's "text box" —
   *  NOT a sixth `Shape` kind: it rides the annotation's own anchor/size/
   *  drag, just with a filled/stroked backing rect). Absent = no frame (the
   *  pre-#27 look). `pad` is CSS px around the measured text box on every
   *  side; `opacity`/`fill`/`stroke` default the same way a `Shape`'s do
   *  (see `lib/uplotShapes.ts`'s `resolveShapeOpacity`) when a preset is
   *  picked without a custom color. */
  frame?: { fill?: string; stroke?: string; opacity?: number; pad?: number };
  /** Anchor dot: only an explicit `false` hides it (absent = shown, the legacy look). */
  dot?: boolean;
}

/** A drawn shape pinned on the plot (MAIN #27): mark Hc2 with an arrow, box a
 *  transition region, circle an outlier. `anchor` follows `Annotation`'s
 *  convention — "data" (default) coordinates run through valToPos/posToVal
 *  (the shape stretches/moves with zoom+pan, e.g. a rect marking a field
 *  range); "page" coordinates are canvas fractions in [0, 1], resize-stable
 *  like `PlotView.legendXY` / a page-anchored annotation. `opacity` is ONE
 *  knob (0..1) for the WHOLE shape (fill AND stroke) — default 1 for
 *  line/arrow, 0.35 for rect/ellipse (so a freshly drawn box is visibly
 *  translucent over the data it's marking) — see `lib/uplotShapes.ts`'s
 *  `resolveShapeOpacity`. `fill` only applies to rect/ellipse (arrow/line
 *  ignore it); default stroke = the plot's annotation ink color, default
 *  fill = the shape's own (resolved) stroke — both resolved at draw/export
 *  time, never stored unless the user picks a custom color. */
export interface Shape {
  id: string;
  /** Optional persistent Object Manager group; see `Annotation.groupId`. */
  groupId?: string;
  /** `slope` | `distance` | `angle` | `scalebar` are MEASUREMENTS (`lib/annotationMeasure.ts`):
   *  always data-anchored, labelled in data units. angle: vertex (x1,y1), arms to (x2,y2) and (x3,y3);
   *  scalebar: from (x1,y1) `length` data units along `orient`, ending at (x2,y2). */
  kind: "arrow" | "line" | "rect" | "ellipse" | "slope" | "distance" | "angle" | "scalebar";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** angle: the second arm's end. */
  x3?: number;
  y3?: number;
  /** scalebar: length in data units, direction, and a label that replaces the length. */
  length?: number;
  orient?: "h" | "v";
  text?: string;
  /** slope: draw the right-triangle slope marker. */
  triangle?: boolean;
  anchor?: "data" | "page";
  stroke?: string;
  fill?: string;
  opacity?: number;
  width?: number;
  dash?: boolean;
}
