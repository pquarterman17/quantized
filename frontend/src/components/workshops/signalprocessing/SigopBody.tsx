// Signal Processing, filter side: median / despike / LOWESS / convolve /
// deconvolve / Hilbert / inverse FFT. Rendered by SignalProcessingPanel in place
// of the recipe-based operations when one of these is picked. The result is an
// ordinary recorded `sigop` transform (a new dataset + a pipeline step), not a
// linked recipe worksheet. Thin: the form model is `sigopModel.ts`, the
// preview/commit is `useSigopRun.ts`, the maths is the backend.

import { useEffect, useMemo, useState } from "react";

import { analysisData, droppedRows } from "../../../lib/rowstate";
import { xUnitOf } from "../../../lib/transformResample";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { Button } from "../../primitives";
import SignalChannelInputs from "./SignalChannelInputs";
import SignalOperationPicker from "./SignalOperationPicker";
import SigopFields from "./SigopFields";
import SignalPreview from "./SignalPreview";
import { measuredChannels } from "./signalProcessingModel";
import {
  DEFAULT_SIGOP_FORM,
  sigopParamsFromForm,
  spectrumChannels,
  type SigopFilterMethod,
  type SigopForm,
} from "./sigopModel";
import { useSigopRun } from "./useSigopRun";

export default function SigopBody({ active, method, onPick, onClose }: {
  active: Dataset;
  method: SigopFilterMethod;
  onPick: (operation: string) => void;
  onClose: () => void;
}) {
  const plotted = useApp((s) => s.yKeys);
  const available = useMemo(() => measuredChannels(active), [active]);
  const [channels, setChannels] = useState<number[]>([]);
  const [form, setForm] = useState<SigopForm>(DEFAULT_SIGOP_FORM);
  const set = (patch: Partial<SigopForm>) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => {
    const picked = (plotted ?? []).filter((c) => available.includes(c));
    setChannels(picked.length ? picked : available.slice(0, 1));
  }, [available, plotted]);

  const labels = active.data.labels;
  useEffect(() => {
    const spec = spectrumChannels(labels);
    setForm((f) => ({ ...f, magnitudeChannel: spec.magnitude, phaseChannel: spec.phase }));
  }, [labels]);

  const params = useMemo(() => sigopParamsFromForm(method, form, channels), [method, form, channels]);
  const run = useSigopRun(active.pending ? null : active, params);
  const validation = active.pending ? "Wait for the full dataset to load." : typeof params === "string" ? params : "";
  const source = analysisData(active) ?? active.data;
  const channel = method === "ifft" ? form.magnitudeChannel : channels[0] ?? available[0] ?? 0;
  const flagged = useMemo(
    () => (run.result?.flagged[String(channel)] ?? []).flatMap((row) => {
      const y = source.values[row]?.[channel];
      return typeof y === "number" ? [[source.time[row], y] as const] : [];
    }),
    [run.result, source, channel],
  );
  const flaggedTotal = Object.values(run.result?.flagged ?? {}).reduce((n, rows) => n + rows.length, 0);
  const dropped = droppedRows(active).size;
  const create = async () => {
    if (await run.commit()) onClose();
  };
  const problem = validation || run.error;

  return (
    <>
      <SignalOperationPicker value={method} onChange={onPick} />
      {method !== "ifft" && <SignalChannelInputs dataset={active} available={available} channels={channels} setChannels={setChannels} />}
      <div className="qz-signal-smooth">
        <SigopFields method={method} form={form} set={set} dataset={active} xUnit={xUnitOf(active.data)} />
      </div>
      <SignalPreview
        source={source}
        result={run.result?.data ?? null}
        channel={channel}
        resultChannel={0}
        showOriginal={method !== "ifft"}
        flagged={flagged}
      />
      {method === "despike" && run.result && (
        <div className="qz-signal-note" aria-live="polite">
          {flaggedTotal === 0
            ? "No spikes found at this threshold."
            : `${flaggedTotal} spike point${flaggedTotal === 1 ? "" : "s"} flagged (circled) and replaced by interpolation.`}
        </div>
      )}
      <div className="qz-signal-note">
        Reads the {(source.time.length).toLocaleString()} included rows in their original order
        {dropped ? ` (${dropped.toLocaleString()} excluded or filtered rows are left out)` : ""}; the source is never overwritten.
      </div>
      {problem && <p className="qz-error" role="alert">{problem}</p>}
      <div className="qz-dialog-actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={Boolean(problem) || !run.result || run.busy} title={problem || (!run.result ? "Waiting for the live preview…" : undefined)} onClick={() => void create()}>
          {run.busy ? "Creating…" : "Create worksheet"}
        </Button>
      </div>
    </>
  );
}
