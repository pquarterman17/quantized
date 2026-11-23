// Right panel: stacked collapsible Cards. Corrections posts to
// /api/corrections/apply via the store. Appearance lives in the title-bar menu.
//
// UX-A: the Inspector follows the context and the selection, like Figma's
// properties panel or Prism's Format Graph sheet —
// - an empty project shows a short hint, not a wall of cards that need data;
// - the Worksheet (and Workflow / Analysis) tabs show only the data cards;
// - on the Plot tab a Selection section comes first, and the card for the
//   selected curve / axis / annotation / shape is hoisted under it, opened
//   and scrolled into view;
// - which cards the user opened is remembered per context (CardStateContext +
//   store/inspectorCards), across reloads.

import { Fragment, useEffect, useRef, type ReactNode } from "react";

import AnnotationsCard from "./AnnotationsCard";
import AxesCard from "./AxesCard";
import ChannelsCard from "./ChannelsCard";
import ErrorRolesCard from "./ErrorRolesCard";
import CorrectionsCard from "./CorrectionsCard";
import InspectorResizer from "./InspectorResizer";
import InspectorSelection from "./InspectorSelection";
import MacroCard from "./MacroCard";
import MapCard from "./MapCard";
import MetadataCard from "./MetadataCard";
import NotesCard from "./NotesCard";
import OriginProvenanceCard from "./OriginProvenanceCard";
import PlotObjectsCard from "./PlotObjectsCard";
import RefLinesCard from "./RefLinesCard";
import FitOverlaysCard from "./FitOverlaysCard";
import PointLabelsCard from "./PointLabelsCard";
import RegionShadesCard from "./RegionShadesCard";
import SeriesStyleCard from "./SeriesStyleCard";
import ShapesCard from "./ShapesCard";
import StatsCard from "./StatsCard";
import TitlesCard from "./TitlesCard";
import { useInspectorCardState } from "./useInspectorCardState";
import { lazyRegion } from "../../lib/lazyRegion";
import { folderPathLabel } from "../../lib/foldertree";
import { CardStateContext } from "../primitives/cardState";
import { selectionKey, useExclusiveSelection, usePlotSelection, useSelectionGuards } from "../../store/plotSelection";
import { useActiveDataset, useApp } from "../../store/useApp";

const MapStyleCard = lazyRegion(() => import("../workshops/windowlayout/MapStyleCard"), "2-D map");

/** Cards that edit the plot, not the data: hidden off the Plot / Map tabs. */
const PLOT_CARDS = new Set(["Plot objects", "Axes", "Titles & labels", "Reference lines", "Region shades", "Annotations", "Shapes", "Series style", "Fit overlays"]);
/** The Plot tab's own order: the plot's series list and the plot cards first;
 *  every other card follows under a "Data" heading. */
const PLOT_TAB_ORDER = ["Channels", "Plot objects", "Axes", "Titles & labels", "Series style", "Fit overlays", "Reference lines", "Region shades", "Annotations", "Shapes"];
/** Rank of a card after every PLOT_TAB_ORDER entry: the data cards. */
const DATA_RANK = 99;

export default function Inspector() {
  return (
    <>
      <InspectorBody />
      <InspectorResizer />
    </>
  );
}

function InspectorBody() {
  const active = useActiveDataset();
  // "Folder › Subfolder" breadcrumb for the active dataset (GUI_INTERACTION
  // #13 sub-item 2) — the Inspector is the Library's existing selection-
  // details surface, so the caption lives here rather than a new panel.
  const folders = useApp((s) => s.folders);
  const breadcrumb = active ? folderPathLabel(folders, active.folderId) : undefined;
  const stageTab = useApp((s) => s.stageTab);
  // Windows mode has no Map tab (WORKSPACE_LAYOUT_PLAN P5): its 2-D map card is the lazy MapStyleCard,
  // bound to the map window in use. Classic never reads this (it shows the card on the Map tab).
  const windowsMode = useApp((s) => s.layoutMode === "windows");
  const hasData = useApp((s) => s.datasets.length > 0);
  const ctx = hasData ? stageTab : "empty";
  const plotTab = ctx === "plot";

  useExclusiveSelection();
  useSelectionGuards();
  const sel = usePlotSelection((s) => s.sel);
  const annotationId = useApp((s) => s.selectedAnnotationId);
  const shapeId = useApp((s) => s.selectedShapeId);
  // The card the selection points at (Plot tab only): it is hoisted, opened
  // and scrolled into view. A legend's controls sit in the Selection section.
  const focus = !plotTab
    ? null
    : annotationId
      ? "Annotations"
      : shapeId
        ? "Shapes"
        : sel?.kind === "series"
          ? "Series style"
          : sel?.kind === "axis"
            ? "Axes"
            : null;
  const focusKey = plotTab ? (annotationId ? `a:${annotationId}` : shapeId ? `s:${shapeId}` : selectionKey(sel)) : "";
  const cardState = useInspectorCardState(ctx, focus, focusKey);
  // A new selection: bring a selected curve's style row into view — "nearest",
  // so the panel moves only when the row is out of view (the hoisted card's
  // own reveal does the same for its header). Runs after the cards' effects.
  const asideRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focusKey) asideRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [focusKey]);

  if (!hasData) {
    return (
      <aside className="qzk-inspector" aria-label="Inspector">
        <section className="qzk-inspector-empty" aria-label="Nothing to inspect">
          <strong>Nothing to inspect yet</strong>
          <p className="qzk-helptext">
            Import data or drop files into the Library. Then click a curve, axis or legend on the plot and its
            properties appear here.
          </p>
        </section>
      </aside>
    );
  }

  const seriesChannel = sel?.kind === "series" ? sel.channel : undefined;
  // The pre-UX-A order (kept off the Plot tab); `shown` drops what this
  // context doesn't use.
  const cards: [string, ReactNode][] = [
    ["Notes", <NotesCard active={active} />],
    ["Channels", <ChannelsCard active={active} />],
    ["Error columns", <ErrorRolesCard active={active} />],
    ["Plot objects", <PlotObjectsCard />],
    // SILENT_STATE_CORRUPTION_PLAN #10: a derived worksheet's corrections
    // are its pipeline recipe, re-run from its source by
    // `recomputeDerivedSheet`. Correcting one from this card rebuilt it from
    // the sheet's cached copy of the source instead of the source's current
    // data. store/corrections.ts refuses it outright (the class fix, covering
    // the bulk/pipeline/baseline callers too); hiding the card here is the
    // instance fix, so the affordance isn't offered at all rather than
    // offered and refused.
    ["Corrections", !active?.derivedFrom && <CorrectionsCard key={active?.id ?? "none"} active={active} />],
    ["Channel statistics", <StatsCard active={active} />],
    ["Metadata", <MetadataCard active={active} />],
    ["Origin provenance", <OriginProvenanceCard active={active} />],
    ["Axes", <AxesCard />],
    ["Titles & labels", <TitlesCard />],
    ["Reference lines", <RefLinesCard />],
    ["Region shades", <RegionShadesCard />],
    ["Fit overlays", stageTab !== "map" && <FitOverlaysCard />],
    ["Point labels", stageTab !== "map" && <PointLabelsCard />],
    ["Annotations", <AnnotationsCard />],
    ["Shapes", <ShapesCard />],
    // Line/Scatter/marker controls style XY curves; a map draws none (figures audit #18).
    ["Series style", stageTab !== "map" && <SeriesStyleCard active={active} selectedChannel={seriesChannel} />],
    ["Macro recorder", <MacroCard />],
  ];
  const plotLike = plotTab || ctx === "map";
  const shown = cards.filter(([id]) => plotLike || !PLOT_CARDS.has(id));
  // The selection's card first, right under the Selection section; on the
  // Plot tab the plot cards next, then the data cards after a "Data" heading.
  const rank = (id: string) => (id === focus ? -1 : plotTab ? PLOT_TAB_ORDER.indexOf(id) + 1 || DATA_RANK : 0);
  shown.sort(([a], [b]) => rank(a) - rank(b));
  const dataStart = plotTab ? shown.findIndex(([id]) => rank(id) === DATA_RANK) : -1;

  return (
    <aside ref={asideRef} className="qzk-inspector" aria-label="Inspector" data-context={ctx}>
      <CardStateContext.Provider value={cardState}>
        {breadcrumb && (
          <div className="qzk-ds-breadcrumb" title={breadcrumb}>
            {breadcrumb}
          </div>
        )}

        {stageTab === "map" && <MapCard />}
        {windowsMode && <MapStyleCard />}

        {plotTab && active && <InspectorSelection active={active} />}

        {shown.map(([id, node], i) => (
          <Fragment key={id}>
            {i === dataStart && <h3 className="qzk-inspector-group">Data</h3>}
            {node}
          </Fragment>
        ))}
      </CardStateContext.Provider>
    </aside>
  );
}
