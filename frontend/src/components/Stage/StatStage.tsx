// Statistics stage (gap #16): a Canvas2D view over Box / Violin / Q-Q /
// Histogram+fit, entered via the "Statistics" toggle in PlotToolbar — a
// store-boolean early-return alongside polarMode/stackMode, NOT a 4th Stage
// tab (box/violin is a view of the SAME dataset, like polar). Mirrors
// PolarStage's self-contained Canvas2D structure; MapStage's own floating
// picker toolbar is the precedent for the mode/column controls. Thin: all
// state lives in useStatStage, all math in lib/statstage + statRender.

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import type { StatMode } from "../../lib/statstage";
import { useApp } from "../../store/useApp";
import { Button, SegmentedControl, Select } from "../primitives";
import { draw } from "./statRender";
import { BIN_RULES, DISTRIBUTIONS, useStatStage } from "./useStatStage";

const MODE_OPTIONS: { value: StatMode; label: string }[] = [
  { value: "box", label: "Box" },
  { value: "violin", label: "Violin" },
  { value: "qq", label: "Q-Q" },
  { value: "histogram", label: "Histogram" },
];

export default function StatStage() {
  const theme = useApp((s) => s.theme);
  const accent = useApp((s) => s.accent);
  const setStatMode = useApp((s) => s.setStatMode);
  const st = useStatStage();
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const paint = () => draw(canvas, host, st.draw);
    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(host);
    return () => ro.disconnect();
    // theme/accent so the plot recolors from fresh design tokens (PolarStage's pattern).
  }, [st.draw, theme, accent]);

  async function onExport() {
    setExporting(true);
    try {
      await st.exportFigure("pdf");
      useApp.getState().setStatus("exported statistical-plot figure");
    } catch (e) {
      useApp.getState().setStatus(e instanceof Error ? e.message : "export failed");
    } finally {
      setExporting(false);
    }
  }

  const groupByOptions = [
    { value: "channel", label: "(per channel)" },
    ...st.categoricalCols.map((c) => ({ value: String(c.index), label: c.label })),
  ];
  const columnOptions = st.columns.map((c) => ({ value: String(c.index), label: c.label }));

  return (
    <div className="qzk-stage">
      <div ref={hostRef} style={{ position: "absolute", inset: 8 }}>
        <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
      </div>

      <div
        className="qzk-glass qzk-float-tools"
        style={{ gap: 10, padding: "6px 10px", flexWrap: "wrap", maxWidth: "92vw", justifyContent: "center" }}
      >
        <button
          className="qzk-tool-btn active"
          title="Back to a cartesian plot"
          onClick={() => setStatMode(false)}
        >
          ▦
        </button>
        <span className="qzk-tool-sep" />
        <SegmentedControl options={MODE_OPTIONS} value={st.mode} onChange={st.setMode} />
        <span className="qzk-tool-sep" />

        {(st.mode === "box" || st.mode === "violin") && (
          <>
            <Picker label="group by">
              <Select
                options={groupByOptions}
                value={st.groupCol == null ? "channel" : String(st.groupCol)}
                onChange={(e) =>
                  st.setGroupCol(e.target.value === "channel" ? null : Number(e.target.value))
                }
              />
            </Picker>
            {st.groupCol != null && (
              <Picker label="value">
                <Select
                  options={columnOptions}
                  value={String(st.valueCol)}
                  onChange={(e) => st.setValueCol(Number(e.target.value))}
                />
              </Picker>
            )}
          </>
        )}

        {(st.mode === "qq" || st.mode === "histogram") && (
          <Picker label="column">
            <Select
              options={columnOptions}
              value={String(st.valueCol)}
              onChange={(e) => st.setValueCol(Number(e.target.value))}
            />
          </Picker>
        )}

        {st.mode === "qq" && (
          <Picker label="dist">
            <Select
              options={DISTRIBUTIONS.map((d) => ({ value: d, label: d }))}
              value={st.dist}
              onChange={(e) => st.setDist(e.target.value)}
            />
          </Picker>
        )}

        {st.mode === "histogram" && (
          <>
            <Picker label="bins">
              <Select
                options={BIN_RULES.map((b) => ({ value: b, label: b }))}
                value={st.bins}
                onChange={(e) => st.setBins(e.target.value)}
              />
            </Picker>
            <Picker label="fit">
              <Select
                options={[{ value: "none", label: "none" }, ...DISTRIBUTIONS.map((d) => ({ value: d, label: d }))]}
                value={st.fit ?? "none"}
                onChange={(e) => st.setFit(e.target.value === "none" ? null : e.target.value)}
              />
            </Picker>
          </>
        )}

        <span className="qzk-tool-sep" />
        <Button
          size="sm"
          disabled={!st.draw || exporting}
          onClick={() => void onExport()}
          title="Render this plot server-side and download it (PDF)"
        >
          ⤓ Export
        </Button>
      </div>

      {!st.hasData && (
        <div
          className="qzk-ds-meta"
          style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}
        >
          Select a dataset to plot
        </div>
      )}
      {st.hasData && st.error && (
        <div
          className="qzk-ds-meta"
          style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center", padding: 24 }}
        >
          {st.error}
        </div>
      )}
      {st.note && <div className="qzk-glass qzk-readout">{st.note}</div>}
    </div>
  );
}

// A compact labeled control for the float toolbar (mirrors MapStage's Picker).
function Picker({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
      {label}
      {children}
    </label>
  );
}
