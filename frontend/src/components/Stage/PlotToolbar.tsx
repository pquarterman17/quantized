// The floating glass tool-dock over the plot: tool picker (zoom/pan/cursor/
// measure/stats) + view actions (reset/save-PNG/copy-data) + alternate render
// modes (stack/inset/polar). Reads the tool + mode flags from the store; the
// view actions close over the live uPlot instance in PlotStage, so they come in
// as props. Extracted from PlotStage to keep that component lean.

import { useApp } from "../../store/useApp";

// Navigation + inspection tools (zoom/pan/cursor/measure/stats).
const TOOLS = [
  { id: "zoom", glyph: "⛶", tip: "Box zoom" },
  { id: "pan", glyph: "✥", tip: "Pan" },
  { id: "cursor", glyph: "✛", tip: "Data cursor" },
  { id: "measure", glyph: "∡", tip: "Measure (Δx, Δy, slope)" },
  { id: "stats", glyph: "Σ", tip: "Region stats (drag a range)" },
  { id: "select", glyph: "⬚", tip: "Select rows (drag an x-range → worksheet)" },
] as const;

// Region-analysis tools — drag a range; the result persists as a chip (∫ / ∩).
const ANALYZE_TOOLS = [
  { id: "integ", glyph: "∫", tip: "Integrate — area under the curve (drag a range)" },
  { id: "fwhm", glyph: "∩", tip: "Peak / FWHM (drag a range)" },
] as const;

interface Props {
  onReset: () => void;
  onSmartScale: () => void;
  onSavePng: () => void;
  onCopyData: () => void;
  onSnapshot: () => void;
}

export default function PlotToolbar({
  onReset,
  onSmartScale,
  onSavePng,
  onCopyData,
  onSnapshot,
}: Props) {
  const tool = useApp((s) => s.plotTool);
  const setPlotTool = useApp((s) => s.setPlotTool);
  const stackMode = useApp((s) => s.stackMode);
  const setStackMode = useApp((s) => s.setStackMode);
  const insetMode = useApp((s) => s.insetMode);
  const setInsetMode = useApp((s) => s.setInsetMode);
  const polarMode = useApp((s) => s.polarMode);
  const setPolarMode = useApp((s) => s.setPolarMode);

  return (
    <div className="qzk-glass qzk-float-tools">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          className={`qzk-tool-btn${tool === t.id ? " active" : ""}`}
          title={t.tip}
          onClick={() => setPlotTool(t.id)}
        >
          {t.glyph}
        </button>
      ))}
      <span className="qzk-tool-sep" />
      {ANALYZE_TOOLS.map((t) => (
        <button
          key={t.id}
          className={`qzk-tool-btn${tool === t.id ? " active" : ""}`}
          title={t.tip}
          onClick={() => setPlotTool(t.id)}
        >
          {t.glyph}
        </button>
      ))}
      <span className="qzk-tool-sep" />
      <button className="qzk-tool-btn" title="Reset view (or double-click the plot)" onClick={onReset}>
        ⊡
      </button>
      <button className="qzk-tool-btn" title="Smart auto-scale (pick log/linear)" onClick={onSmartScale}>
        ⊿
      </button>
      <button className="qzk-tool-btn" title="Save plot as PNG" onClick={onSavePng}>
        ⤓
      </button>
      <button className="qzk-tool-btn" title="Copy plotted data (TSV)" onClick={onCopyData}>
        ⧉
      </button>
      <button className="qzk-tool-btn" title="Copy plot image to clipboard (PNG)" onClick={onSnapshot}>
        ⎘
      </button>
      <span className="qzk-tool-sep" />
      <button
        className={`qzk-tool-btn${stackMode ? " active" : ""}`}
        title="Stack channels in separate panels"
        onClick={() => setStackMode(true)}
      >
        ▤
      </button>
      <button
        className={`qzk-tool-btn${insetMode ? " active" : ""}`}
        title="Magnifier inset"
        onClick={() => setInsetMode(!insetMode)}
      >
        ⊕
      </button>
      <button
        className={`qzk-tool-btn${polarMode ? " active" : ""}`}
        title="Polar plot (angle vs radius)"
        onClick={() => setPolarMode(true)}
      >
        ✺
      </button>
    </div>
  );
}
