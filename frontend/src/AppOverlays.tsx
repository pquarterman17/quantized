// The platform overlay + workshop mount block, extracted verbatim from
// App.tsx (MAIN_PLAN #1, component-ceiling ratchet). Owns the open/closed
// flag selectors so App stays a thin composition root; DOM order here is the
// stacking order the monolithic App used (always-mounted infrastructure first,
// then the flag-gated workshop panels and ordinary dialogs, then the sheets +
// toaster). CommandPalette
// stays in App — it needs the curated actions list.
//
// CODE SPLITTING (MAIN_PLAN #29). The flag-gated workshop panels below are
// `lazyPanel(...)`, not static imports: each renders only when its `open` flag
// is true, so a static import made a user who opens ONE panel download all 25.
// Most infrastructure dialogs stay eager because they expose promise/event
// interfaces that must be ready before a component has rendered. Help and the
// ordinary store-flag dialogs are exceptions: their open flags live here, so
// their growing content can be omitted from startup without losing an event
// listener. `SqliteQueryDialog`
// is eager because it self-gates on a `SHOW_SQLITE_QUERY` window event
// registered in a `useEffect`, so it must stay mounted to hear it at all.
//
// Three more overlays were evaluated for the same treatment and two stay put:
// `AnnotationTextDialog` exposes a promise-based `askAnnotationText()` API
// like ParamDialog/ConfirmDialog, AND `components/Stage/useShapeDraw.ts` (part
// of the always-eager Stage tree) imports it statically, so the module is
// already in the eager graph regardless of what this file does — lazy-loading
// only the mount here would save nothing. `InteractionHints` registers its
// `SHOW_INTERACTION_HINTS` window listener unconditionally on mount (so
// Help's "Show interaction hints" can reopen it after the first-run card is
// dismissed) — gating the mount would drop that listener while dismissed and
// break reopening, so it stays eager. `WhatIsThis` has neither: its own
// Escape listener is already gated on the `on` flag internally, so wrapping
// its mount in the same flag below is a no-op change in behavior.
//
// For panels already flag-gated in JSX, the mount line is deliberately
// unchanged — wrapping at the IMPORT site keeps it byte-identical for the
// raw-source assertions in SplitDatasetDialog / TextFormatHelp /
// ReductionsPanel tests (the App tree is too heavy to render in jsdom, so
// those tests scan this file's text). `WhatIsThis` did NOT have a JSX flag
// before (it was always mounted, self-hiding via its own `if (!on) return
// null`), so its conversion adds one — a behavior-preserving change, not a
// violation of that byte-identical rule.

import { lazy, Suspense, useEffect, useState, type ComponentType } from "react";
import AnnotationTextDialog from "./components/overlays/AnnotationTextDialog";
import ConfirmDialog from "./components/overlays/ConfirmDialog";
import ParamDialog from "./components/overlays/ParamDialog";
import Toaster from "./components/overlays/Toaster";
import TooltipLayer from "./components/overlays/TooltipLayer";
import InteractionHints from "./components/overlays/InteractionHints";
import SqliteQueryDialog from "./components/workshops/database/SqliteQueryDialog";
import { useApp } from "./store/useApp";
import { useHelp } from "./store/help";
import { useFitYByXStore } from "./store/fitYByX";
import { useOutlierScreeningStore } from "./store/outlierScreening";
import { useMultivarStore } from "./store/multivar";
import { useVariabilityStore } from "./store/variability";

/** Dynamically import a flag-gated workshop panel, wrapping it in its OWN
 *  Suspense boundary. The per-panel boundary is the point: with one shared
 *  boundary, opening a second panel would suspend the whole subtree and blank
 *  an already-open panel while the new chunk loaded. `fallback={null}` because
 *  these are overlays served from localhost — the chunk arrives in a frame or
 *  two, and a spinner would flash more than it informs. */
function lazyPanel(load: () => Promise<{ default: ComponentType }>): ComponentType {
  const Panel = lazy(load);
  return function LazyPanel() {
    return (
      <Suspense fallback={null}>
        <Panel />
      </Suspense>
    );
  };
}

/** Load an on-demand dialog only after its first opening, then leave it mounted
 * while closed. That preserves local dialog state (for example Preferences'
 * active tab) exactly as the former eager mount did. */
function useKeepMountedAfterOpen(open: boolean): boolean {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  return mounted;
}

const BaselinePanel = lazyPanel(() => import("./components/workshops/baseline/BaselinePanel"));
const CalculatorsPanel = lazyPanel(() => import("./components/workshops/calculators/CalculatorsPanel"));
const DatasetMathPanel = lazyPanel(() => import("./components/workshops/datasetmath/DatasetMathPanel"));
const TabulatePanel = lazyPanel(() => import("./components/workshops/tabulate/TabulatePanel"));
const DistributionPanel = lazyPanel(() => import("./components/workshops/distribution/DistributionPanel"));
const FitYByXPanel = lazyPanel(() => import("./components/workshops/fityx/FitYByXPanel"));
const OutlierScreeningPanel = lazyPanel(() => import("./components/workshops/outliers/OutlierScreeningPanel"));
const MultivarPanel = lazyPanel(() => import("./components/workshops/multivar/MultivarPanel"));
const VariabilityChartPanel = lazyPanel(() => import("./components/workshops/variability/VariabilityChartPanel"));
const ReportPanel = lazyPanel(() => import("./components/workshops/report/ReportPanel"));
const StatsChooserPanel = lazyPanel(() => import("./components/workshops/statschooser/StatsChooserPanel"));
const PeakWizardPanel = lazyPanel(() => import("./components/workshops/peakwizard/PeakWizardPanel"));
const ImportWizardPanel = lazyPanel(() => import("./components/workshops/importwizard/ImportWizardPanel"));
const PipelinePanel = lazyPanel(() => import("./components/workshops/pipeline/PipelinePanel"));
const DataFilterPanel = lazyPanel(() => import("./components/workshops/datafilter/DataFilterPanel"));
const ColumnSwitcher = lazyPanel(() => import("./components/workshops/switcher/ColumnSwitcher"));
const FigureBuilderView = lazyPanel(() => import("./components/workshops/figurebuilder/FigureBuilderView"));
const FigurePageView = lazyPanel(() => import("./components/workshops/figurepage/FigurePageView"));
const GraphBuilderPanel = lazyPanel(() => import("./components/workshops/graphbuilder/GraphBuilderPanel"));
const CurveFitPanel = lazyPanel(() => import("./components/workshops/curvefit/CurveFitPanel"));
const HysteresisPanel = lazyPanel(() => import("./components/workshops/hysteresis/HysteresisPanel"));
const MagToolsPanel = lazyPanel(() => import("./components/workshops/magtools/MagToolsPanel"));
const PeaksPanel = lazyPanel(() => import("./components/workshops/peaks/PeaksPanel"));
const ReflectivityPanel = lazyPanel(() => import("./components/workshops/reflectivity/ReflectivityPanel"));
const ReductionsPanel = lazyPanel(() => import("./components/workshops/reductions/ReductionsPanel"));
const RsmPanel = lazyPanel(() => import("./components/workshops/rsm/RsmPanel"));
const DigitizerView = lazyPanel(() => import("./components/workshops/digitizer/DigitizerView"));
const WaterfallView = lazyPanel(() => import("./components/workshops/waterfall/WaterfallView"));
const ReflView = lazyPanel(() => import("./components/workshops/reflview/ReflView"));
const TrashPanel = lazyPanel(() => import("./components/workshops/trash/TrashPanel"));
const SearchPanel = lazyPanel(() => import("./components/workshops/search/SearchPanel"));
const HelpDialog = lazyPanel(() => import("./components/overlays/HelpDialog"));
// These ordinary dialogs have no startup responsibility: their store flags are
// already in this composition root, so loading them only when opened removes
// their implementation (and dialog-only helpers) from first-paint JS.
const SplitDatasetDialog = lazyPanel(() => import("./components/overlays/SplitDatasetDialog"));
const ShortcutsDialog = lazyPanel(() => import("./components/overlays/ShortcutsDialog"));
const TextFormatHelp = lazyPanel(() => import("./components/overlays/TextFormatHelp"));
const PreferencesDialog = lazyPanel(() => import("./components/overlays/PreferencesDialog"));
// No local state to preserve across toggles (purely `useHelp`-flag-driven),
// so a plain lazyPanel — not useKeepMountedAfterOpen — matches its former
// always-mounted-but-self-hiding behavior exactly.
const WhatIsThis = lazyPanel(() => import("./components/overlays/WhatIsThis"));

export default function AppOverlays() {
  const helpOpen = useHelp((s) => s.open);
  const whatIsThisOn = useHelp((s) => s.whatIsThis);
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
  const fitYByXOpen = useFitYByXStore((s) => s.open);
  const outlierScreeningOpen = useOutlierScreeningStore((s) => s.open);
  const multivarOpen = useMultivarStore((s) => s.open);
  const variabilityOpen = useVariabilityStore((s) => s.open);
  const dataFilterOpen = useApp((s) => s.dataFilterOpen);
  const columnSwitcherOpen = useApp((s) => s.columnSwitcherOpen);
  const figureBuilderOpen = useApp((s) => s.figureBuilderOpen);
  const figurePageOpen = useApp((s) => s.figurePageOpen);
  const graphBuilderOpen = useApp((s) => s.graphBuilderOpen);
  const waterfallOpen = useApp((s) => s.waterfallOpen);
  const reflViewOpen = useApp((s) => s.reflViewOpen);
  const trashOpen = useApp((s) => s.trashOpen);
  const searchOpen = useApp((s) => s.searchOpen);
  const openReportId = useApp((s) => s.openReportId);
  const statsChooserOpen = useApp((s) => s.statsChooserOpen);
  const peakWizardOpen = useApp((s) => s.peakWizardOpen);
  const importWizardOpen = useApp((s) => s.importWizardOpen);
  const pipelineOpen = useApp((s) => s.pipelineOpen);
  const splitDialogOpen = useApp((s) => s.splitDialogTargetId !== null);
  const shortcutsOpen = useApp((s) => s.shortcutsOpen);
  const textFormatHelpOpen = useApp((s) => s.textFormatHelpOpen);
  const prefsOpen = useApp((s) => s.prefsOpen);
  const splitDialogMounted = useKeepMountedAfterOpen(splitDialogOpen);
  const shortcutsMounted = useKeepMountedAfterOpen(shortcutsOpen);
  const textFormatHelpMounted = useKeepMountedAfterOpen(textFormatHelpOpen);
  const prefsMounted = useKeepMountedAfterOpen(prefsOpen);

  return (
    <>
      <ParamDialog />
      <ConfirmDialog />
      <AnnotationTextDialog />
      {splitDialogMounted && <SplitDatasetDialog />}
      <TooltipLayer />
      {whatIsThisOn && <WhatIsThis />}
      <InteractionHints />
      <SqliteQueryDialog />
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
      {fitYByXOpen && <FitYByXPanel />}
      {outlierScreeningOpen && <OutlierScreeningPanel />}
      {multivarOpen && <MultivarPanel />}
      {variabilityOpen && <VariabilityChartPanel />}
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
      {trashOpen && <TrashPanel />}
      {searchOpen && <SearchPanel />}
      {shortcutsMounted && <ShortcutsDialog />}
      {helpOpen && <HelpDialog />}
      {textFormatHelpMounted && <TextFormatHelp />}
      {prefsMounted && <PreferencesDialog />}
      <Toaster />
    </>
  );
}
