// Statistical tests workshop — the column pickers and parameters for the
// picked test. Which pickers appear follows the test's input kind
// (lib/statsTests.InputKind); every field label is also its accessible name.

import type { ReactNode } from "react";

import type { Alternative, TestParams } from "../../../lib/statsTests";
import BufferedNumberField from "../../primitives/BufferedNumberField";
import { Checkbox } from "../../primitives/Checkbox";
import { SegmentedControl } from "../../primitives/SegmentedControl";
import { Select } from "../../primitives";
import type { StatsTestsState } from "./useStatsTests";

/** Direction wording per test: Dunnett compares each group with the control. */
function alternatives(vsControl: boolean) {
  const [lo, hi] = vsControl ? ["group < control", "group > control"] : ["first < second", "first > second"];
  return [
    { value: "two-sided", label: "two-sided" },
    { value: "less", label: `less (${lo})` },
    { value: "greater", label: `greater (${hi})` },
  ];
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <label className="qzk-field-lbl">{label}</label>
      {children}
    </div>
  );
}

const row = { display: "flex", gap: 10, marginTop: 8, alignItems: "flex-end", flexWrap: "wrap" } as const;
const faint = { color: "var(--text-faint)" } as const;

export default function StatsTestsInputs({ t }: { t: StatsTestsState }) {
  const kind = t.def.input;
  const opts = t.columns.map((c) => ({ value: String(c.index), label: c.label }));

  const pick = (label: string, value: number, onPick: (i: number) => void) => (
    <Field label={label}>
      <Select aria-label={label} options={opts} value={String(value)} onChange={(e) => onPick(Number(e.target.value))} />
    </Field>
  );

  const multi = (label: string, hint?: string) => (
    <div style={{ marginTop: 8 }}>
      <div className="qzk-field-lbl">{label}</div>
      {hint && <div className="qzk-ds-meta" style={faint}>{hint}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 140, overflowY: "auto" }}>
        {t.columns.map((c) => (
          <Checkbox key={c.index} checked={t.sel.cols.includes(c.index)} onChange={() => t.toggleCol(c.index)}>
            {c.label}
          </Checkbox>
        ))}
      </div>
    </div>
  );

  const num = (label: string, value: number | undefined, onValue: (v: number | undefined) => void) => (
    <Field label={label}>
      <BufferedNumberField aria-label={label} value={value} width={72} onValue={onValue} />
    </Field>
  );

  const setP = (patch: Partial<TestParams>) => t.setParams(patch);
  const usesAlpha = !["anderson", "partial-correlation", "stepwise"].includes(t.testId);
  // Two-sample KS stays two-sided: its one-sided forms compare CDFs, which reads backwards.
  const usesAlternative = t.testId === "sign-test" || t.testId === "dunnett";

  let pickers: ReactNode = null;
  if (kind === "none") pickers = null;
  else if (!t.active) {
    pickers = (
      <div className="qzk-ds-meta" style={{ ...faint, marginTop: 8 }}>
        Select a dataset to analyze.
      </div>
    );
  } else if (kind === "one") pickers = <div style={row}>{pick("Column", t.sel.x, (x) => t.setSel({ x }))}</div>;
  else if (kind === "two" || kind === "paired") {
    pickers = (
      <div style={row}>
        {pick("First column", t.sel.x, (x) => t.setSel({ x }))}
        {pick("Second column", t.sel.y, (y) => t.setSel({ y }))}
      </div>
    );
  } else if (kind === "groups") {
    pickers = (
      <div style={{ marginTop: 8 }}>
        <SegmentedControl
          options={[
            { value: "columns", label: "Columns as groups" },
            { value: "category", label: "Value by category" },
          ]}
          value={t.sel.groupMode}
          onChange={(groupMode) => t.setSel({ groupMode })}
        />
        {t.sel.groupMode === "columns" ? (
          multi("Groups", "The first column picked is the control.")
        ) : (
          <div style={row}>
            {pick("Value", t.sel.x, (x) => t.setSel({ x }))}
            {pick("Group by", t.sel.byCol, (byCol) => t.setSel({ byCol }))}
          </div>
        )}
      </div>
    );
  } else if (kind === "blocks") pickers = multi("Conditions", "One column per condition; each row is one sample.");
  else if (kind === "factorial") {
    pickers = (
      <div style={row}>
        {pick("Response", t.sel.x, (x) => t.setSel({ x }))}
        {pick("Factor A", t.sel.byCol, (byCol) => t.setSel({ byCol }))}
        {pick("Factor B", t.sel.byCol2, (byCol2) => t.setSel({ byCol2 }))}
      </div>
    );
  } else if (kind === "regression") {
    pickers = (
      <>
        <div style={row}>{pick("Response", t.sel.x, (x) => t.setSel({ x }))}</div>
        {multi("Predictors")}
      </>
    );
  } else pickers = multi("Columns", "Each pair is correlated holding the rest fixed.");

  return (
    <>
      {pickers}
      <div style={row}>
        {kind === "none" && (
          <>
            {num("Effect size d", t.params.effectSize, (v) => v != null && setP({ effectSize: v }))}
            {num("n (blank = solve)", t.params.n ?? undefined, (v) => setP({ n: v == null ? null : Math.round(v) }))}
            {num("Target power", t.params.power, (v) => v != null && setP({ power: v }))}
          </>
        )}
        {usesAlpha && num("alpha", t.params.alpha, (v) => v != null && v > 0 && v < 1 && setP({ alpha: v }))}
        {usesAlternative && (
          <Field label="Alternative">
            <Select
              aria-label="Alternative"
              options={alternatives(t.testId === "dunnett")}
              value={t.params.alternative}
              onChange={(e) => setP({ alternative: e.target.value as Alternative })}
            />
          </Field>
        )}
        {t.testId === "anova2-unbalanced" && (
          <Field label="Sums of squares">
            <Select
              aria-label="Sums of squares"
              options={[{ value: "3", label: "Type III" }, { value: "2", label: "Type II" }]}
              value={String(t.params.ssType)}
              onChange={(e) => setP({ ssType: e.target.value === "2" ? 2 : 3 })}
            />
          </Field>
        )}
        {t.testId === "stepwise" && (
          <>
            <Field label="Criterion">
              <Select
                aria-label="Criterion"
                options={[{ value: "aic", label: "AIC" }, { value: "bic", label: "BIC" }]}
                value={t.params.criterion}
                onChange={(e) => setP({ criterion: e.target.value as TestParams["criterion"] })}
              />
            </Field>
            <Field label="Direction">
              <Select
                aria-label="Direction"
                options={["forward", "backward", "both"].map((v) => ({ value: v, label: v }))}
                value={t.params.direction}
                onChange={(e) => setP({ direction: e.target.value as TestParams["direction"] })}
              />
            </Field>
          </>
        )}
        {kind === "none" && (
          <>
            <Field label="Design">
              <Select
                aria-label="Design"
                options={[
                  { value: "two-sample", label: "two-sample" },
                  { value: "paired", label: "paired" },
                  { value: "one-sample", label: "one-sample" },
                ]}
                value={t.params.kind}
                onChange={(e) => setP({ kind: e.target.value as TestParams["kind"] })}
              />
            </Field>
            <Field label="Tails">
              <Select
                aria-label="Tails"
                options={[{ value: "2", label: "two-sided" }, { value: "1", label: "one-sided" }]}
                value={String(t.params.tails)}
                onChange={(e) => setP({ tails: e.target.value === "1" ? 1 : 2 })}
              />
            </Field>
          </>
        )}
      </div>
    </>
  );
}
