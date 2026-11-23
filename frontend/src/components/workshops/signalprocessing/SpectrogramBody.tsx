// Signal Processing, Spectrogram: a short-time Fourier transform of ONE signal
// column, previewed as a heat map and added as a map worksheet (X = segment
// centre, Y = frequency, Z = the scaled spectrum) through the shared analysis
// commit contract. Rendered by SignalProcessingPanel in place of the
// recipe-based operations. Form model: spectrogramModel.ts; run: useSpectrogramRun.ts.

import { useEffect, useMemo, useState } from "react";

import { analysisData, droppedRows } from "../../../lib/rowstate";
import { xUnitOf } from "../../../lib/transformResample";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { Select } from "../../primitives";
import { Checkbox } from "../../primitives/Checkbox";
import { NumberField } from "../../primitives/NumberField";
import { WorkbenchActions, WorkbenchMessage, WorkbenchPreviewFrame } from "../workbench/WorkbenchParts";
import SignalOperationPicker from "./SignalOperationPicker";
import SignalRangeFields, { xExtent } from "./SignalRangeFields";
import SignalSaveRecipeButton from "./SignalSaveRecipeButton";
import { rangeNoteFor } from "./signalRangeNote";
import SpectrogramPreview from "./SpectrogramPreview";
import { measuredChannels } from "./signalProcessingModel";
import {
  DEFAULT_SPECTROGRAM_FORM,
  SPECTROGRAM_SCALINGS,
  SPECTROGRAM_WINDOWS,
  spectrogramParams,
  spectrogramTransformParams,
  type SpectrogramDetrend,
  type SpectrogramForm,
  type SpectrogramScaling,
  type SpectrogramWindow,
} from "./spectrogramModel";
import { useSpectrogramRun } from "./useSpectrogramRun";

export default function SpectrogramBody({ active, onPick, onClose }: {
  active: Dataset;
  onPick: (operation: string) => void;
  onClose: () => void;
}) {
  const plotted = useApp((s) => s.yKeys);
  const available = useMemo(() => measuredChannels(active), [active]);
  const [channel, setChannel] = useState<number | null>(null);
  const [form, setForm] = useState<SpectrogramForm>(DEFAULT_SPECTROGRAM_FORM);
  const set = (patch: Partial<SpectrogramForm>) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => {
    // Keep the user's pick while it is still a measured column; seed it only when there is none.
    setChannel((current) => (current !== null && available.includes(current)
      ? current
      : (plotted ?? []).find((c) => available.includes(c)) ?? available[0] ?? null));
  }, [available, plotted]);

  const source = analysisData(active) ?? active.data;
  useEffect(() => {
    const extent = xExtent(active.data.time);
    if (extent) setForm((f) => ({ ...f, ...extent }));
  }, [active.id, active.data.time]);

  const params = useMemo(() => spectrogramParams(form, channel, source.time.length, source.time), [form, channel, source]);
  const run = useSpectrogramRun(active, params);
  const validation = active.pending ? "Wait for the full dataset to load." : typeof params === "string" ? params : "";
  const dropped = droppedRows(active).size;
  const rangeNote = rangeNoteFor(source.time, form);
  const xUnit = xUnitOf(active.data);
  const add = () => {
    const outcome = run.add();
    if (outcome && outcome.kind !== "refused") onClose();
  };

  return (
    <>
      <SignalOperationPicker value="spectrogram" onChange={onPick} />
      <label className="qz-signal-field">Signal column
        <Select
          value={channel === null ? "" : String(channel)}
          onChange={(event) => setChannel(Number(event.target.value))}
          options={available.map((c) => ({ value: String(c), label: active.data.labels[c] ?? `Column ${c + 1}` }))}
        />
      </label>
      <div className="qz-spectral-controls">
        <label>Window
          <Select value={form.window} onChange={(event) => set({ window: event.target.value as SpectrogramWindow })} options={SPECTROGRAM_WINDOWS} />
        </label>
        <label>Scaling
          <Select value={form.scaling} onChange={(event) => set({ scaling: event.target.value as SpectrogramScaling })} options={SPECTROGRAM_SCALINGS} />
        </label>
        <label>Segment length (rows)
          <NumberField min={8} step={1} value={form.segmentLen} onChange={(segmentLen) => set({ segmentLen })} aria-label="Segment length" />
        </label>
        <label>Overlap (%)
          <NumberField min={0} max={99} step={5} value={form.overlapPct} onChange={(overlapPct) => set({ overlapPct })} aria-label="Overlap" />
        </label>
        <label>Detrend each segment
          <Select value={form.detrend} onChange={(event) => set({ detrend: event.target.value as SpectrogramDetrend })} options={[
            { value: "mean", label: "Remove mean" },
            { value: "linear", label: "Remove line" },
            { value: "none", label: "None" },
          ]} />
        </label>
        <Checkbox checked={form.resample} onChange={(resample) => set({ resample })}>
          Resample an uneven {xUnit ? `${xUnit} ` : ""}axis onto an even grid
        </Checkbox>
        <div className="qz-signal-note">
          Frequency is in cycles per {xUnit || "X unit"}. The X axis must be evenly spaced unless resampling is on.
        </div>
      </div>
      <SignalRangeFields value={form} onChange={set} />
      <WorkbenchPreviewFrame loading={run.loading}>
        {run.result ? <SpectrogramPreview data={run.result} /> : <div className="qz-signal-note">No preview yet.</div>}
      </WorkbenchPreviewFrame>
      <div className="qz-signal-note">
        Reads the {source.time.length.toLocaleString()} included rows in their original order
        {dropped ? ` (${dropped.toLocaleString()} excluded or filtered rows are left out)` : ""}; the source is never overwritten.
        {rangeNote && <> {rangeNote}</>}
        Add creates a map worksheet you can open in the Map tab.
      </div>
      <WorkbenchMessage refusal={validation} error={run.error} />
      <WorkbenchActions
        onCancel={onClose}
        commitLabel="Add as map worksheet"
        busyLabel="Adding…"
        busy={false}
        disabledReason={validation || run.error || (!run.result ? "Waiting for the live preview…" : run.commit.disabledReason)}
        onCommit={add}
      >
        <SignalSaveRecipeButton
          dataset={active}
          params={typeof params === "object" ? spectrogramTransformParams(params) : null}
          defaultName={`Spectrogram · ${channel === null ? active.name : active.data.labels[channel] ?? active.name}`}
          disabledReason={validation}
        />
      </WorkbenchActions>
    </>
  );
}
