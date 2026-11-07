// Calculators ▸ X-ray / Neutron tab — composition cards: MATLAB DiraCulator
// buildXrayNeutronTab Cards 5–6 (weight% ↔ atomic% and the co-deposition flux
// ratio → calc.composition). Self-contained: each card owns its inputs and its
// `useCard`. Defaults are the MATLAB card defaults.

import { useState } from "react";

import { atomicToWeight, coDeposition, weightToAtomic, type PercentResult } from "../../../lib/api/composition";
import { Button, Card, Field, ROW, dual, resultLine, useCard, withTouch, type CardSuccess } from "./shared";

/** Whitespace/comma separated tokens ("Fe Ni", "Sr, TiO2"). */
function tokens(text: string): string[] {
  return text
    .trim()
    .split(/[\s,]+/)
    .filter((t) => t.length > 0);
}

/** "Fe: 69.9 wt% · Ni: 30.1 wt%" with full-precision copy values. */
function percentLine(elements: string[], values: number[], unit: string): CardSuccess {
  return elements.reduce<CardSuccess>(
    (acc, el, i) => {
      const part = dual`${el}: ${values[i]} ${unit}`;
      if (i === 0) return part;
      return { text: `${acc.text} · ${part.text}`, copyValue: `${acc.copyValue} · ${part.copyValue}` };
    },
    { text: "", copyValue: "" },
  );
}

/** Card 5 — weight% ↔ atomic% (inputs need not sum to 100). */
export function WeightAtomicCard() {
  const [elements, setElements] = useState("Fe Ni");
  const [values, setValues] = useState("70 30");
  const card = useCard("Composition");

  const convert = (direction: "wt-to-at" | "at-to-wt"): void => {
    const label = direction === "wt-to-at" ? "wt% → at%" : "at% → wt%";
    void card.run(label, `elements=${elements}, values=${values} %`, async () => {
      const els = tokens(elements);
      const vals = tokens(values).map(Number);
      if (vals.some((v) => !Number.isFinite(v))) throw new Error("enter numeric percentages, e.g. 70 30");
      const r: PercentResult =
        direction === "wt-to-at" ? await weightToAtomic(els, vals) : await atomicToWeight(els, vals);
      return direction === "wt-to-at"
        ? percentLine(r.elements, r.atomic_pct, "at%")
        : percentLine(r.elements, r.weight_pct, "wt%");
    });
  };

  return (
    <Card title="Weight % / atomic % conversion">
      <div style={ROW}>
        <Field
          label="elements"
          value={elements}
          onChange={withTouch(card.touch, setElements)}
          numeric={false}
          width={112}
        />
        <Field
          label="values"
          ariaLabel="percentages"
          value={values}
          onChange={withTouch(card.touch, setValues)}
          numeric={false}
          unit="%"
          width={96}
        />
        <Button variant="primary" size="sm" onClick={() => convert("wt-to-at")}>
          wt% → at%
        </Button>
        <Button variant="primary" size="sm" onClick={() => convert("at-to-wt")}>
          at% → wt%
        </Button>
      </div>
      <div className="qzk-ds-meta" style={{ marginTop: 6 }}>
        Space-separated symbols and values in the same order; values are normalised to 100.
      </div>
      {resultLine(card.result)}
    </Card>
  );
}

/** Card 6 — relative source fluxes to co-deposit a target film. */
export function CoDepositionCard() {
  const [formula, setFormula] = useState("SrTiO3");
  const [sources, setSources] = useState("Sr TiO2");
  const card = useCard("Composition");

  return (
    <Card title="Co-deposition flux ratio">
      <div style={ROW}>
        <Field
          label="target"
          ariaLabel="target formula"
          value={formula}
          onChange={withTouch(card.touch, setFormula)}
          numeric={false}
          width={128}
        />
        <Field
          label="sources"
          ariaLabel="source formulas"
          value={sources}
          onChange={withTouch(card.touch, setSources)}
          numeric={false}
          width={128}
        />
        <Button
          variant="primary"
          size="sm"
          onClick={() =>
            void card.run("Co-deposition flux ratio", `target=${formula}, sources=${sources}`, async () => {
              const r = await coDeposition(formula.trim(), tokens(sources));
              // "Sr : TiO2 = 1 : 1" — sources and ratios in the same order.
              const ratios = r.ratios.reduce<CardSuccess>(
                (acc, ratio, i) => {
                  const part = dual`${ratio}`;
                  if (i === 0) return part;
                  return { text: `${acc.text} : ${part.text}`, copyValue: `${acc.copyValue} : ${part.copyValue}` };
                },
                { text: "", copyValue: "" },
              );
              const names = r.sources.join(" : ");
              const note = r.warnings.length > 0 ? ` ⚠ ${r.warnings.join("; ")}` : "";
              return {
                text: `${names} = ${ratios.text}${note}`,
                copyValue: `${names} = ${ratios.copyValue}${note}`,
              };
            })
          }
        >
          Calculate
        </Button>
      </div>
      <div className="qzk-ds-meta" style={{ marginTop: 6 }}>
        Molar flux ratios, smallest = 1. Each source is matched to its first non-oxygen element found in
        the target.
      </div>
      {resultLine(card.result)}
    </Card>
  );
}
