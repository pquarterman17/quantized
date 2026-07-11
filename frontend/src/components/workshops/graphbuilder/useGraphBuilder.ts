// Graph Builder (ORIGIN_GAP_PLAN #51 phase 2) — state hook. Holds a PlotSpec
// (lib/plotspec.ts — the grammar), morphs the mark as channels land in the
// wells, renders a live preview off the ANALYSIS view (guard #11, via
// specToRender → rowstate.analysisData), and "sends" the spec to the main stage:
// scatter/line through the ordinary axis store actions (setXKey/setYKeys — which
// record their own macro steps), box/violin through the stat-stage seed
// (seedStatStage → useStatStage pickers). When the Facet zone is also filled
// (scatter/line only — box/violin/bar don't facet, see plotspec.ts), sendToStage
// enters the main Stage's facet-grid mode (store.facetByColumn) instead of the
// flat plot: setXKey/setYKeys run FIRST so facetByColumn's own "carry the
// current x/y selection when the dataset is already active" rule picks them up
// (gap #21 residual — closes GAP_PLOTTYPES_PLAN item 5's booked (c)). Thin: all
// grammar lives in lib/plotspec.

import { useEffect, useMemo, useState } from "react";

import { channelModelingType, isCategorical } from "../../../lib/modeling";
import {
  assignZone,
  clearZone,
  cycleMark,
  defaultMark,
  emptySpec,
  markContext,
  markFamily,
  specDatasetId,
  specToRender,
  validMarks,
  withInferredMark,
  type ChannelRef,
  type MarkFamily,
  type PlotMark,
  type PlotSpec,
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
  cycle: () => void;
  reset: () => void;
  canSend: boolean;
  sendToStage: () => void;
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
  // spec for ITS dataset; Send brings that dataset back active.
  useEffect(() => {
    setSpec((prev) => {
      const bound = specDatasetId(prev);
      const exists =
        bound !== null && useApp.getState().datasets.some((d) => d.id === bound);
      return exists ? prev : emptySpec();
    });
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

  const cycle = () => setSpec((prev) => ({ ...prev, mark: cycleMark(prev, markContext(prev, datasets)) }));

  const reset = () => setSpec(emptySpec());

  const canSend = family !== null; // there's a value to plot

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
      seedStatStage({ mode: spec.mark, groupCol, valueCol: spec.zones.y[0].channel });
      setStatus(`sent ${spec.mark} plot to the stat stage`);
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
    seedStatStage({ mode: "bar", groupCol, valueCol: spec.zones.y[0]?.channel ?? 0 });
    setStatus("sent bar chart to the stat stage");
  }

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
    cycle,
    reset,
    canSend,
    sendToStage,
  };
}
