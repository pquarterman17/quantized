// The Analysis guide's technique section (WORKSPACE_LAYOUT_PLAN P4): what the
// dataset is, where that came from (the import, the user's choice, or nothing
// recorded), suggestions when nothing is recorded, and the override, saved on
// the dataset (store/analysisWindowActions setTechniqueOverride). Picking a
// suggestion is the same as choosing it in the menu: nothing is applied unasked.

import { useId } from "react";

import { effectiveTechnique, TECHNIQUE_CHOICES, techniqueOverrideOf, techniqueSuggestions } from "../../../lib/windowLayout/analysisGuide";
import { techniqueOf } from "../../../lib/techniqueDefaults";
import { TECHNIQUE_WORKFLOWS } from "../../../lib/techniqueWorkflow";
import type { Dataset, Technique } from "../../../lib/types";
import { setTechniqueOverride } from "../../../store/analysisWindowActions";
import type { AnalysisHost } from "./analysisHost";

const SOURCE = { import: "recorded at import", override: "your choice, saved on the dataset", none: "not identified" } as const;

export default function AnalysisTechnique({ dataset, host }: { dataset: Dataset; host: AnalysisHost }) {
  const headingId = useId();
  const selectId = useId();
  const eff = effectiveTechnique(dataset);
  const workflow = TECHNIQUE_WORKFLOWS[eff.technique];
  const recorded = TECHNIQUE_WORKFLOWS[techniqueOf(dataset)].label;
  const override = techniqueOverrideOf(dataset);
  const suggestions = eff.source === "none" ? techniqueSuggestions(dataset) : [];
  const choose = (technique: Technique | null) => host.announce(setTechniqueOverride(dataset.id, technique));
  return (
    <section className="qzk-wl-an-section" aria-labelledby={headingId}>
      <h3 id={headingId} className="qzk-wl-an-heading">
        Technique
      </h3>
      <p className="qzk-wl-an-technique">
        <strong>{workflow.label}</strong> <span className="qzk-wl-an-dim">({SOURCE[eff.source]})</span>
      </p>
      <p className="qzk-wl-an-dim">{workflow.summary}</p>
      {suggestions.length > 0 && (
        <div className="qzk-wl-an-suggest" role="group" aria-label="Suggested techniques">
          <span className="qzk-wl-an-dim">Looks like:</span>
          {suggestions.map((s) => (
            <button
              key={s.technique}
              type="button"
              className="qzk-wl-pill"
              title={`A guess from the columns: ${s.reason}; press to use it for this guide.`}
              onClick={() => choose(s.technique)}
            >
              {TECHNIQUE_WORKFLOWS[s.technique].label}
            </button>
          ))}
        </div>
      )}
      <label className="qzk-wl-an-override" htmlFor={selectId}>
        Treat as
      </label>{" "}
      <select
        id={selectId}
        className="qz-select"
        value={override ?? ""}
        title="Choose the technique this guide uses; it is saved on the dataset and changes nothing else."
        // A lazy preview loads its full data first, then saves (said out loud).
        onChange={(e) => choose((e.target.value || null) as Technique | null)}
      >
        <option value="">As recorded ({recorded})</option>
        {TECHNIQUE_CHOICES.filter((c) => c.technique !== "generic").map((c) => (
          <option key={c.technique} value={c.technique}>
            {c.label}
          </option>
        ))}
      </select>
    </section>
  );
}
