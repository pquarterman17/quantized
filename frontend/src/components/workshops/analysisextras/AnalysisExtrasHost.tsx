// One lazy host for the analysis-extras tool windows (surface fit, optical gap,
// ellipse fit): AppOverlays mounts only this when any is open, and each panel
// is its own chunk behind it, fetched the first time its command runs.

import { lazyRegion } from "../../../lib/lazyRegion";
import { useAnalysisExtras } from "../../../store/analysisExtras";

const SurfaceFitPanel = lazyRegion(() => import("../surfacefit/SurfaceFitPanel"), "Surface fit");
const OpticalGapPanel = lazyRegion(() => import("../opticalgap/OpticalGapPanel"), "Optical gap");
const EllipseFitPanel = lazyRegion(() => import("../implicitfit/EllipseFitPanel"), "Ellipse fit");
const MapOpsPanel = lazyRegion(() => import("../mapops/MapOpsPanel"), "Map operations");
const TimeSeriesPanel = lazyRegion(() => import("../timeseries/TimeSeriesPanel"), "Time series");

export default function AnalysisExtrasHost() {
  const open = useAnalysisExtras((s) => s.open);
  return (
    <>
      {open.includes("surface-fit") && <SurfaceFitPanel />}
      {open.includes("optical-gap") && <OpticalGapPanel />}
      {open.includes("ellipse-fit") && <EllipseFitPanel />}
      {open.includes("map-ops") && <MapOpsPanel />}
      {open.includes("time-series") && <TimeSeriesPanel />}
    </>
  );
}
