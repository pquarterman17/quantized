// Statistical tests workshop — the settings of the GAP_AUDIT_9 G6 tests (post
// hoc / variance method, equivalence margin and design, tolerance coverage and
// confidence, proportion counts). Every field label is also its accessible name.
// Column pickers for these tests reuse StatsTestsInputs (groups / one / two).

import type { ReactNode } from "react";

import type { MoreParams } from "../../../lib/statsTestsMore";
import {
  POISSON_SAMPLES_OPTIONS, POSTHOC_OPTIONS, PROP_METHOD_OPTIONS, TI_SIDES_OPTIONS, TOST_DESIGN_OPTIONS, VARIANCE_OPTIONS,
  type OptionPair,
} from "../../../lib/statsTestsOptions";
import BufferedNumberField from "../../primitives/BufferedNumberField";
import { Select } from "../../primitives";
import type { StatsTestsState } from "./useStatsTests";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ flex: "1 1 110px", minWidth: 0 }}>
      <label className="qzk-field-lbl">{label}</label>
      {children}
    </div>
  );
}

const opt = (pairs: readonly OptionPair<string>[]) => pairs.map(([value, label]) => ({ value, label }));

export default function StatsTestsMoreInputs({ t }: { t: StatsTestsState }) {
  const m = t.params.more;
  const set = (patch: Partial<MoreParams>) => t.setParams({ more: { ...m, ...patch } });
  const num = (label: string, value: number | null, onValue: (v: number | undefined) => void, width = 72) => (
    <Field label={label}>
      <BufferedNumberField aria-label={label} value={value ?? undefined} width={width} onValue={onValue} />
    </Field>
  );
  const pick = <T extends string>(label: string, value: T, options: readonly OptionPair<T>[], onPick: (v: T) => void) => (
    <Field label={label}>
      <Select aria-label={label} options={opt(options)} value={value} onChange={(e) => onPick(e.target.value as T)} />
    </Field>
  );

  switch (t.testId) {
    case "posthoc":
      return pick("Comparison method", m.posthoc, POSTHOC_OPTIONS, (posthoc) => set({ posthoc }));
    case "variance-test":
      return pick("Variance test", m.variance, VARIANCE_OPTIONS, (variance) => set({ variance }));
    case "tost-one":
      return (
        <>
          {num("Target value", m.mu0, (v) => v != null && set({ mu0: v }))}
          {num("Equivalence margin (±)", m.margin, (v) => set({ margin: v ?? null }), 96)}
        </>
      );
    case "tost-two":
      return (
        <>
          {pick("Design", m.tostDesign, TOST_DESIGN_OPTIONS, (tostDesign) => set({ tostDesign }))}
          {num("Equivalence margin (±)", m.margin, (v) => set({ margin: v ?? null }), 96)}
        </>
      );
    case "poisson-rate":
      return (
        <>
          {pick("Samples", m.poissonSamples, POISSON_SAMPLES_OPTIONS, (poissonSamples) => set({ poissonSamples }))}
          {num(m.poissonSamples === "two" ? "Events 1" : "Events", m.pc1, (v) => set({ pc1: v ?? null }))}
          {num(m.poissonSamples === "two" ? "Exposure 1" : "Exposure", m.pt1, (v) => set({ pt1: v ?? null }), 84)}
          {m.poissonSamples === "two" ? (
            <>
              {num("Events 2", m.pc2, (v) => set({ pc2: v ?? null }))}
              {num("Exposure 2", m.pt2, (v) => set({ pt2: v ?? null }), 84)}
              {num("Hypothesized rate ratio", m.ratio0, (v) => v != null && set({ ratio0: v }), 96)}
            </>
          ) : num("Hypothesized rate", m.rate0, (v) => v != null && set({ rate0: v }), 96)}
        </>
      );
    case "tolerance-interval-np":
    case "tolerance-interval":
      return (
        <>
          {num("Coverage", m.coverage, (v) => v != null && set({ coverage: v }))}
          {num("Confidence", m.confidence, (v) => v != null && set({ confidence: v }))}
          {pick("Limits", m.tiSides, TI_SIDES_OPTIONS, (tiSides) => set({ tiSides }))}
        </>
      );
    case "binomial-test":
      return (
        <>
          {num("Successes", m.x1, (v) => set({ x1: v ?? null }))}
          {num("Trials", m.n1, (v) => set({ n1: v ?? null }))}
          {num("Hypothesized p0", m.p0, (v) => v != null && set({ p0: v }))}
          {pick("Method", m.propMethod, PROP_METHOD_OPTIONS, (propMethod) => set({ propMethod }))}
        </>
      );
    case "two-proportions":
    case "fisher-2x2":
      return (
        <>
          {num("Successes 1", m.x1, (v) => set({ x1: v ?? null }))}
          {num("Trials 1", m.n1, (v) => set({ n1: v ?? null }))}
          {num("Successes 2", m.x2, (v) => set({ x2: v ?? null }))}
          {num("Trials 2", m.n2, (v) => set({ n2: v ?? null }))}
        </>
      );
    default:
      return null;
  }
}
