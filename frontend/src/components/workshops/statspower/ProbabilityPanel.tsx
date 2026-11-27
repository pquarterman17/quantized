// Probability calculator — view. A draggable ToolWindow: pick a distribution and
// its parameters (named as the worksheet formula functions take them), then read
// the pdf or pmf, cdf, survival and quantile of one value, or evaluate a whole
// worksheet column into a new linked worksheet. A value here equals the same
// formula typed into a column; the equivalent formulas are shown.

import BufferedNumberField from "../../primitives/BufferedNumberField";
import ToolWindow from "../../overlays/ToolWindow";
import { Button, Select } from "../../primitives";
import { SegmentedControl } from "../../primitives/SegmentedControl";
import { useAnalysisExtras } from "../../../store/analysisExtras";
import { pickOptions } from "../analysisextras/columnPicks";
import { useProbability } from "./useProbability";

const row = { display: "flex", gap: 10, marginTop: 8, flexWrap: "wrap", alignItems: "flex-end" } as const;
const fmt = (v: number | null | undefined): string => (typeof v === "number" ? String(Number(v.toPrecision(10))) : "-");

export default function ProbabilityPanel() {
  const hide = useAnalysisExtras((s) => s.hide);
  const c = useProbability();
  const r = c.result;
  const fx = r?.x?.[0] !== undefined;
  const rows: [string, string, string | null][] = r
    ? [
        ...(fx ? ([
          [r.discrete ? "pmf" : "pdf", fmt(r.pdf?.[0]), r.formulas.pdf],
          ["cdf P(X ≤ x)", fmt(r.cdf?.[0]), r.formulas.cdf],
          ["survival P(X > x)", fmt(r.sf?.[0]), r.formulas.sf],
        ] as [string, string, string | null][]) : []),
        ...(r.p?.[0] !== undefined ? ([["quantile", fmt(r.quantile?.[0]), r.formulas.quantile]] as [string, string, string | null][]) : []),
      ]
    : [];
  return (
    <ToolWindow id="prob-calc" title="Probability calculator" width={380} onClose={() => hide("prob-calc")}>
      <label className="qzk-field-lbl">Distribution</label>
      <Select aria-label="Distribution" options={c.dists.map((d) => ({ value: d.id, label: d.label }))} value={c.dist} onChange={(e) => c.setDist(e.target.value)} />
      <div style={row}>
        {c.info?.params.map((name, i) => (
          <div key={`${c.dist}.${name}`} style={{ flex: "1 1 80px", minWidth: 0 }}>
            <label className="qzk-field-lbl">{name}</label>
            <BufferedNumberField aria-label={name} value={c.values[i]} width={72} required onValue={(v) => c.setParam(name, v)} />
          </div>
        ))}
      </div>
      <div style={{ marginTop: 8 }}>
        <SegmentedControl
          options={[{ value: "value", label: "One value" }, { value: "column", label: "Worksheet column" }]}
          value={c.source}
          onChange={c.setSource}
        />
      </div>
      {c.source === "value" ? (
        <div style={row}>
          <div style={{ flex: "1 1 90px" }}>
            <label className="qzk-field-lbl">x</label>
            <BufferedNumberField aria-label="x" value={c.x} width={90} onValue={c.setX} />
          </div>
          <div style={{ flex: "1 1 90px" }}>
            <label className="qzk-field-lbl">p (for the quantile)</label>
            <BufferedNumberField aria-label="p" value={c.p} width={90} onValue={c.setP} />
          </div>
        </div>
      ) : !c.hasActive ? (
        <div className="qzk-helptext" style={{ marginTop: 8 }}>Load a worksheet to evaluate one of its columns.</div>
      ) : (
        <>
          <div style={row}>
            <div style={{ flex: "1 1 120px" }}>
              <label className="qzk-field-lbl">Column</label>
              <Select aria-label="Column" options={pickOptions(c.columns)} value={String(c.column)} onChange={(e) => c.setPick(Number(e.target.value))} />
            </div>
            <div style={{ flex: "1 1 120px" }}>
              <label className="qzk-field-lbl">Column holds</label>
              <Select aria-label="Column holds" options={[{ value: "x", label: "values x (pdf, cdf, survival)" }, { value: "p", label: "probabilities p (quantile)" }]} value={c.holds} onChange={(e) => c.setHolds(e.target.value === "p" ? "p" : "x")} />
            </div>
          </div>
          <Button variant="primary" size="sm" disabled={c.busy} onClick={() => void c.addColumn()} style={{ marginTop: 10, width: "100%" }}>
            {c.busy ? "Computing…" : "Add as linked worksheet"}
          </Button>
        </>
      )}
      {c.problem && <div className="qzk-ds-meta" role="alert" style={{ marginTop: 8, color: "var(--danger)" }}>{c.problem}</div>}
      {c.source === "value" && rows.length > 0 && !c.problem && (
        <div role="status" aria-label="Result" style={{ marginTop: 10 }}>
          <table style={{ width: "100%", fontFamily: "var(--font-mono)", fontSize: 12 }}>
            <tbody>
              {rows.map(([k, v, f]) => (
                <tr key={k} title={f ? `As a column formula (A holds the input): ${f}` : "Not a worksheet formula function"}>
                  <td style={{ color: "var(--text-faint)" }}>{k}</td>
                  <td style={{ textAlign: "right" }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="qzk-helptext" style={{ marginTop: 6, color: "var(--text-faint)" }}>Hover a row for the equivalent worksheet formula.</div>
        </div>
      )}
    </ToolWindow>
  );
}
