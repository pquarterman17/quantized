// One lazy host for the analysis-extras tool windows (surface fit, optical gap,
// ellipse fit): AppOverlays mounts only this when any is open, and each panel
// is its own chunk behind it, fetched the first time its command runs.

import { lazyRegion } from "../../../lib/lazyRegion";
import { useAnalysisExtras } from "../../../store/analysisExtras";

const SurfaceFitPanel = lazyRegion(() => import("../surfacefit/SurfaceFitPanel"), "Surface fit");
const OpticalGapPanel = lazyRegion(() => import("../opticalgap/OpticalGapPanel"), "Optical gap");
const EllipseFitPanel = lazyRegion(() => import("../implicitfit/EllipseFitPanel"), "Ellipse fit");
const MapOpsPanel = lazyRegion(() => import("../mapops/MapOpsPanel"), "Map operations");
const MapGridPanel = lazyRegion(() => import("../mapgrid/MapGridPanel"), "Map gridding");
const MapAnalysisPanel = lazyRegion(() => import("../mapanalysis/MapAnalysisPanel"), "Map analysis");
const TimeSeriesPanel = lazyRegion(() => import("../timeseries/TimeSeriesPanel"), "Time series");
const SpectroExtrasPanel = lazyRegion(() => import("../spectroextras/SpectroExtrasPanel"), "Spectroscopy extras");
const CurveMeasurePanel = lazyRegion(() => import("../curvemeasure/CurveMeasurePanel"), "Curve measurements");
const MathExtrasPanel = lazyRegion(() => import("../mathextras/MathExtrasPanel"), "Math extras");

export default function AnalysisExtrasHost() {
  const open = useAnalysisExtras((s) => s.open);
  return (
    <>
      {open.includes("surface-fit") && <SurfaceFitPanel />}
      {open.includes("optical-gap") && <OpticalGapPanel />}
      {open.includes("ellipse-fit") && <EllipseFitPanel />}
      {open.includes("map-ops") && <MapOpsPanel />}
      {open.includes("map-grid") && <MapGridPanel />}
      {open.includes("map-analysis") && <MapAnalysisPanel />}
      {open.includes("time-series") && <TimeSeriesPanel />}
      {open.includes("spectro-extras") && <SpectroExtrasPanel />}
      {open.includes("curve-measure") && <CurveMeasurePanel />}
      {open.includes("math-extras") && <MathExtrasPanel />}
    </>
  );
}
