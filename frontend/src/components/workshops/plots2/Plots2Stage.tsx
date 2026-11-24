// Stage for the G15 plots (GAP_AUDIT_9): parallel coordinates, hexbin, 2-D
// KDE, Pareto and Bland-Altman. Shown by PlotStage while a plots2 kind is
// active (lib/plots2Mode.ts). The picture is the server's own render of the
// exact request Export sends (calc/figure_*.py), so screen == export, the
// polar map's contract. Lives in workshops/plots2/ and reaches the shared
// aux-figure frame the way polarmap/ does.

import AuxFigureFrame from "../ternary/AuxFigureFrame";
import { setPlots2Mode, type Plots2Kind } from "../../../lib/plots2Mode";
import Plots2Controls from "./Plots2Controls";
import { usePlots2 } from "./usePlots2";

const TITLES: Record<Plots2Kind, string> = {
  parallel: "Parallel coordinates",
  hexbin: "Hexbin density",
  kde2d: "2-D kernel density",
  pareto: "Pareto chart",
  blandAltman: "Bland-Altman",
};

export default function Plots2Stage({ kind }: { kind: Plots2Kind }) {
  const m = usePlots2(kind);
  const { picks } = m;
  const back = (
    <div className="qzk-glass qzk-float-tools">
      <button aria-label="Cartesian plot" className="qzk-tool-btn active" title="Back to a cartesian plot" onClick={() => setPlots2Mode(null)}>
        ✺
      </button>
    </div>
  );
  if (!m.hasData || !picks) {
    return (
      <div className="qzk-stage">
        <div className="qzk-helptext" style={{ padding: 16, color: "var(--text-faint)" }}>
          Select a dataset to draw a {TITLES[kind].toLowerCase()}.
        </div>
        {back}
      </div>
    );
  }
  return (
    <div className="qzk-stage">
      <div style={{ position: "absolute", inset: 0, overflow: "auto", padding: "52px 12px 12px" }} aria-label={TITLES[kind]}>
        <Plots2Controls kind={kind} columns={m.columns} picks={picks} setPick={m.setPick} />
        <AuxFigureFrame
          title={m.title}
          setTitle={m.setTitle}
          fmt={m.fmt}
          setFmt={m.setFmt}
          onExport={() => void m.exportNow()}
          notice={m.notice}
          problem={m.problem}
          preview={m.preview}
          alt={`${TITLES[kind]} preview`}
        />
      </div>
      {back}
    </div>
  );
}
