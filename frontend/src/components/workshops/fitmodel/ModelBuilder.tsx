// Fit Model: the model builder (JMP's Fit Model launch window, "Construct
// Model Effects"). Pick the response (Y), select columns in the list, then Add
// (main effects), Cross (one interaction of the selected columns), Full
// factorial (every main effect and interaction), or Poly² (squares and
// pairwise crosses of the selected continuous columns). The effect list shows
// the model in fitting order; select effects and Remove. Each column shows its
// kind: "C" continuous, "N" nominal (categorical; from the column's modeling
// type). Center polynomials mirrors JMP's option of the same name.

import { useState } from "react";

import {
  addMainEffects, crossTerms, fullFactorial, polynomialDegree2, removeTerms, termKey,
} from "../../../lib/fitModel";
import { Button, Select } from "../../primitives";
import { Checkbox } from "../../primitives/Checkbox";
import type { FitModelState } from "./useFitModel";

const listStyle = {
  marginTop: 4, height: 132, overflowY: "auto" as const, display: "flex", flexDirection: "column" as const,
  gap: 2, border: "1px solid var(--border-soft)", borderRadius: 4, padding: 6,
};

function KindTag({ kind, text }: { kind: "continuous" | "nominal"; text: boolean }) {
  return (
    <span className="qzk-ds-meta"
      title={text ? "nominal: a text column read from the worksheet's text cells (provisional)" : kind} style={{ color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>
      {kind === "nominal" ? "N" : "C"}
    </span>
  );
}

export default function ModelBuilder({ m }: { m: FitModelState }) {
  const [picked, setPicked] = useState<number[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const candidates = m.columns.filter((c) => c.index !== m.responseCol);
  const sel = picked.filter((c) => candidates.some((x) => x.index === c));
  const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const isContinuous = (c: number) => m.kindOf(c) === "continuous";
  const apply = (next: number[][]) => { m.setTerms(next); setPicked([]); };

  return (
    <div>
      <label className="qzk-field-lbl" htmlFor="fit-model-response">Response (Y)</label>
      <Select
        id="fit-model-response"
        aria-label="Response (Y)"
        options={m.columns.filter((c) => c.index > -2).map((c) => ({ value: String(c.index), label: c.label }))}
        value={String(m.responseCol)}
        onChange={(e) => m.setResponseCol(Number(e.target.value))}
      />
      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <label className="qzk-field-lbl" style={{ margin: 0 }}>Columns ({sel.length} selected)</label>
          <div role="group" aria-label="Model columns" style={listStyle}>
            {candidates.map((c) => (
              <div key={c.index} style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
                <Checkbox checked={sel.includes(c.index)} onChange={() => setPicked((p) => toggle(p, c.index))}>
                  {c.label}
                </Checkbox>
                <KindTag kind={m.kindOf(c.index)} text={c.index <= -2} />
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, justifyContent: "center" }}>
          <Button size="sm" disabled={!sel.length} onClick={() => apply(addMainEffects(m.terms, sel))}>Add</Button>
          <Button size="sm" disabled={sel.length < 2} onClick={() => apply(crossTerms(m.terms, sel))}
            title="One interaction of all selected columns">Cross</Button>
          <Button size="sm" disabled={!sel.length} onClick={() => apply(fullFactorial(m.terms, sel))}
            title="Every main effect and interaction of the selected columns (up to 6 columns)">Full factorial</Button>
          <Button size="sm" disabled={!sel.some(isContinuous)} onClick={() => apply(polynomialDegree2(m.terms, sel, isContinuous))}
            title="Main effects, squares and pairwise crosses of the selected continuous columns">Poly²</Button>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <label className="qzk-field-lbl" style={{ margin: 0 }}>Model effects ({m.terms.length})</label>
          <div role="group" aria-label="Model effects" style={listStyle}>
            {m.terms.length === 0 && <span className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>No effects yet.</span>}
            {m.terms.map((t, i) => {
              const key = termKey(t);
              return (
                <Checkbox key={key} checked={chosen.includes(key)} onChange={() => setChosen((c) => toggle(c, key))}>
                  {m.termLabels[i]}
                </Checkbox>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <Button size="sm" disabled={!chosen.length} onClick={() => { m.setTerms(removeTerms(m.terms, chosen)); setChosen([]); }}>
              Remove
            </Button>
            <Button size="sm" disabled={!m.terms.length} onClick={() => { m.setTerms([]); setChosen([]); }}>Clear</Button>
          </div>
        </div>
      </div>
      <div style={{ marginTop: 6 }}>
        <Checkbox checked={m.center} onChange={m.setCenter}>
          Center polynomials (continuous factors in crossed and polynomial terms use their mean)
        </Checkbox>
      </div>
    </div>
  );
}
