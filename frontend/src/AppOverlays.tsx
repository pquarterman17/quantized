// The platform overlay + workshop mount block, extracted verbatim from
// App.tsx (MAIN_PLAN #1, component-ceiling ratchet). Owns the open/closed
// flag selectors so App stays a thin composition root; DOM order here is the
// stacking order the monolithic App used (always-mounted dialogs first, then
// the flag-gated workshop panels, then the sheets + toaster). CommandPalette
// stays in App — it needs the curated actions list.

import AnnotationTextDialog from "./components/overlays/AnnotationTextDialog";
import ConfirmDialog from "./components/overlays/ConfirmDialog";
import ParamDialog from "./components/overlays/ParamDialog";
import PreferencesDialog from "./components/overlays/PreferencesDialog";
import ShortcutsDialog from "./components/overlays/ShortcutsDialog";
import TextFormatHelp from "./components/overlays/TextFormatHelp";
import Toaster from "./components/overlays/Toaster";
import TooltipLayer from "./components/overlays/TooltipLayer";
import BaselinePanel from "./components/workshops/baseline/BaselinePanel";
import CalculatorsPanel from "./components/workshops/calculators/CalculatorsPanel";
import DatasetMathPanel from "./components/workshops/datasetmath/DatasetMathPanel";
import TabulatePanel from "./components/workshops/tabulate/TabulatePanel";
import DistributionPanel from "./components/workshops/distribution/DistributionPanel";
import ReportPanel from "./components/workshops/report/ReportPanel";
import StatsChooserPanel from "./components/workshops/statschooser/StatsChooserPanel";
import PeakWizardPanel from "./components/workshops/peakwizard/PeakWizardPanel";
import ImportWizardPanel from "./components/workshops/importwizard/ImportWizardPanel";
import PipelinePanel from "./components/workshops/pipeline/PipelinePanel";
import DataFilterPanel from "./components/workshops/datafilter/DataFilterPanel";
import ColumnSwitcher from "./components/workshops/switcher/ColumnSwitcher";
import FigureBuilderView from "./components/workshops/figurebuilder/FigureBuilderView";
import FigurePageView from "./components/workshops/figurepage/FigurePageView";
import GraphBuilderPanel from "./components/workshops/graphbuilder/GraphBuilderPanel";
import CurveFitPanel from "./components/workshops/curvefit/CurveFitPanel";
import HysteresisPanel from "./components/workshops/hysteresis/HysteresisPanel";
import MagToolsPanel from "./components/workshops/magtools/MagToolsPanel";
import PeaksPanel from "./components/workshops/peaks/PeaksPanel";
import ReflectivityPanel from "./components/workshops/reflectivity/ReflectivityPanel";
import ReductionsPanel from "./components/workshops/reductions/ReductionsPanel";
import RsmPanel from "./components/workshops/rsm/RsmPanel";
import DigitizerView from "./components/workshops/digitizer/DigitizerView";
import WaterfallView from "./components/workshops/waterfall/WaterfallView";
import ReflView from "./components/workshops/reflview/ReflView";
import { useApp } from "./store/useApp";

export default function AppOverlays() {
  const curveFitOpen = useApp((s) => s.curveFitOpen);
  const hysteresisOpen = useApp((s) => s.hysteresisOpen);
  const peaksOpen = useApp((s) => s.peaksOpen);
  const reflectivityOpen = useApp((s) => s.reflectivityOpen);
  const baselineOpen = useApp((s) => s.baselineOpen);
  const calculatorsOpen = useApp((s) => s.calculatorsOpen);
  const rsmOpen = useApp((s) => s.rsmOpen);
  const reductionsOpen = useApp((s) => s.reductionsOpen);
  const digitizerOpen = useApp((s) => s.digitizerOpen);
  const magToolsOpen = useApp((s) => s.magToolsOpen);
  const datasetMathOpen = useApp((s) => s.datasetMathOpen);
  const tabulateOpen = useApp((s) => s.tabulateOpen);
  const distributionOpen = useApp((s) => s.distributionOpen);
  const dataFilterOpen = useApp((s) => s.dataFilterOpen);
  const columnSwitcherOpen = useApp((s) => s.columnSwitcherOpen);
  const figureBuilderOpen = useApp((s) => s.figureBuilderOpen);
  const figurePageOpen = useApp((s) => s.figurePageOpen);
  const graphBuilderOpen = useApp((s) => s.graphBuilderOpen);
  const waterfallOpen = useApp((s) => s.waterfallOpen);
  const reflViewOpen = useApp((s) => s.reflViewOpen);
  const openReportId = useApp((s) => s.openReportId);
  const statsChooserOpen = useApp((s) => s.statsChooserOpen);
  const peakWizardOpen = useApp((s) => s.peakWizardOpen);
  const importWizardOpen = useApp((s) => s.importWizardOpen);
  const pipelineOpen = useApp((s) => s.pipelineOpen);

  return (
    <>
      <ParamDialog />
      <ConfirmDialog />
      <AnnotationTextDialog />
      <TooltipLayer />
      {curveFitOpen && <CurveFitPanel />}
      {hysteresisOpen && <HysteresisPanel />}
      {peaksOpen && <PeaksPanel />}
      {reflectivityOpen && <ReflectivityPanel />}
      {baselineOpen && <BaselinePanel />}
      {calculatorsOpen && <CalculatorsPanel />}
      {magToolsOpen && <MagToolsPanel />}
      {rsmOpen && <RsmPanel />}
      {reductionsOpen && <ReductionsPanel />}
      {digitizerOpen && <DigitizerView />}
      {datasetMathOpen && <DatasetMathPanel />}
      {tabulateOpen && <TabulatePanel />}
      {distributionOpen && <DistributionPanel />}
      {dataFilterOpen && <DataFilterPanel />}
      {statsChooserOpen && <StatsChooserPanel />}
      {peakWizardOpen && <PeakWizardPanel />}
      {importWizardOpen && <ImportWizardPanel />}
      {pipelineOpen && <PipelinePanel />}
      {openReportId && <ReportPanel />}
      {columnSwitcherOpen && <ColumnSwitcher />}
      {figureBuilderOpen && <FigureBuilderView />}
      {figurePageOpen && <FigurePageView />}
      {graphBuilderOpen && <GraphBuilderPanel />}
      {waterfallOpen && <WaterfallView />}
      {reflViewOpen && <ReflView />}
      <ShortcutsDialog />
      <TextFormatHelp />
      <PreferencesDialog />
      <Toaster />
    </>
  );
}
