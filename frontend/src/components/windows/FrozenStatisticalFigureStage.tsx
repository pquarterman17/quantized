import type { ReactNode } from "react";

import type { FigureDocument } from "../../lib/figureDocument";
import { useActiveDataset } from "../../store/useApp";
import type { PlotStageProps } from "../Stage/PlotStage";
import { useStatisticalFigurePlot } from "../Stage/useStatisticalFigurePlot";

/** Lazy focused-window adapter for a frozen statistical figure. The ordinary
 * PlotStage stays on the startup path; snapshot rendering and linked brushing
 * arrive only when a user opens this specialized figure. */
export default function FrozenStatisticalFigureStage({
  figureDocument,
  render,
}: {
  figureDocument: FigureDocument;
  render: (props: PlotStageProps) => ReactNode;
}) {
  const liveActive = useActiveDataset();
  const { active, displaySelection, onRowsSelected } = useStatisticalFigurePlot(
    liveActive,
    figureDocument,
  );
  return render({ activeDataset: active, rowSelection: displaySelection, onRowsSelected });
}
