// The floating glass tool-dock over the plot: tool picker (zoom/pan/cursor/
// measure/stats) + view actions (reset/save-PNG/copy-data) + alternate render
// modes (stack/inset/polar). Reads the tool + mode flags from the store; the
// view actions close over the live uPlot instance in PlotStage, so they come in
// as props. Extracted from PlotStage to keep that component lean.

import { useApp } from "../../store/useApp";

// Navigation + inspection tools (pointer/zoom/pan/cursor/measure/stats).
// Pointer is FIRST and the store default (MAIN #18, owner directive from
// live testing): a plain arrow cursor with no dashed crosshair, for
// selecting/arranging plot objects (annotations, legend, ref lines) — the
// data-reading/measurement tools that follow it keep their crosshair.
const TOOLS = [
  { id: "pointer", glyph: "➤", tip: "Pointer (select & arrange)" },
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
  {
    id: "qfit",
    glyph: "≈",
    tip: "Gadget — drag a region (Fit/Integrate/Stats/Differentiate/FFT) or place cursors, live",
  },
] as const;

interface Props {
  onReset: () => void;
  onSmartScale: () => void;
  onSavePng: () => void;
  onCopyData: () => void;
  onSnapshot: () => void;
  /** Item 11: freeze the current plot into a static compare window (the ⎘
   *  clipboard snapshot's in-app sibling). */
  onSnapshotWindow: () => void;
}

export default function PlotToolbar({
  onReset,
  onSmartScale,
  onSavePng,
  onCopyData,
  onSnapshot,
  onSnapshotWindow,
}: Props) {
  const tool = useApp((s) => s.plotTool);
  const setPlotTool = useApp((s) => s.setPlotTool);
  const stackMode = useApp((s) => s.stackMode);
  const setStackMode = useApp((s) => s.setStackMode);
  const insetMode = useApp((s) => s.insetMode);
  const setInsetMode = useApp((s) => s.setInsetMode);
  const polarMode = useApp((s) => s.polarMode);
  const setPolarMode = useApp((s) => s.setPolarMode);
  const statMode = useApp((s) => s.statMode);
  const setStatMode = useApp((s) => s.setStatMode);

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
      <button
        className="qzk-tool-btn"
        title="Snapshot to a new window (frozen compare)"
        onClick={onSnapshotWindow}
      >
        ⊞
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
      <button
        className={`qzk-tool-btn${statMode ? " active" : ""}`}
        title="Statistics (box / violin / Q-Q / histogram)"
        onClick={() => setStatMode(true)}
      >
        ▦
      </button>
    </div>
  );
}
