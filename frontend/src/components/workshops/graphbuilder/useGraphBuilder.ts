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
import {
  figureTransitionWarning,
  plotSpecPublicationCompatibility,
} from "../../../lib/figureCompatibility";
import { encodedSpecRender, specFigureEncoding, type EncodedSpec } from "../../../lib/plotEncoding";
import { buildEncodedExport } from "../../../lib/plotEncodingExport";
import { statSeed } from "../../../lib/plotEncodingStat";
import { plotSpecFigureReason, plotSpecToFigureDocument } from "../../../lib/plotSpecFigure";
import { applySpecBlocks } from "../../../lib/plotspecApply";
import { specGroupCol, specXKey } from "../../../lib/plotspecGroupCol";
import {
  assignZone,
  clearZone,
  cycleMark,
  defaultMark,
  emptySpec,
  markContext,
  markFamily,
  markSeriesStyle,
  moveYZone,
  plotSpecCoreEqual,
  prefillErrorZones,
  specDatasetId,
  specErrorBindings,
  validMarks,
  withInferredMark,
  type ChannelRef,
  type MarkFamily,
  type PlotMark,
  type PlotSpec,
  type SavedPlotSpec,
  type SpecRender,
  type StepMode,
  type ZoneName,
} from "../../../lib/plotspec";
import { toast } from "../../../store/toasts";
import { plotIntentStageTab, useActiveDataset, useApp } from "../../../store/useApp";
import { withFocusedEncoding } from "../../../store/windowDocuments";
import { askConfirm } from "../../overlays/ConfirmDialog";
import { captureLiveBlocks } from "./captureLiveBlocks";
import { encodingChip, encodingOptions, encodingRef, isEncodingZone, type EncodingZone } from "./encodingWellModel";
import { ownXLabel, xWellOptions } from "./xWellModel";
import type { WellChip, WellOption } from "./ZoneWell";

/** Does this spec's error wells already carry explicit content? Drives
 *  `errorsTouched`'s reset on every wholesale spec replacement (#51 phase
 *  3) — a spec loaded WITH wells content must never have it silently
 *  auto-overwritten by a later Y drop. */
function wellsHaveContent(s: PlotSpec): boolean {
  return s.zones.yErr.length > 0 || s.zones.xErr !== null;
}

export interface GraphBuilderState {
  hasData: boolean;
  datasetId: string | null;
  spec: PlotSpec;
  mark: PlotMark;
  family: MarkFamily | null;
  marks: PlotMark[]; // the valid cycle for the current zones (>1 → cycler shown)
  /** Origin's "Line + Symbol" toggle (line/step marks only — scatter always
   *  shows markers). Mirrors `PlotSpec.showMarkers`, coerced to a plain
   *  boolean for the UI. */
  showMarkers: boolean;
  setShowMarkers: (v: boolean) => void;
  /** The "step" mark's alignment. Mirrors `PlotSpec.stepMode`, defaulted to
   *  "post" for the UI (matches `markSeriesStyle`'s own default). Only
   *  meaningful when `mark === "step"`. */
  stepMode: StepMode;
  setStepMode: (mode: StepMode) => void;
  render: SpecRender;
  /** Well options (click-to-assign) — every channel of the active dataset. */
  options: WellOption[];
  xOptions: WellOption[]; // the X well's: the dataset's own X (a negative channel), then `options`
  /** Assigned chips for a zone, with labels resolved for the UI. */
  chips: (zone: ZoneName) => WellChip[];
  assign: (zone: ZoneName, channel: number) => void;
  remove: (zone: ZoneName, channel: number) => void;
  moveY: (channel: number, direction: -1 | 1) => void;
  cycle: () => void;
  /** Clears the wells AND unbinds from any saved spec — a fresh graph. */
  reset: () => void;
  canPlot: boolean;
  createNewPlot: () => void;
  canApplyToCurrent: boolean;
  applyToCurrent: () => void;
  canOpenFigureBuilder: boolean;
  figureBuilderReason: string | null;
  figureBuilderLosses: string[];
  openInFigureBuilder: () => Promise<void>;

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
  /** Apply the current spec to the focused plot, then export via the SAME path the
   *  File menu's "Export figure…" command uses (xy family only — see the
   *  module doc). */
  exportPlot: () => Promise<void>;
  /** P1.4: the encoded series the preview draws (styles + legend entries), or
   *  null when the spec renders through the ordinary path (lib/plotEncoding). */
  encoded: EncodedSpec | null;
  /** The Color / Symbol / Label wells' options (./encodingWellModel). */
  encodingOptions: Record<EncodingZone, WellOption[]>;
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
  const liveSeriesStyles = useApp((s) => s.seriesStyles);

  const [spec, setSpec] = useState<PlotSpec>(emptySpec);
  // Error wells (#51 phase 3): true once the user has explicitly touched the
  // yErr/xErr wells (assigned OR removed a chip in either) OR loaded a spec
  // that already carries wells content — from that point on, dropping a new
  // Y never auto-prefills over what the user already has. Reset to whatever
  // the freshly-loaded spec's OWN wells content implies whenever the whole
  // spec is replaced wholesale (reset/openSpec/duplicateSpec/seed-consume/
  // vanished-dataset wipe) — see `wellsHaveContent` below.
  const [errorsTouched, setErrorsTouched] = useState(false);

  // MAIN #8i: the builder's WORKING dataset. An empty spec follows the active
  // dataset (the bare command-palette open, unchanged); a spec with channel
  // refs is BOUND to their dataset — which lets the worksheet handoff seed a
  // non-active dataset's columns without `setActive`'s plot-intent side
  // effects (window rebind, view reset, worksheet-tab flip) firing at
  // overlay-OPEN time. The plot intent lands in an explicit plot action, where
  // the user actually commits to plotting.
  const boundId = specDatasetId(spec);
  const ds = useMemo(
    () => (boundId !== null ? (datasets.find((d) => d.id === boundId) ?? null) : active),
    [boundId, datasets, active],
  );

  // A channel ref into a vanished dataset would reference the wrong columns —
  // wipe the spec when its dataset no longer resolves. An active-dataset
  // change alone no longer wipes a BOUND session (#8i): the builder holds a
  // spec for ITS dataset; a plot action brings that dataset back active. Reads `spec`
  // from the closure (not a functional setSpec updater) so the #11
  // activePlotSpecId clear below is computed from the SAME snapshot, not a
  // React-internals-timing-dependent updater invocation.
  useEffect(() => {
    const bound = specDatasetId(spec);
    const exists = bound !== null && useApp.getState().datasets.some((d) => d.id === bound);
    if (bound !== null && !exists) {
      setSpec(emptySpec());
      setErrorsTouched(false);
      // #11: a wiped spec can no longer correspond to whatever saved entry
      // this session was bound to.
      useApp.getState().setActivePlotSpecId(null);
    }
    // active-dataset change, by design (#8i); `spec`/`datasets` read fresh.
  }, [active?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- `spec` deliberately excluded (R9): would refire the wipe-check on every edit, not just an active-dataset change (#8i tests below).

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
      // #51 phase 3: a worksheet seed never carries wells content today, but
      // stay honest about the rule rather than hardcoding false.
      setErrorsTouched(wellsHaveContent(seed));
      // #11: a worksheet-handed seed starts as a fresh, unsaved graph — it
      // never carries a saved-spec id to bind to.
      useApp.getState().setActivePlotSpecId(null);
    }
    useApp.getState().clearGraphBuilderSeed();
  }, [seed]);

  const ctx = useMemo(() => markContext(spec, datasets), [spec, datasets]);
  const { render, encoded } = useMemo(() => encodedSpecRender(spec, datasets), [spec, datasets]);
  const marks = useMemo(() => validMarks(spec, ctx), [spec, ctx]);
  const family = useMemo(() => markFamily(spec, ctx), [spec, ctx]);

  const options = useMemo<WellOption[]>(() => (ds ? ds.data.labels.map((label, index) => ({ index, label })) : []), [ds]);
  const xOptions = useMemo(() => xWellOptions(ds, options), [ds, options]);
  // P1.4: what the Color / Symbol / Label wells offer, show and accept.
  const encOptions = useMemo(() => encodingOptions(ds, options), [ds, options]);

  const labelOf = (c: number): string => (ds && c < 0 ? ownXLabel(ds.data) : (ds?.data.labels[c] ?? `col ${c}`));

  const chips = (zone: ZoneName): WellChip[] => {
    const z = spec.zones;
    if (zone === "y") return z.y.map((r) => ({ channel: r.channel, label: labelOf(r.channel) }));
    if (zone === "yErr") return z.yErr.map((r) => ({ channel: r.channel, label: labelOf(r.channel) }));
    const ref = z[zone];
    if (!ref) return [];
    return [isEncodingZone(zone) ? encodingChip(ds, zone, ref, spec) : { channel: ref.channel, label: labelOf(ref.channel) }];
  };

  const assign = (zone: ZoneName, channel: number) => {
    if (!ds) return;
    const ref: ChannelRef | string = isEncodingZone(zone) ? encodingRef(ds, zone, channel, spec) : { datasetId: ds.id, channel };
    if (typeof ref === "string") return toast(ref, "info");
    // #51 phase 3: an explicit drop into either error well IS the user
    // touching it — no further auto-prefill on this session's future Y drops.
    if (zone === "yErr" || zone === "xErr") setErrorsTouched(true);
    setSpec((prev) => {
      let next = assignZone(prev, zone, ref);
      next = withInferredMark(next, markContext(next, datasets));
      // Origin's zero-click experience: a fresh Y drop, with the error wells
      // still untouched, seeds them from the dataset's own name-based
      // inference. Recomputes the WHOLE prefix each time (safe: nothing to
      // lose while untouched) so removing/reordering Y stays consistent too.
      if (zone === "y" && !errorsTouched) {
        next = prefillErrorZones(next, ds.data, ds.id);
      }
      return next;
    });
  };

  const remove = (zone: ZoneName, channel: number) => {
    if (zone === "yErr" || zone === "xErr") setErrorsTouched(true);
    setSpec((prev) => {
      const ref: ChannelRef = { datasetId: prev.zones.y[0]?.datasetId ?? ds?.id ?? "", channel };
      const next = clearZone(prev, zone, zone === "y" || zone === "yErr" ? ref : undefined);
      return withInferredMark(next, markContext(next, datasets));
    });
  };
  const moveY = (channel: number, direction: -1 | 1) => setSpec((prev) =>
    moveYZone(prev, { datasetId: ds?.id ?? "", channel }, direction));

  const cycle = () => setSpec((prev) => ({ ...prev, mark: cycleMark(prev, markContext(prev, datasets)) }));

  const setShowMarkers = (v: boolean) => setSpec((prev) => ({ ...prev, showMarkers: v }));
  const setStepMode = (mode: StepMode) => setSpec((prev) => ({ ...prev, stepMode: mode }));

  // #11: a Reset is a fresh start — it also unbinds from whatever saved spec
  // this session was editing, so the (now cleared) wells don't read as a
  // "dirty" divergence from a graph the user no longer intends to touch.
  const reset = () => {
    setSpec(emptySpec());
    setErrorsTouched(false);
    useApp.getState().setActivePlotSpecId(null);
  };

  const canPlot = family !== null; // there's a value to plot
  const focusedWindowId = useApp((s) => s.focusedWindowId);
  const focusedWindowKind = useApp(
    (s) => s.plotWindows.find((window) => window.id === s.focusedWindowId)?.kind ?? null,
  );
  const canApplyToCurrent = canPlot && focusedWindowId !== null && focusedWindowKind === "plot";
  const figureCompatibility = plotSpecPublicationCompatibility(spec, liveSeriesStyles);
  const figureBuilderReason = figureCompatibility.blocker;
  const figureBuilderLosses = figureCompatibility.losses;
  const canOpenFigureBuilder = ds !== null && figureBuilderReason === null;

  function commitToPlot(destination: "new" | "current"): void {
    if (!ds) return;
    const app = useApp.getState();
    if (destination === "new") {
      const id = app.createWindow(ds.id);
      app.focusWindow(id);
    } else {
      const focused = app.plotWindows.find((window) => window.id === app.focusedWindowId);
      if (!focused || focused.kind !== "plot") {
        toast("Focus an editable plot before applying this graph.", "info");
        return;
      }
      // Applying is an explicit rebind gesture, so it may deliberately
      // retarget a pinned plot. `rebindWindow` owns the focused-window facade
      // reset and lazy-dataset fetch for that case.
      if (focused.datasetId !== ds.id) app.rebindWindow(focused.id, ds.id);
    }
    // MAIN #8i: the plot intent lands HERE — the moment the user commits to
    // plotting — not at overlay-open. A builder bound to a non-active dataset
    // (the worksheet handoff) rebinds now; every store action below then acts
    // on the freshly-active dataset. setActive is the deliberate plot-intent
    // primitive (window rebind / view reset / worksheet-override clear).
    if (useApp.getState().activeId !== ds.id) useApp.getState().setActive(ds.id);
    // Owner-routing item 1: committing a graph always means look at the plot
    // (every branch below renders inside the Plot tab — scatter/line/facet
    // on the main canvas, box/violin/bar via StatStage), so surface it
    // regardless of which tab the user is currently on.
    const wantTab = plotIntentStageTab(ds);
    if (useApp.getState().stageTab !== wantTab) setStageTab(wantTab);
    if (spec.mark === "scatter" || spec.mark === "line" || spec.mark === "step") {
      setXKey(specXKey(spec)); // own X (a negative channel) = null, as an empty well
      setYKeys(spec.zones.y.map((r) => r.channel));
      setStatMode(false);
      // GAP_PLOTTYPES: the mark NEVER otherwise reaches the Stage — without
      // this, a "scatter"/"step" recipe would render however the window was
      // last styled (or the ambient default trace), not what the user built.
      // Translate mark+showMarkers/stepMode into a per-Y-channel style patch
      // and push it BEFORE applySpecBlocks, so a saved spec's own captured
      // per-series styles (the display block below) still WIN — setSeriesStyle
      // merges by field, and applyDisplayBlock's reset+rebuild for a channel
      // that HAS a captured entry fully supersedes whatever this set first.
      const markStyle = markSeriesStyle(spec);
      if (Object.keys(markStyle).length > 0) {
        for (const y of spec.zones.y) useApp.getState().setSeriesStyle(y.channel, markStyle);
      }
      // Error wells (#51 phase 3): translate to the canonical ErrorBinding[]
      // and write through the SAME dataset-level action the Inspector's
      // Error columns card uses (setErrorRoles) — error roles are a
      // Dataset property, not per-window, so this is what makes the
      // interactive Stage (usePlotPayload reads Dataset.errorRoles directly)
      // AND the ordinary "Export figure…" path (buildFigureSpec reads
      // ds.errorRoles) both pick up the wells with no further wiring.
      // Deliberately a no-op when the wells are EMPTY: an empty-wells commit
      // must not clear roles set some other way (Detect from names, the
      // Inspector card, a prior commit) — same "don't reset unrelated view
      // state" rule the mark-style patch above follows.
      const errorBindings = specErrorBindings(spec);
      if (errorBindings.length > 0) {
        useApp.getState().setErrorRoles(ds.id, errorBindings);
      }
      // #12 Slice 5 / "part C": apply the spec's own captured
      // display/axes/decor blocks (if any) onto the now-live dataset —
      // closes the save/reopen/apply loop. A v1 spec (no blocks) makes zero
      // calls here — see plotspecApply.ts's regression-pin note.
      applySpecBlocks(spec, useApp.getState);
      // P1.5: durable live binding (store.groupKey) -- clears any stale group
      // left over from a prior commit when this one carries none.
      useApp.getState().setGroupKey(spec.zones.group?.channel ?? null);
      // Facet zone filled (gap #21 residual): enter the main Stage's facet
      // grid instead of the flat plot. facetByColumn is called AFTER
      // setXKey/setYKeys above, so its own "carry the current x/y selection
      // when the dataset is already active" rule picks up exactly the
      // channels just assigned.
      // P1.4: the encodings ride the window's document (the Stage draws and exports them); none set clears stale ones.
      useApp.setState((s) => ({ plotWindows: withFocusedEncoding(s.plotWindows, s.focusedWindowId, specFigureEncoding(spec)) }));
      if (spec.zones.facet) {
        facetByColumn(ds.id, spec.zones.facet.channel);
        setStatus(
          destination === "new"
            ? `created ${spec.mark} plot, faceted by ${labelOf(spec.zones.facet.channel)}`
            : `applied ${spec.mark} to the current plot, faceted by ${labelOf(spec.zones.facet.channel)}`,
        );
        return;
      }
      setStatus(destination === "new" ? `created ${spec.mark} plot` : `applied ${spec.mark} to the current plot`);
      return;
    }
    // box/violin/bar (below): #12 Slice 5 investigated applying the spec's
    // axes.title/x/y labels here too, but useStatStage ALWAYS derives its own
    // title/x_label/y_label from the group/value/facet column labels at
    // draw/export time (e.g. `${valueLabel} by ${groupLabel}`) — there is no
    // store-driven override it reads. Applying the block would silently do
    // nothing (or fight a future StatStage change), so this is a deliberate
    // no-op rather than a dead call — see plotspecApply.ts, not wired here.
    if (spec.mark === "box" || spec.mark === "violin") {
      const facetCol = spec.zones.facet?.channel ?? null;
      seedStatStage(statSeed(spec, ds)); // P1.4: a Color pick may nest the axis (lib/plotEncodingStat)
      setStatus(
        facetCol !== null
          ? `${destination === "new" ? "created" : "applied"} ${spec.mark} plot in the stat stage, faceted by ${labelOf(facetCol)}`
          : `${destination === "new" ? "created" : "applied"} ${spec.mark} plot in the stat stage`,
      );
      return;
    }
    // mark === "bar" (gap #20): the stat stage's bar mode reads its series
    // from the main plot's Y selection (mirrors box/violin's own fallback —
    // see useStatStage's barValueChannels), so valueCol here is really just a
    // placeholder the seed shape requires; groupCol is the real payload.
    const groupCol = specGroupCol(spec, ds);
    if (groupCol === null) {
      toast("Bar charts need a categorical X column.", "info");
      return;
    }
    const facetCol = spec.zones.facet?.channel ?? null;
    seedStatStage(statSeed(spec, ds));
    setStatus(
      facetCol !== null
        ? `${destination === "new" ? "created" : "applied"} bar chart in the stat stage, faceted by ${labelOf(facetCol)}`
        : `${destination === "new" ? "created" : "applied"} bar chart in the stat stage`,
    );
  }

  const createNewPlot = (): void => commitToPlot("new");
  const applyToCurrent = (): void => commitToPlot("current");

  async function openInFigureBuilder(): Promise<void> {
    if (!ds) return;
    if (figureBuilderLosses.length > 0) {
      const proceed = await askConfirm(
        "Open Publication Preview with limited settings?",
        figureTransitionWarning(figureBuilderLosses),
        "Open Preview",
      );
      if (!proceed) return;
    }
    // P1.4: `encoded` (the preview's own derivation) carries Color/Symbol/Label onto the draft.
    const doc = plotSpecToFigureDocument(spec, activeSpec?.name ?? "Graph Builder plot", useApp.getState().seriesStyles, encoded);
    if (!doc) {
      toast(plotSpecFigureReason(spec) ?? "This graph cannot open in Publication Preview.", "info");
      return;
    }
    if (!useApp.getState().beginDetachedFigurePublicationEdit(doc)) return;
    setStatus("opened XY plot in Publication Preview");
  }

  // ── Saved PlotSpecs (#11 / #12 Slice 3) ────────────────────────────────────
  const activeSpec = useMemo(
    () => savedSpecs.find((p) => p.id === activeSpecId) ?? null,
    [savedSpecs, activeSpecId],
  );
  // #12 Slice 3: compares ZONES + MARK only, never the v2 blocks — see
  // plotSpecCoreEqual's doc for why a full-spec compare here would falsely
  // read "dirty" right after a save (captureLiveBlocks below hands the store
  // a spec with blocks the live `spec` state itself never gets back).
  const dirty = activeSpec !== null && !plotSpecCoreEqual(spec, activeSpec.spec);

  // #12 Slice 3 capture-on-save: ./captureLiveBlocks (moved out for P1.4).
  const saveActive = (): void => {
    const id = useApp.getState().savePlotSpec(captureLiveBlocks(spec, useApp.getState));
    if (!id) return; // nothing active — the panel falls back to saveAs
    const nm = useApp.getState().savedPlotSpecs.find((p) => p.id === id)?.name ?? "";
    setStatus(`saved "${nm}"`);
  };

  const saveAs = (name: string): void => {
    const id = useApp.getState().saveAsPlotSpec(name, captureLiveBlocks(spec, useApp.getState));
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
    // #51 phase 3: a reopened spec's own wells content (if any) is explicit
    // user state from when it was saved — protect it from the next Y drop
    // the same way a live touch does. An empty-wells save re-arms prefill.
    setErrorsTouched(wellsHaveContent(saved.spec));
    useApp.getState().setActivePlotSpecId(id);
    // #12 Slice 5 / "part C": opening never applies the spec's
    // display/axes/decor blocks itself (that would silently mutate the live
    // plot on a mere open) — only an explicit plot action does (applySpecBlocks, above). This
    // is the one affordance that tells the user those blocks exist at all.
    const hint = saved.spec.display || saved.spec.axes || saved.spec.decor
      ? " (includes saved styles — a plot action applies them)"
      : "";
    setStatus(`opened "${saved.name}"${hint}`);
  };

  const duplicateSpec = (id: string): void => {
    const newId = useApp.getState().duplicatePlotSpec(id);
    if (!newId) return;
    const saved = useApp.getState().savedPlotSpecs.find((p) => p.id === newId);
    if (!saved) return;
    setSpec(withInferredMark(saved.spec, markContext(saved.spec, useApp.getState().datasets)));
    setErrorsTouched(wellsHaveContent(saved.spec));
    setStatus(`duplicated as "${saved.name}"`);
  };

  const renameSpec = (id: string, name: string): void => useApp.getState().renamePlotSpec(id, name);

  const deleteSpec = (id: string): void => {
    const saved = useApp.getState().savedPlotSpecs.find((p) => p.id === id);
    useApp.getState().deletePlotSpec(id);
    if (saved) setStatus(`deleted "${saved.name}"`);
  };

  // Item 6: reuse the EXISTING export path — never a bespoke pipeline.
  // applyToCurrent() first, so Export works even if the user never applied
  // the graph themselves; the xy family (scatter/line) then renders
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
  // the wrong flat panel. The xy family's OWN facet export used to be a
  // separate residual (facetByColumn's trailing setActive reset the live
  // xKey/yKeys even though the dataset was already active, so an exported xy
  // facet spec fell back to the plot's default channel selection) — FIXED
  // in GUI_INTERACTION #12 slice 4b (store/windows.ts's focusedRebindPatch
  // now only resets channel-keyed defaults on a genuine dataset switch), so
  // the export below reflects whatever channels the facet grid is showing.
  const exportPlot = async (): Promise<void> => {
    if (!ds || !canApplyToCurrent) return;
    applyToCurrent();
    if (spec.mark === "scatter" || spec.mark === "line" || spec.mark === "step") {
      // P1.4: an encoded graph exports the preview's series over the applied
      // plot's presentation, same dialog + chokepoint (lib/plotEncodingExport).
      await runExportFigureCommand(
        useApp.getState,
        encoded ? (stem, d, o) => buildEncodedExport(useApp.getState, spec, d, stem, o) : undefined,
      );
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
    showMarkers: spec.showMarkers === true,
    setShowMarkers,
    stepMode: spec.stepMode ?? "post",
    setStepMode,
    render,
    options,
    xOptions,
    chips,
    assign,
    remove,
    moveY,
    cycle,
    reset,
    canPlot,
    createNewPlot,
    canApplyToCurrent,
    applyToCurrent,
    canOpenFigureBuilder,
    figureBuilderReason,
    figureBuilderLosses,
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
    encoded,
    encodingOptions: encOptions,
  };
}
