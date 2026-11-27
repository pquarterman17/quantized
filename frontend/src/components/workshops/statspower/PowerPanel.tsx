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
import { describe, hasAlternative, isProp, reportText, TESTS, type PowerForm } from "./powerModel";
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
const EFFECT_LABEL: Partial<Record<PowerForm["test"], string>> = {
  anova: "Effect size f", variance: "Variance ratio", "chi-square": "Effect size w", correlation: "Correlation r",
};
const N_LABEL: Partial<Record<PowerForm["test"], string>> = {
  "t-paired": "Pairs n", anova: "n per group", "chi-square": "Total n", correlation: "Pairs n", "prop-exact": "n",
};

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
      {f.test === "prop-exact" && (
        <div className="qzk-helptext" style={{ marginTop: 6, color: "var(--text-faint)" }}>
          The exact test is discrete, so its power is not monotone in n: a larger n can have less power. Sample-size and detectable-effect answers are for the n they state.
        </div>
      )}
      <div style={row}>
        {f.solve !== "n" && num(N_LABEL[f.test] ?? "n (first group)", "n")}
        {f.solve !== "power" && num("Target power", "power")}
        {num("Alpha", "alpha")}
        <Field label="Alternative">
          {hasAlternative(f.test) ? (
            <Select aria-label="Alternative" options={[{ value: "2", label: "two-sided" }, { value: "1", label: "one-sided" }]} value={String(f.tails)} onChange={(e) => p.set({ tails: e.target.value === "1" ? 1 : 2 })} />
          ) : (
            <Select aria-label="Alternative" disabled title="This test rejects in the upper tail only: there is no two-sided version." options={[{ value: "upper", label: "upper tail only" }]} value="upper" />
          )}
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
        {f.test === "chi-square" && num("Degrees of freedom", "df")}
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
