import type { MarkerShape, SeriesStyle } from "../../lib/types";

interface LegendSampleProps {
  color: string;
  style?: SeriesStyle;
  defaultTrace?: string;
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

/** Compact legend sample using the same trace/style precedence as buildOpts. */
export default function LegendSample({ color, style, defaultTrace = "Line" }: LegendSampleProps) {
  const scatter = defaultTrace === "Scatter";
  const width = style?.width ?? (scatter ? 0 : 1.5);
  const showLine = width > 0;
  const showMarker = Boolean(style?.marker || scatter || defaultTrace === "Line + markers");
  const shape = style?.markerShape ?? "circle";
  const radius = Math.max(2, Math.min(4.5, (style?.markerSize ?? 5) / 2));

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
