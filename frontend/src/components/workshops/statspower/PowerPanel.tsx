// Power & sample size — view. A draggable ToolWindow: pick a test, say which of
// power / sample size / detectable effect to solve for, fill in the rest. The
// answer, the power achieved at the whole-number sizes, and a power-vs-n curve
// follow the form; "Copy report" puts the paragraph and its table on the clipboard.

import type { ReactNode } from "react";

import ToolWindow from "../../overlays/ToolWindow";
import BufferedNumberField from "../../primitives/BufferedNumberField";
import { Button, Select } from "../../primitives";
import { SegmentedControl } from "../../primitives/SegmentedControl";
import { useAnalysisExtras } from "../../../store/analysisExtras";
import { useApp } from "../../../store/useApp";
import PowerCurve from "./PowerCurve";
import { describe, isProp, reportText, TESTS, type PowerForm } from "./powerModel";
import { usePower } from "./usePower";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ flex: "1 1 90px", minWidth: 0 }}>
      <label className="qzk-field-lbl">{label}</label>
      {children}
    </div>
  );
}

const row = { display: "flex", gap: 10, marginTop: 8, flexWrap: "wrap", alignItems: "flex-end" } as const;
const EFFECT_LABEL: Partial<Record<PowerForm["test"], string>> = { anova: "Effect size f", variance: "Variance ratio" };

export default function PowerPanel() {
  const hide = useAnalysisExtras((s) => s.hide);
  const setStatus = useApp((s) => s.setStatus);
  const p = usePower();
  const f = p.form;
  const num = (label: string, key: keyof PowerForm) => (
    <Field label={label}>
      <BufferedNumberField aria-label={label} value={f[key] as number | undefined} width={72} onValue={(v) => p.set({ [key]: v } as Partial<PowerForm>)} />
    </Field>
  );
  const r = p.result;
  const copy = () => {
    if (!r) return;
    void navigator.clipboard.writeText(reportText(r)).then(
      () => setStatus("copied the power report"),
      () => setStatus("could not copy the report", "danger"),
    );
  };
  const twoGroup = f.test === "t-two-sample" || f.test === "prop-two";
  return (
    <ToolWindow id="stats-power" title="Power and sample size" width={380} onClose={() => hide("stats-power")}>
      <label className="qzk-field-lbl">Test</label>
      <Select aria-label="Test" options={TESTS.map((t) => ({ value: t.value, label: t.label }))} value={f.test} onChange={(e) => p.setTest(e.target.value as PowerForm["test"])} />
      <div style={{ marginTop: 8 }}>
        <div className="qzk-field-lbl">Solve for</div>
        <SegmentedControl
          options={[{ value: "n", label: "Sample size" }, { value: "power", label: "Power" }, { value: "effect", label: "Detectable effect" }]}
          value={f.solve}
          onChange={(solve) => p.set({ solve })}
        />
      </div>
      <div style={row}>
        {f.solve !== "n" && num(f.test === "t-paired" ? "Pairs n" : f.test === "anova" ? "n per group" : "n (first group)", "n")}
        {f.solve !== "power" && num("Target power", "power")}
        {num("Alpha", "alpha")}
        <Field label="Alternative">
          <Select aria-label="Alternative" options={[{ value: "2", label: "two-sided" }, { value: "1", label: "one-sided" }]} value={String(f.tails)} onChange={(e) => p.set({ tails: e.target.value === "1" ? 1 : 2 })} />
        </Field>
      </div>
      <div style={row}>
        {isProp(f.test) ? (
          <>
            {num(f.test === "prop-two" ? "Group 2 proportion p0" : "Null proportion p0", "p0")}
            {f.solve !== "effect" && num("Alternative p1", "p1")}
          </>
        ) : (
          f.solve !== "effect" && num(EFFECT_LABEL[f.test] ?? "Effect size d", "effect")
        )}
        {f.test === "anova" && num("Groups", "groups")}
        {twoGroup && num("Ratio n2/n1", "ratio")}
      </div>
      {p.problem && <div className="qzk-ds-meta" role="alert" style={{ marginTop: 8, color: "var(--danger)" }}>{p.problem}</div>}
      {r && !p.problem && (
        <div role="status" aria-label="Result" style={{ marginTop: 10 }}>
          <div style={{ fontSize: 13 }}>{describe(r)}</div>
          {r.notes.map((n) => <div key={n} className="qzk-helptext" style={{ marginTop: 4, color: "var(--text-faint)" }}>{n}</div>)}
          <PowerCurve result={r} />
          <Button size="sm" onClick={copy} style={{ marginTop: 6 }}>Copy report</Button>
        </div>
      )}
    </ToolWindow>
  );
}
