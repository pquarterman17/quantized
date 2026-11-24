// Statistical tests workshop — column pickers and settings for the SPC tests
// (control chart, process capability; GAP_AUDIT_9 J14). Every field label is
// also its accessible name. Specification limits start blank: no default.

import type { ReactNode } from "react";

import {
  SPC_CHARTS, SPC_MEMORY_CHARTS, SPC_NELSON_RULES, SPC_RULES, spcUsesSizeColumn, spcUsesSubgroups, type SpcParams, type SpcRuleId,
} from "../../../lib/statsTestsSpc";
import BufferedNumberField from "../../primitives/BufferedNumberField";
import { Checkbox } from "../../primitives/Checkbox";
import { Select } from "../../primitives";
import type { StatsTestsState } from "./useStatsTests";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <label className="qzk-field-lbl">{label}</label>
      {children}
    </div>
  );
}

const row = { display: "flex", gap: 10, marginTop: 8, alignItems: "flex-end", flexWrap: "wrap" } as const;
const opt = (pairs: [string, string][]) => pairs.map(([value, label]) => ({ value, label }));

export default function SpcInputs({ t }: { t: StatsTestsState }) {
  const p = t.params.spc;
  const set = (patch: Partial<SpcParams>) => t.setParams({ spc: { ...p, ...patch } });
  const cols = t.columns.map((c) => ({ value: String(c.index), label: c.label }));
  const isChart = t.testId === "control-chart";
  const attribute = isChart && (p.chart === "p" || p.chart === "np" || p.chart === "u" || p.chart === "c");
  const grouped = spcUsesSubgroups(t.testId, p);
  const memory = isChart && SPC_MEMORY_CHARTS.has(p.chart);
  const ruleBox = (r: { id: SpcRuleId; label: string }) => (
    <Checkbox key={r.id} checked={p.rules[r.id]} onChange={() => set({ rules: { ...p.rules, [r.id]: !p.rules[r.id] } })}>
      {r.label}
    </Checkbox>
  );
  const pickCol = (label: string, value: number, onPick: (i: number) => void) => (
    <Field label={label}>
      <Select aria-label={label} options={cols} value={String(value)} onChange={(e) => onPick(Number(e.target.value))} />
    </Field>
  );
  const num = (label: string, value: number | null, onValue: (v: number | undefined) => void, width = 80) => (
    <Field label={label}>
      <BufferedNumberField aria-label={label} value={value ?? undefined} width={width} onValue={onValue} />
    </Field>
  );

  return (
    <>
      <div style={row}>
        {isChart && (
          <Field label="Chart">
            <Select aria-label="Chart" options={SPC_CHARTS.map((c) => ({ value: c.id, label: c.label }))} value={p.chart}
              onChange={(e) => set({ chart: e.target.value as SpcParams["chart"] })} />
          </Field>
        )}
        {pickCol(attribute ? "Counts" : "Measurement", t.sel.x, (x) => t.setSel({ x }))}
        {spcUsesSizeColumn(t.testId, p) && pickCol("Sample size column", t.sel.y, (y) => t.setSel({ y }))}
      </div>
      {!isChart && (
        <div style={{ marginTop: 8 }}>
          <Checkbox checked={p.useSubgroups} onChange={() => set({ useSubgroups: !p.useSubgroups })}>
            Rational subgroups (else within sigma from the moving range)
          </Checkbox>
        </div>
      )}
      {grouped && (
        <div style={row}>
          <Field label="Subgroups from">
            <Select aria-label="Subgroups from" options={opt([["size", "fixed size (consecutive rows)"], ["column", "a subgroup column"]])}
              value={p.subgroupMode} onChange={(e) => set({ subgroupMode: e.target.value as SpcParams["subgroupMode"] })} />
          </Field>
          {p.subgroupMode === "size"
            ? num("Subgroup size", p.subgroupSize, (v) => v != null && set({ subgroupSize: Math.round(v) }))
            : pickCol("Subgroup column", t.sel.byCol, (byCol) => t.setSel({ byCol }))}
          {!isChart && (
            <Field label="Within sigma">
              <Select aria-label="Within sigma" options={opt([["range", "R-bar / d2"], ["sd", "S-bar / c4"]])} value={p.sigmaMethod}
                onChange={(e) => set({ sigmaMethod: e.target.value as SpcParams["sigmaMethod"] })} />
            </Field>
          )}
        </div>
      )}
      {isChart && (p.chart === "p" || p.chart === "np" || p.chart === "u") && (
        <div style={row}>
          <Field label="Sample sizes">
            <Select aria-label="Sample sizes" options={opt([["column", "from a column"], ["constant", "one constant"]])} value={p.sizeMode}
              onChange={(e) => set({ sizeMode: e.target.value as SpcParams["sizeMode"] })} />
          </Field>
          {p.sizeMode === "constant" && num("Sample size", p.sampleSize, (v) => v != null && set({ sampleSize: v }))}
        </div>
      )}
      {memory ? (
        <>
          <div style={row}>
            {p.chart === "ewma" ? (
              <>
                {num("Lambda (weight)", p.ewmaLambda, (v) => v != null && set({ ewmaLambda: v }))}
                {num("L (limit width, σ)", p.ewmaWidth, (v) => v != null && set({ ewmaWidth: v }))}
              </>
            ) : (
              <>
                {num("k (reference, σ)", p.cusumK, (v) => v != null && set({ cusumK: v }))}
                {num("h (decision interval, σ)", p.cusumH, (v) => v != null && set({ cusumH: v }))}
              </>
            )}
            {num("Target (blank: data mean)", p.chartTarget, (v) => set({ chartTarget: v ?? null }), 110)}
            {num("Sigma (blank: from MR-bar)", p.chartSigma, (v) => set({ chartSigma: v ?? null }), 110)}
          </div>
          <div className="qzk-helptext" style={{ marginTop: 6, color: "var(--text-faint)" }}>
            Defaults are provisional (owner to confirm). A blank target or sigma is estimated from this same data, which a
            real shift inflates; set both from an in-control baseline for a true monitoring chart.
          </div>
        </>
      ) : isChart ? (
        <div style={{ marginTop: 8 }}>
          <div className="qzk-field-lbl">Run rules (Western Electric)</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>{SPC_RULES.map(ruleBox)}</div>
          {p.rules.we4 && <div style={row}>{num("Run length", p.runLength, (v) => v != null && v >= 2 && set({ runLength: Math.round(v) }))}</div>}
          <div className="qzk-field-lbl" style={{ marginTop: 6 }}>Run rules (Nelson-style, off by default)</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>{SPC_NELSON_RULES.map(ruleBox)}</div>
        </div>
      ) : (
        <div style={row}>
          {num("LSL", p.lsl, (v) => set({ lsl: v ?? null }))}
          {num("USL", p.usl, (v) => set({ usl: v ?? null }))}
          {num("Target (optional)", p.target, (v) => set({ target: v ?? null }), 96)}
        </div>
      )}
    </>
  );
}
