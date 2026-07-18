// Graph Builder state hook (GUI_INTERACTION #11). PlotSpec grammar and pure
// transforms live in lib/plotspec; this hook binds them to live datasets,
// Stage/stat renderers, Figure Builder, export, and saved-spec CRUD.
//
// #11 "durable artifact": the CRUD (save/duplicate/rename/delete) lives in
// store/graphBuilder.ts; this hook only wraps it with the live builder spec +
// the divergence ("dirty") check, and owns re-binding `activePlotSpecId` to
// null whenever the live spec stops corresponding to ANY saved payload
// (Reset, the vanished-dataset wipe, a fresh worksheet seed) so the
// unsaved-changes indicator never lies. `exportPlot` reuses the ordinary
// "Export figure…" File command (lib/exportFigureCommand) for the xy family —
// see its own doc for why box/violin/bar isn't wired the same way yet.

import { useEffect, useMemo, useState } from "react";

import { runExportFigureCommand } from "../../../lib/exportFigureCommand";
import { channelModelingType, isCategorical } from "../../../lib/modeling";
import { plotSpecFigureReason, plotSpecToFigureDoc } from "../../../lib/plotSpecFigure";
import {
  assignZone,
  clearZone,
  cycleMark,
  defaultMark,
  emptySpec,
  markContext,
  markFamily,
  moveYZone,
  plotSpecsEqual,
  specDatasetId,
  specToRender,
  validMarks,
  withInferredMark,
  type ChannelRef,
  type MarkFamily,
  type PlotMark,
  type PlotSpec,
  type SavedPlotSpec,
  type SpecRender,
  type ZoneName,
} from "../../../lib/plotspec";
import { toast } from "../../../store/toasts";
import { plotIntentStageTab, useActiveDataset, useApp } from "../../../store/useApp";
import type { WellChip, WellOption } from "./ZoneWell";

export interface GraphBuilderState {
  hasData: boolean;
  datasetId: string | null;
  spec: PlotSpec;
  mark: PlotMark;
  family: MarkFamily | null;
  marks: PlotMark[]; // the valid cycle for the current zones (>1 → cycler shown)
  render: SpecRender;
  /** Well options (click-to-assign) — every channel of the active dataset. */
  options: WellOption[];
  /** Assigned chips for a zone, with labels resolved for the UI. */
  chips: (zone: ZoneName) => WellChip[];
  assign: (zone: ZoneName, channel: number) => void;
  remove: (zone: ZoneName, channel: number) => void;
  moveY: (channel: number, direction: -1 | 1) => void;
  cycle: () => void;
  /** Clears the wells AND unbinds from any saved spec — a fresh graph. */
  reset: () => void;
  canSend: boolean;
  sendToStage: () => void;
  canOpenFigureBuilder: boolean;
  figureBuilderReason: string | null;
  openInFigureBuilder: () => void;

  // ── Saved PlotSpecs (#11) ──────────────────────────────────────────────
  /** Every saved graph, most-recently-modified first. */
  savedSpecs: SavedPlotSpec[];
  /** The saved spec this session is bound to, or null (unsaved/new). */
  activeSpec: SavedPlotSpec | null;
  /** True when the live builder spec structurally diverges from
   *  `activeSpec.spec` — always false when nothing is active (there's
   *  nothing to diverge FROM; that state reads as "unsaved", not "dirty"). */
  dirty: boolean;
  /** Update-in-place under the active spec; a no-op if nothing is active
   *  (the panel falls back to prompting a Save-As name in that case). */
  saveActive: () => void;
  /** Always creates a new saved entry from the live spec and binds to it. */
  saveAs: (name: string) => void;
  /** Load a saved entry's spec into the builder, replacing any live edits. */
  openSpec: (id: string) => void;
  /** Copy a saved entry's STORED payload under an auto-numbered name, and
   *  load the copy into the builder. */
  duplicateSpec: (id: string) => void;
  renameSpec: (id: string, name: string) => void;
  deleteSpec: (id: string) => void;
  /** Send the current spec to the Stage, then export via the SAME path the
   *  File menu's "Export figure…" command uses (xy family only — see the
   *  module doc). */
  exportPlot: () => Promise<void>;
}

export function useGraphBuilder(): GraphBuilderState {
  const active = useActiveDataset();
  const datasets = useApp((s) => s.datasets);
  const setXKey = useApp((s) => s.setXKey);
  const setYKeys = useApp((s) => s.setYKeys);
  const setStatMode = useApp((s) => s.setStatMode);
  const seedStatStage = useApp((s) => s.seedStatStage);
  const facetByColumn = useApp((s) => s.facetByColumn);
  const setStatus = useApp((s) => s.setStatus);
  const setStageTab = useApp((s) => s.setStageTab);
  const savedSpecs = useApp((s) => s.savedPlotSpecs);
  const activeSpecId = useApp((s) => s.activePlotSpecId);

  const [spec, setSpec] = useState<PlotSpec>(emptySpec);

  // MAIN #8i: the builder's WORKING dataset. An empty spec follows the active
  // dataset (the bare command-palette open, unchanged); a spec with channel
  // refs is BOUND to their dataset — which lets the worksheet handoff seed a
  // non-active dataset's columns without `setActive`'s plot-intent side
  // effects (window rebind, view reset, worksheet-tab flip) firing at
  // overlay-OPEN time. The plot intent lands in sendToStage instead, where
  // the user actually commits to plotting.
  const boundId = specDatasetId(spec);
  const ds = useMemo(
    () => (boundId !== null ? (datasets.find((d) => d.id === boundId) ?? null) : active),
    [boundId, datasets, active],
  );

  // A channel ref into a vanished dataset would reference the wrong columns —
  // wipe the spec when its dataset no longer resolves. An active-dataset
  // change alone no longer wipes a BOUND session (#8i): the builder holds a
  // spec for ITS dataset; Send brings that dataset back active. Reads `spec`
  // from the closure (not a functional setSpec updater) so the #11
  // activePlotSpecId clear below is computed from the SAME snapshot, not a
  // React-internals-timing-dependent updater invocation.
  useEffect(() => {
    const bound = specDatasetId(spec);
    const exists = bound !== null && useApp.getState().datasets.some((d) => d.id === bound);
    if (bound !== null && !exists) {
      setSpec(emptySpec());
      // #11: a wiped spec can no longer correspond to whatever saved entry
      // this session was bound to.
      useApp.getState().setActivePlotSpecId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires only on
    // active-dataset change, by design (#8i); `spec`/`datasets` read fresh.
  }, [active?.id]);

  // One-shot seed (MAIN_PLAN #4 — the worksheet's "Open in Graph Builder"):
  // consume + clear a store-handed spec, mirroring how useStatStage consumes
  // statStageSeed. Declared AFTER the vanished-dataset wipe above so a
  // handoff that also changed the active dataset lands the seed, not the
  // wipe (both effects run in the same commit, in declaration order). The
  // seed's dataset need not be active (#8i) — wells/options read the BOUND
  // dataset — but it must exist; a stale/misrouted producer's seed is
  // dropped.
  const seed = useApp((s) => s.graphBuilderSeed);
  useEffect(() => {
    if (!seed) return;
    const sid = specDatasetId(seed);
    if (sid !== null && useApp.getState().datasets.some((d) => d.id === sid)) {
      // The seed's "scatter" is a placeholder, not a user choice — take the
      // family DEFAULT (line for a monotonic x, box for a categorical x)
      // rather than inferMark's sticky keep-if-valid rule.
      const ctx = markContext(seed, useApp.getState().datasets);
      setSpec({ ...seed, mark: defaultMark(seed, ctx) });
      // #11: a worksheet-handed seed starts as a fresh, unsaved graph — it
      // never carries a saved-spec id to bind to.
      useApp.getState().setActivePlotSpecId(null);
    }
    useApp.getState().clearGraphBuilderSeed();
  }, [seed]);

  const ctx = useMemo(() => markContext(spec, datasets), [spec, datasets]);
  const render = useMemo(() => specToRender(spec, datasets), [spec, datasets]);
  const marks = useMemo(() => validMarks(spec, ctx), [spec, ctx]);
  const family = useMemo(() => markFamily(spec, ctx), [spec, ctx]);

  const options = useMemo<WellOption[]>(
    () => (ds ? ds.data.labels.map((label, index) => ({ index, label })) : []),
    [ds],
  );

  const labelOf = (channel: number): string => ds?.data.labels[channel] ?? `col ${channel}`;

  const chips = (zone: ZoneName): WellChip[] => {
    const z = spec.zones;
    if (zone === "y") return z.y.map((r) => ({ channel: r.channel, label: labelOf(r.channel) }));
    const ref = z[zone];
    return ref ? [{ channel: ref.channel, label: labelOf(ref.channel) }] : [];
  };

  const assign = (zone: ZoneName, channel: number) => {
    if (!ds) return;
    const ref: ChannelRef = { datasetId: ds.id, channel };
    setSpec((prev) => {
      const next = assignZone(prev, zone, ref);
      return withInferredMark(next, markContext(next, datasets));
    });
  };

  const remove = (zone: ZoneName, channel: number) => {
    setSpec((prev) => {
      const ref: ChannelRef = { datasetId: prev.zones.y[0]?.datasetId ?? ds?.id ?? "", channel };
      const next = clearZone(prev, zone, zone === "y" ? ref : undefined);
      return withInferredMark(next, markContext(next, datasets));
    });
  };
  const moveY = (channel: number, direction: -1 | 1) => setSpec((prev) =>
    moveYZone(prev, { datasetId: ds?.id ?? "", channel }, direction));

  const cycle = () => setSpec((prev) => ({ ...prev, mark: cycleMark(prev, markContext(prev, datasets)) }));

  // #11: a Reset is a fresh start — it also unbinds from whatever saved spec
  // this session was editing, so the (now cleared) wells don't read as a
  // "dirty" divergence from a graph the user no longer intends to touch.
  const reset = () => {
    setSpec(emptySpec());
    useApp.getState().setActivePlotSpecId(null);
  };

  const canSend = family !== null; // there's a value to plot
  const figureBuilderReason = plotSpecFigureReason(spec);
  const canOpenFigureBuilder = ds !== null && figureBuilderReason === null;

  function sendToStage(): void {
    if (!ds) return;
    // MAIN #8i: the plot intent lands HERE — the moment the user commits to
    // plotting — not at overlay-open. A builder bound to a non-active dataset
    // (the worksheet handoff) rebinds now; every store action below then acts
    // on the freshly-active dataset. setActive is the deliberate plot-intent
    // primitive (window rebind / view reset / worksheet-override clear).
    if (useApp.getState().activeId !== ds.id) useApp.getState().setActive(ds.id);
    // Owner-routing item 1: "Send to Stage" always means look at the plot
    // (every branch below renders inside the Plot tab — scatter/line/facet
    // on the main canvas, box/violin/bar via StatStage), so surface it
    // regardless of which tab the user is currently on.
    const wantTab = plotIntentStageTab(ds);
    if (useApp.getState().stageTab !== wantTab) setStageTab(wantTab);
    if (spec.mark === "scatter" || spec.mark === "line") {
      setXKey(spec.zones.x?.channel ?? null);
      setYKeys(spec.zones.y.map((r) => r.channel));
      setStatMode(false);
      if (spec.zones.group) {
        toast("series-split by group is preview-only in v1 (lands with faceting)", "info");
      }
      // Facet zone filled (gap #21 residual): enter the main Stage's facet
      // grid instead of the flat plot. facetByColumn is called AFTER
      // setXKey/setYKeys above, so its own "carry the current x/y selection
      // when the dataset is already active" rule picks up exactly the
      // channels just assigned.
      if (spec.zones.facet) {
        facetByColumn(ds.id, spec.zones.facet.channel);
        setStatus(`sent ${spec.mark} to the plot, faceted by ${labelOf(spec.zones.facet.channel)}`);
        return;
      }
      setStatus(`sent ${spec.mark} to the plot`);
      return;
    }
    if (spec.mark === "box" || spec.mark === "violin") {
      const x = spec.zones.x;
      const groupCol = x && isCategorical(channelModelingType(ds, x.channel)) ? x.channel : null;
      const facetCol = spec.zones.facet?.channel ?? null;
      seedStatStage({ mode: spec.mark, groupCol, valueCol: spec.zones.y[0].channel, facetCol });
      setStatus(
        facetCol !== null
          ? `sent ${spec.mark} plot to the stat stage, faceted by ${labelOf(facetCol)}`
          : `sent ${spec.mark} plot to the stat stage`,
      );
      return;
    }
    // mark === "bar" (gap #20): the stat stage's bar mode reads its series
    // from the main plot's Y selection (mirrors box/violin's own fallback —
    // see useStatStage's barValueChannels), so valueCol here is really just a
    // placeholder the seed shape requires; groupCol is the real payload.
    const x = spec.zones.x;
    const groupCol = x && isCategorical(channelModelingType(ds, x.channel)) ? x.channel : null;
    if (groupCol === null) {
      toast("Bar charts need a categorical X column.", "info");
      return;
    }
    const facetCol = spec.zones.facet?.channel ?? null;
    seedStatStage({ mode: "bar", groupCol, valueCol: spec.zones.y[0]?.channel ?? 0, facetCol });
    setStatus(
      facetCol !== null
        ? `sent bar chart to the stat stage, faceted by ${labelOf(facetCol)}`
        : "sent bar chart to the stat stage",
    );
  }

  function openInFigureBuilder(): void {
    if (!ds) return;
    const doc = plotSpecToFigureDoc(
      spec,
      activeSpec?.name ?? "Graph Builder plot",
      useApp.getState().seriesStyles,
    );
    if (!doc) {
      toast(plotSpecFigureReason(spec) ?? "This graph cannot open in Figure Builder.", "info");
      return;
    }
    useApp.getState().openFigureDraft(doc);
    setStatus("opened XY plot in Figure Builder");
  }

  // ── Saved PlotSpecs (#11) ─────────────────────────────────────────────────
  const activeSpec = useMemo(
    () => savedSpecs.find((p) => p.id === activeSpecId) ?? null,
    [savedSpecs, activeSpecId],
  );
  const dirty = activeSpec !== null && !plotSpecsEqual(spec, activeSpec.spec);

  const saveActive = (): void => {
    const id = useApp.getState().savePlotSpec(spec);
    if (!id) return; // nothing active — the panel falls back to saveAs
    const nm = useApp.getState().savedPlotSpecs.find((p) => p.id === id)?.name ?? "";
    setStatus(`saved "${nm}"`);
  };

  const saveAs = (name: string): void => {
    const id = useApp.getState().saveAsPlotSpec(name, spec);
    const nm = useApp.getState().savedPlotSpecs.find((p) => p.id === id)?.name ?? name;
    setStatus(`saved "${nm}"`);
  };

  // Loads a saved entry's spec verbatim into the builder (item 3: "reopening
  // a saved spec restores the builder state exactly") — re-inferring the mark
  // guards against a dataset whose column types changed since the save.
  const openSpec = (id: string): void => {
    const saved = useApp.getState().savedPlotSpecs.find((p) => p.id === id);
    if (!saved) return;
    setSpec(withInferredMark(saved.spec, markContext(saved.spec, useApp.getState().datasets)));
    useApp.getState().setActivePlotSpecId(id);
    setStatus(`opened "${saved.name}"`);
  };

  const duplicateSpec = (id: string): void => {
    const newId = useApp.getState().duplicatePlotSpec(id);
    if (!newId) return;
    const saved = useApp.getState().savedPlotSpecs.find((p) => p.id === newId);
    if (!saved) return;
    setSpec(withInferredMark(saved.spec, markContext(saved.spec, useApp.getState().datasets)));
    setStatus(`duplicated as "${saved.name}"`);
  };

  const renameSpec = (id: string, name: string): void => useApp.getState().renamePlotSpec(id, name);

  const deleteSpec = (id: string): void => {
    const saved = useApp.getState().savedPlotSpecs.find((p) => p.id === id);
    useApp.getState().deletePlotSpec(id);
    if (saved) setStatus(`deleted "${saved.name}"`);
  };

  // Item 6: reuse the EXISTING export path — never a bespoke pipeline.
  // sendToStage() first, so Export works even if the user never clicked
  // "Send to Stage" themselves; the xy family (scatter/line) then renders
  // through the exact command the File menu's "Export figure…" runs
  // (lib/exportFigureCommand), reading the live xKey/yKeys it just set.
  // box/violin/bar render through the Stat Stage's OWN hook-local exporter
  // (useStatStage.exportFigure — it needs live UI state like the histogram
  // bin rule/fit distribution that only exists once that view is mounted),
  // which isn't reachable from here without duplicating that pipeline — so
  // this hands off with a toast instead of silently exporting the wrong
  // (flat xy) figure. A faceted box/violin/bar spec (#11, now real) degrades
  // the exact same way as any other stat-stage state: the Stat Stage's OWN
  // Export button disables itself while `drawFacets` is non-null (see
  // useStatStage's doc) — this toast hand-off never risks silently exporting
  // the wrong flat panel. The xy family's OWN facet export is a separate,
  // still-open residual: facetByColumn resets the live xKey/yKeys (baked
  // into facetPanels instead), so an exported xy facet spec falls back to
  // the plot's default channel selection.
  const exportPlot = async (): Promise<void> => {
    if (!ds || !canSend) return;
    sendToStage();
    if (spec.mark === "scatter" || spec.mark === "line") {
      await runExportFigureCommand(useApp.getState);
      return;
    }
    toast(`${spec.mark} exports from the Stat Stage's own Export button (now showing).`, "info");
  };

  return {
    hasData: !!ds,
    datasetId: ds?.id ?? null,
    spec,
    mark: spec.mark,
    family,
    marks,
    render,
    options,
    chips,
    assign,
    remove,
    moveY,
    cycle,
    reset,
    canSend,
    sendToStage,
    canOpenFigureBuilder,
    figureBuilderReason,
    openInFigureBuilder,
    savedSpecs,
    activeSpec,
    dirty,
    saveActive,
    saveAs,
    openSpec,
    duplicateSpec,
    renameSpec,
    deleteSpec,
    exportPlot,
  };
}
