// Reflectivity fit — the linked data/model/residual/SLD view (P2.2). Three
// small uPlots from reflFitResiduals.ts' payloads: data + model on a log-R
// axis, the residuals under it on the SAME Q column (zero line drawn; a Q zoom
// in either panel zooms both, and the cursor is shared), and the SLD depth
// profile beside them on its own z axis. Shown for the live fit and for a
// saved fit, which stores its residuals with its curves.

import { useId, useMemo } from "react";
import type uPlot from "uplot";

import type { RefLine } from "../../../lib/types";
import FitPlot from "../SmallUPlot";
import type { CurvesLike } from "./reflFitCurves";
import type { Weighting } from "./reflFitData";
import { fitPlotPanels, linkX, RESIDUAL_MEANING } from "./reflFitResiduals";

const ZERO: RefLine[] = [{ id: "zero", axis: "y", value: 0 }];
const NOTE = { color: "var(--text-faint)" } as const;

export default function ReflFitPlots({ curves, weighting }: { curves: CurvesLike; weighting: Weighting }) {
  const panels = useMemo(() => fitPlotPanels(curves, weighting), [curves, weighting]);
  const key = `refl-fit-${useId()}`;
  const link = useMemo(() => {
    const group = new Set<uPlot>();
    return { key, group, onScale: linkX(group) };
  }, [key]);
  if (!panels.reflectivity && !panels.sld) return null;
  return (
    <div aria-label="fit plots" style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 10 }}>
      {panels.reflectivity && <FitPlot payload={panels.reflectivity} label="data and model" height={170} yLog link={link} />}
      {panels.residual ? (
        <>
          <FitPlot payload={panels.residual} label="residuals" height={100} refLines={ZERO} link={link} />
          <div className="qzk-ds-meta" style={NOTE}>
            Residual = {RESIDUAL_MEANING[weighting]}; zooming Q in either panel zooms both.
          </div>
        </>
      ) : (
        panels.residualNote && (
          <div className="qzk-ds-meta qzk-msg" role="note" style={NOTE}>
            {panels.residualNote}
          </div>
        )
      )}
      {panels.sld && <FitPlot payload={panels.sld} label="SLD profile" height={130} />}
    </div>
  );
}
