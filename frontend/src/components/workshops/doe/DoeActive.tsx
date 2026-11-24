// The active worksheet as a design (GAP_AUDIT_9 J16): what it is, its alias
// structure and resolution, and the two ways on: "Analyze design" opens Fit
// Model with the design's model (the response and the design's terms on the
// coded columns), and, for two-level designs, the effects view below.

import { useMemo } from "react";

import { designTitle, doeFitRecipe, doeMeta, filledResponses, isTwoLevel, plainTerm } from "../../../lib/doe";
import { useFitModelStore } from "../../../store/fitModel";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { Button } from "../../primitives";
import DoeEffects from "./DoeEffects";

const hint = { color: "var(--text-faint)" } as const;
const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII"];

export default function DoeActive() {
  const active = useActiveDataset();
  const setStatus = useApp((s) => s.setStatus);
  const meta = useMemo(() => doeMeta(active?.data), [active?.data]);
  if (!active || !meta) {
    return (
      <div className="qzk-ds-meta" style={{ ...hint, marginTop: 12 }}>
        Select a generated design worksheet to fill in its responses and analyze it.
      </div>
    );
  }
  const filled = filledResponses(active.data);
  const recipe = doeFitRecipe(active.data);
  const analyze = () => {
    const r = doeFitRecipe(active.data);
    if (!r) {
      setStatus("a design column was renamed or removed: cannot rebuild the design's model");
      return;
    }
    useFitModelStore.getState().openWith(r);
  };
  const aliased = meta.aliases.filter((c) => c.length > 1);
  const ready = filled > 0; // Fit Model states its own refusal (error df, rank) for a partial fill
  return (
    <div style={{ marginTop: 14, borderTop: "1px solid var(--border-soft)", paddingTop: 10 }}>
      <div style={{ fontWeight: 600 }}>{designTitle(meta)}: {meta.runs} runs</div>
      <div className="qzk-ds-meta" style={hint}>
        {meta.randomized ? `randomised run order (seed ${meta.seed})` : "standard run order"}
        {meta.resolution ? `, resolution ${ROMAN[meta.resolution] ?? meta.resolution}` : ""}
        {meta.alpha !== null ? `, alpha ${meta.alpha.toPrecision(4)}` : ""}
        {`, ${meta.center_points} centre point${meta.center_points === 1 ? "" : "s"}`}
      </div>
      {meta.generators.length > 0 && (
        <div className="qzk-ds-meta" style={{ marginTop: 4 }}>
          Generators: {meta.generators.join(", ")}<br />Defining relation: {meta.defining_relation}
        </div>
      )}
      {meta.notes.map((n) => <div key={n} className="qzk-ds-meta" style={hint}>{n}</div>)}
      {meta.kind === "fractional_factorial" && (
        <details style={{ marginTop: 6 }}>
          <summary className="qzk-ds-meta">Alias structure ({aliased.length} aliased sets, effects up to two-factor)</summary>
          <div role="table" aria-label="Alias structure" className="qzk-ds-meta" style={{ fontFamily: "var(--font-mono)", maxHeight: 150, overflowY: "auto" }}>
            {meta.aliases.map((c, i) => <div key={i} role="row">{c.join(" = ")}</div>)}
            <div style={hint}>Letters: {meta.factors.map((f) => `${f.letter} = ${f.name}`).join(", ")}</div>
          </div>
        </details>
      )}
      <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Button size="sm" disabled={!recipe || !ready} onClick={analyze}
          title={`Fit Model with ${meta.model === "quadratic" ? "the full quadratic" : meta.model === "main" ? "main effects" : "main effects and two-factor interactions"} on the coded columns`}>
          Analyze design
        </Button>
        <span className="qzk-ds-meta" style={hint}>
          {!recipe ? "A design column was renamed or removed."
            : !ready ? `Fill in "${meta.response_label}" for the runs (${filled} of ${meta.runs} filled).`
              : `Model: ${meta.terms.map((t) => plainTerm(t.join("*"))).join(", ")}`}
        </span>
      </div>
      {meta.error_df < 1 && (
        <div className="qzk-ds-meta" style={{ ...hint, marginTop: 4 }}>
          This design is saturated for its model (no error degrees of freedom): Fit Model cannot test the effects; use the effects plot below.
        </div>
      )}
      {isTwoLevel(meta) && <DoeEffects data={active.data} />}
    </div>
  );
}
