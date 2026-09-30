// Reflectivity workshop — "Spin asym." mode: SA = (R++ - R--)/(R++ + R--)
// from two measured spin channels on one Q grid, with dSA propagated from
// each channel's dR. Loaded lazily from ReflectivityPanel; state in
// ./useSpinAsymmetry, rules in ./spinAsymmetry.

import { Button, Select } from "../../primitives";
import { useSpinAsymmetry, type ChannelPick, type SpinAsymmetryState } from "./useSpinAsymmetry";

const faint = { color: "var(--text-faint)" } as const;

function ChannelRow({ label, pick, onChange, s }: {
  label: string;
  pick: ChannelPick;
  onChange: (p: Partial<ChannelPick>) => void;
  s: SpinAsymmetryState;
}) {
  const ds = s.datasets.find((d) => d.id === pick.id);
  const cols = (ds?.data.labels ?? []).map((l, i) => ({ value: String(i), label: l || `Column ${i + 1}` }));
  return (
    <>
      <label className="qzk-field-lbl" style={{ margin: 0 }}>{label}</label>
      <Select
        aria-label={`${label} dataset`}
        disabled={s.busy}
        options={[{ value: "", label: "Pick a dataset…" }, ...s.datasets.map((d) => ({ value: d.id, label: d.name }))]}
        value={ds ? pick.id : ""}
        onChange={(e) => onChange({ id: e.target.value })}
      />
      <span />
      <span style={{ display: "inline-flex", gap: 6 }}>
        <Select aria-label={`${label} column`} disabled={s.busy || !ds} options={cols}
          value={String(pick.col)} onChange={(e) => onChange({ col: Number(e.target.value) })} />
        <Select aria-label={`${label} error`} disabled={s.busy || !ds}
          options={[{ value: "", label: "No dR" }, ...cols.map((c) => ({ ...c, label: `± ${c.label}` }))]}
          value={pick.errCol === null ? "" : String(pick.errCol)}
          onChange={(e) => onChange({ errCol: e.target.value === "" ? null : Number(e.target.value) })} />
      </span>
    </>
  );
}

export default function SpinAsymmetryView() {
  const s = useSpinAsymmetry();
  return (
    <div style={{ marginTop: 12 }}>
      <div className="qzk-ds-meta" style={{ ...faint, marginTop: 0 }}>
        SA = (R++ − R−−)/(R++ + R−−) on one shared Q grid.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 12px", marginTop: 8, alignItems: "center" }}>
        <ChannelRow label="R++" pick={s.pp} onChange={s.setPp} s={s} />
        <ChannelRow label="R−−" pick={s.mm} onChange={s.setMm} s={s} />
      </div>
      <Button variant="primary" size="sm" style={{ marginTop: 10 }} disabled={s.busy || s.block !== null}
        title={s.block ?? undefined} onClick={() => void s.compute()}>
        {s.busy ? "Computing…" : "Spin asymmetry → Library"}
      </Button>
      {s.block && <div className="qzk-ds-meta" style={{ ...faint, marginTop: 6 }}>{s.block}</div>}
      {s.error && <div className="qzk-ds-meta" role="alert" style={{ color: "var(--danger)", marginTop: 6 }}>{s.error}</div>}
      {s.done && <div className="qzk-ds-meta" role="status" style={{ marginTop: 6 }}>{s.done}</div>}
    </div>
  );
}
