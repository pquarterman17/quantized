// Resample workshop, "Reduce rows" side (gap audit 4, G7): bin-average by X,
// average duplicate X, keep every Nth row. These make a NEW, smaller dataset
// from real data (unlike plot decimation) and are recorded as `sigop` transform
// steps. Works on the ACTIVE dataset. Thin: the form model is
// signalprocessing/sigopModel.ts, preview/commit is useSigopRun.ts.

import { useMemo, useState } from "react";

import { analysisData } from "../../../lib/rowstate";
import { xUnitOf } from "../../../lib/transformResample";
import { useApp } from "../../../store/useApp";
import { Button, Select } from "../../primitives";
import SigopFields from "../signalprocessing/SigopFields";
import SignalChannelInputs from "../signalprocessing/SignalChannelInputs";
import SignalPreview from "../signalprocessing/SignalPreview";
import { measuredChannels } from "../signalprocessing/signalProcessingModel";
import {
  DEFAULT_SIGOP_FORM,
  REDUCE_OPTIONS,
  sigopParamsFromForm,
  type ReduceMethod,
  type SigopForm,
} from "../signalprocessing/sigopModel";
import { useSigopRun } from "../signalprocessing/useSigopRun";

export default function ReduceXYSection({ onClose }: { onClose: () => void }) {
  const datasets = useApp((s) => s.datasets);
  const activeId = useApp((s) => s.activeId);
  const active = datasets.find((d) => d.id === activeId) ?? null;
  const [method, setMethod] = useState<ReduceMethod>("reduce-bin");
  const [form, setForm] = useState<SigopForm>(DEFAULT_SIGOP_FORM);
  const [picked, setPicked] = useState<number[] | null>(null); // null = every measured column
  const available = useMemo(() => (active ? measuredChannels(active) : []), [active]);
  const channels = picked ? picked.filter((c) => available.includes(c)) : available;
  const params = useMemo(() => sigopParamsFromForm(method, form, channels), [method, form, channels]);
  const run = useSigopRun(active, params);
  if (!active) return <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>Select a dataset to reduce.</div>;

  const source = analysisData(active) ?? active.data;
  const problem = active.pending ? "Wait for the full dataset to load." : typeof params === "string" ? params : run.error;
  const res = run.result;
  const create = async () => {
    if (await run.commit()) onClose();
  };
  return (
    <div aria-label="Reduce rows" role="group">
      <div className="qzk-ds-meta" style={{ marginBottom: 6, whiteSpace: "normal" }}>
        Makes a new, smaller dataset from <strong>{active.name}</strong> ({source.time.length.toLocaleString()} rows). Rows are never re-sorted.
      </div>
      <label className="qzk-field-lbl">Reduce by</label>
      <Select aria-label="Reduce by" value={method} options={REDUCE_OPTIONS} onChange={(e) => setMethod(e.target.value as ReduceMethod)} />
      {method !== "reduce-nth" && (
        <SignalChannelInputs dataset={active} available={available} channels={channels} setChannels={setPicked} />
      )}
      <div className="qz-signal-smooth">
        <SigopFields method={method} form={form} set={(patch) => setForm((f) => ({ ...f, ...patch }))} dataset={active} xUnit={xUnitOf(active.data)} />
      </div>
      <SignalPreview source={source} result={res?.data ?? null} channel={channels[0] ?? available[0] ?? 0} resultChannel={0} />
      {res && (
        <div className="qzk-ds-meta" aria-live="polite" style={{ marginTop: 4 }}>
          {res.rowsIn.toLocaleString()} rows → {res.rowsOut.toLocaleString()} rows
          {res.warnings.map((w) => <div key={w.text}>{w.text}</div>)}
        </div>
      )}
      {problem && <div className="qzk-ds-meta" role="alert" style={{ marginTop: 6, color: "var(--danger)" }}>{problem}</div>}
      <Button
        variant="primary"
        size="sm"
        disabled={Boolean(problem) || !res || run.busy}
        title={problem || (!res ? "Waiting for the live preview…" : undefined)}
        onClick={() => void create()}
        style={{ marginTop: 12, width: "100%" }}
      >
        {run.busy ? "Creating…" : "Create reduced dataset"}
      </Button>
    </div>
  );
}
