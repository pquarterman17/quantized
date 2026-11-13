// Curve Fit — "Templates" section (lazy chunk). Save the panel's current
// fit settings (model, weighting, start/bounds/hold table, X range) as a
// named template, and apply a saved one to whatever dataset the panel is on.
// Storage and sanitizing live in lib/fitTemplates.ts (an analysis template
// with one fit step, so it is carried in the project file like every other
// recipe). Applying only LOADS the settings — the user still presses Fit —
// and nothing ever applies a template on its own. A saved template can be
// deleted here too (confirmed), so the list never only grows.

import { useEffect, useState } from "react";

import { fitTemplateOf, toFitTemplate, type FitTemplateSettings } from "../../../lib/fitTemplates";
import { deleteTemplate, loadTemplates, saveTemplate, TEMPLATES_CHANGED_EVENT, type AnalysisTemplate } from "../../../lib/template";
import { askConfirm } from "../../../store/confirmDialog";
import { useApp } from "../../../store/useApp";
import { Button, Select } from "../../primitives";

interface Props {
  /** The settings to save, as the panel holds them now. */
  current: FitTemplateSettings;
  /** Load the settings into the panel; false when they cannot apply here. */
  apply: (settings: FitTemplateSettings) => boolean;
}

function fitTemplates(): { name: string; settings: FitTemplateSettings }[] {
  return loadTemplates().flatMap((t: AnalysisTemplate) => {
    const settings = fitTemplateOf(t);
    return settings ? [{ name: t.name, settings }] : [];
  });
}

export default function FitTemplatesSection({ current, apply }: Props) {
  const setStatus = useApp((s) => s.setStatus);
  const [list, setList] = useState(fitTemplates);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState("");

  useEffect(() => {
    const reread = () => setList(fitTemplates());
    window.addEventListener(TEMPLATES_CHANGED_EVENT, reread);
    return () => window.removeEventListener(TEMPLATES_CHANGED_EVENT, reread);
  }, []);
  const chosen = list.find((t) => t.name === picked) ?? null;

  const save = async () => {
    const n = name.trim();
    if (!n) return;
    const clash = loadTemplates().some((t) => t.name === n);
    if (clash && !(await askConfirm(`Replace the template "${n}"?`, "A template with this name already exists.", "Replace", true))) return;
    try {
      saveTemplate(toFitTemplate(n, current));
      setList(fitTemplates());
      setPicked(n);
      setName("");
      setStatus(`saved fit template "${n}"`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "could not save the template");
    }
  };

  const remove = async () => {
    if (!chosen) return;
    const ok = await askConfirm(
      `Delete the fit template "${chosen.name}"?`,
      "It is removed from this computer's template library. Fits already run with it are not changed.",
      "Delete template",
      true,
    );
    if (!ok) return;
    deleteTemplate(chosen.name);
    setList(fitTemplates());
    setPicked("");
    setStatus(`deleted fit template "${chosen.name}"`);
  };

  return (
    <details style={{ marginTop: 10 }}>
      <summary className="qzk-field-lbl">Templates</summary>
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
        <input
          className="qz-input"
          value={name}
          placeholder="template name"
          aria-label="New fit template name"
          maxLength={64}
          onChange={(e) => setName(e.target.value)}
        />
        <Button size="sm" disabled={!name.trim()} onClick={() => void save()} title="Save the model, weighting, start values/bounds/holds and X range">
          Save as template
        </Button>
      </div>
      {list.length > 0 ? (
        <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
          <Select
            aria-label="Saved fit template"
            options={[{ value: "", label: "Choose a template…" }, ...list.map((t) => ({ value: t.name, label: `${t.name} — ${t.settings.model}` }))]}
            value={picked}
            onChange={(e) => setPicked(e.target.value)}
          />
          <Button
            size="sm"
            disabled={!chosen}
            title="Load this template's settings into the panel (then press Fit)"
            onClick={() => {
              if (!chosen || !apply(chosen.settings)) return;
              setStatus(`applied fit template "${chosen.name}" — press Fit to run it`);
            }}
          >
            Apply template
          </Button>
          <Button size="sm" variant="ghost" disabled={!chosen} title="Delete this saved template" onClick={() => void remove()}>
            Delete template
          </Button>
        </div>
      ) : (
        <div className="qzk-ds-meta" style={{ marginTop: 6, color: "var(--text-faint)" }}>
          No fit templates yet.
        </div>
      )}
    </details>
  );
}
