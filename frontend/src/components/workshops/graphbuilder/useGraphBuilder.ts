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
  emptySpec,
  markContext,
  markFamily,
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
import { useActiveDataset, useApp } from "../../../store/useApp";
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

  const [spec, setSpec] = useState<PlotSpec>(emptySpec);

  // A channel from the previous dataset would reference the wrong columns — wipe
  // the spec whenever the active dataset changes.
  useEffect(() => {
    setSpec(emptySpec());
  }, [active?.id]);

  const ctx = useMemo(() => markContext(spec, datasets), [spec, datasets]);
  const render = useMemo(() => specToRender(spec, datasets), [spec, datasets]);
  const marks = useMemo(() => validMarks(spec, ctx), [spec, ctx]);
  const family = useMemo(() => markFamily(spec, ctx), [spec, ctx]);

  const options = useMemo<WellOption[]>(
    () => (active ? active.data.labels.map((label, index) => ({ index, label })) : []),
    [active],
  );

  const labelOf = (channel: number): string =>
    active?.data.labels[channel] ?? `col ${channel}`;

  const chips = (zone: ZoneName): WellChip[] => {
    const z = spec.zones;
    if (zone === "y") return z.y.map((r) => ({ channel: r.channel, label: labelOf(r.channel) }));
    const ref = z[zone];
    return ref ? [{ channel: ref.channel, label: labelOf(ref.channel) }] : [];
  };

  const assign = (zone: ZoneName, channel: number) => {
    if (!active) return;
    const ref: ChannelRef = { datasetId: active.id, channel };
    setSpec((prev) => {
      const next = assignZone(prev, zone, ref);
      return withInferredMark(next, markContext(next, datasets));
    });
  };

  const remove = (zone: ZoneName, channel: number) => {
    setSpec((prev) => {
      const ref: ChannelRef = { datasetId: prev.zones.y[0]?.datasetId ?? active?.id ?? "", channel };
      const next = clearZone(prev, zone, zone === "y" ? ref : undefined);
      return withInferredMark(next, markContext(next, datasets));
    });
  };

  const cycle = () => setSpec((prev) => ({ ...prev, mark: cycleMark(prev, markContext(prev, datasets)) }));

  const reset = () => setSpec(emptySpec());

  const canSend = family !== null; // there's a value to plot

  function sendToStage(): void {
    if (!active) return;
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
        facetByColumn(active.id, spec.zones.facet.channel);
        setStatus(`sent ${spec.mark} to the plot, faceted by ${labelOf(spec.zones.facet.channel)}`);
        return;
      }
      setStatus(`sent ${spec.mark} to the plot`);
      return;
    }
    if (spec.mark === "box" || spec.mark === "violin") {
      const x = spec.zones.x;
      const groupCol = x && isCategorical(channelModelingType(active, x.channel)) ? x.channel : null;
      seedStatStage({ mode: spec.mark, groupCol, valueCol: spec.zones.y[0].channel });
      setStatus(`sent ${spec.mark} plot to the stat stage`);
      return;
    }
    // mark === "bar" (gap #20): the stat stage's bar mode reads its series
    // from the main plot's Y selection (mirrors box/violin's own fallback —
    // see useStatStage's barValueChannels), so valueCol here is really just a
    // placeholder the seed shape requires; groupCol is the real payload.
    const x = spec.zones.x;
    const groupCol = x && isCategorical(channelModelingType(active, x.channel)) ? x.channel : null;
    if (groupCol === null) {
      toast("Bar charts need a categorical X column.", "info");
      return;
    }
    seedStatStage({ mode: "bar", groupCol, valueCol: spec.zones.y[0]?.channel ?? 0 });
    setStatus("sent bar chart to the stat stage");
  }

  return {
    hasData: !!active,
    datasetId: active?.id ?? null,
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
