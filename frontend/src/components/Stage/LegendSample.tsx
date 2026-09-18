import { markerDecision } from "../../lib/markers";
import type { DefaultTrace, MarkerShape, SeriesStyle } from "../../lib/types";

interface LegendSampleProps {
  color: string;
  style?: SeriesStyle;
  defaultTrace?: DefaultTrace;
}

const DASH: Record<string, string | undefined> = {
  dashed: "6 3",
  dotted: "1.5 3",
};

function marker(shape: MarkerShape, color: string, radius: number) {
  const cx = 12;
  const cy = 6;
  const common = { stroke: color, strokeWidth: 1.5 };
  switch (shape) {
    case "square":
      return <rect x={cx - radius} y={cy - radius} width={radius * 2} height={radius * 2} fill={color} {...common} />;
    case "triangle":
      return <polygon points={`${cx},${cy - radius} ${cx + radius},${cy + radius} ${cx - radius},${cy + radius}`} fill={color} {...common} />;
    case "downtriangle":
      return <polygon points={`${cx},${cy + radius} ${cx - radius},${cy - radius} ${cx + radius},${cy - radius}`} fill={color} {...common} />;
    case "diamond":
      return <polygon points={`${cx},${cy - radius} ${cx + radius},${cy} ${cx},${cy + radius} ${cx - radius},${cy}`} fill={color} {...common} />;
    case "plus":
      return <path d={`M${cx - radius} ${cy}H${cx + radius}M${cx} ${cy - radius}V${cy + radius}`} fill="none" {...common} />;
    case "cross":
      return <path d={`M${cx - radius} ${cy - radius}L${cx + radius} ${cy + radius}M${cx - radius} ${cy + radius}L${cx + radius} ${cy - radius}`} fill="none" {...common} />;
    case "star": {
      const d = radius * 0.7;
      return <path d={`M${cx - radius} ${cy}H${cx + radius}M${cx} ${cy - radius}V${cy + radius}M${cx - d} ${cy - d}L${cx + d} ${cy + d}M${cx - d} ${cy + d}L${cx + d} ${cy - d}`} fill="none" {...common} />;
    }
    default:
      // Match uPlot's built-in circle: series-colour stroke with white fill.
      return <circle cx={cx} cy={cy} r={radius} fill="#fff" {...common} />;
  }
}

/** Compact legend sample using the same trace/style precedence as buildOpts.
 *
 *  The marker half is not restated here — it comes from `markers.markerDecision`,
 *  the SAME function `markers.seriesPoints` builds the canvas' `points` config
 *  from. Restating it is how this swatch drifted: it took the glyph from
 *  `style.markerShape` whenever markers showed at all, so with P3.3's cycle on
 *  and a `Scatter` / `Line + markers` default trace the legend drew
 *  circle/square/triangle while the canvas drew three plain 5px circles and the
 *  export emitted no marker at all.
 *
 *  THIS SWATCH CHANGED WITH THE PREFERENCE OFF TOO, deliberately — the one
 *  render path the third review found where "off is byte-identical to before the
 *  feature" does not hold, which is why that claim is now narrowed rather than
 *  repeated (plans/PRIMARY_SOFTWARE_AUDIT_PLAN.md P3.3, "Off is the identity,
 *  with ONE stated exception"). A
 *  stored `{marker:false, markerShape, markerSize}` on a `Scatter` /
 *  `Line + markers` series used to render that stored glyph at that stored size
 *  (the old local rule was `marker || scatter || line+markers` for WHETHER, then
 *  `style.markerShape ?? "circle"` for WHICH — so `marker:false` still drew a
 *  diamond). `SeriesStyleCard` keeps both fields when "Markers" is unticked, so
 *  the combination is ordinary. The canvas has never drawn that glyph: with
 *  `marker` off, `buildOpts` gives uPlot's plain 5px circle. The legend was
 *  simply wrong, and the swatch now says circle. Frozen as a literal
 *  expectation in `PlotLegend.test.tsx` ("the deliberate OFF-state change"), not
 *  filed under byte-identical — the 32-combination differential OFF proof beside
 *  it compares this component against ITSELF and structurally cannot see it. */
export default function LegendSample({ color, style, defaultTrace = "Line" }: LegendSampleProps) {
  const width = style?.width ?? (defaultTrace === "Scatter" ? 0 : 1.5);
  const showLine = width > 0;
  const { show: showMarker, shape, size } = markerDecision(style, defaultTrace);
  const radius = Math.max(2, Math.min(4.5, size / 2));

  return (
    <svg
      className="ln qzk-legend-sample"
      viewBox="0 0 24 12"
      aria-hidden="true"
      data-line={showLine ? "true" : "false"}
      data-marker={showMarker ? shape : "none"}
    >
      {showLine && (
        <line
          x1="1"
          x2="23"
          y1="6"
          y2="6"
          stroke={color}
          strokeWidth={Math.max(1, Math.min(4, width))}
          strokeDasharray={style?.line ? DASH[style.line] : undefined}
        />
      )}
      {showMarker && marker(shape, color, radius)}
    </svg>
  );
}
