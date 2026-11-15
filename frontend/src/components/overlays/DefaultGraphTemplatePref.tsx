// Preferences ▸ Plot row (gap audit 5 #1): the saved graph template every new
// graph opens with (lib/defaultGraphTemplate.ts), or none. A default whose
// template was deleted or renamed stays listed as "(missing)" -- it applies
// nothing (fail closed) until another is picked.

import { useState } from "react";

import { loadDefaultGraphTemplateName, setDefaultGraphTemplate } from "../../lib/defaultGraphTemplate";
import { loadGraphTemplates } from "../../lib/figuredoc";
import { Select } from "../primitives";

export function DefaultGraphTemplatePref() {
  const [names] = useState(() => loadGraphTemplates().map((t) => t.name));
  const [value, setValue] = useState(() => loadDefaultGraphTemplateName() ?? "");
  const options = [
    { value: "", label: "None (built-in look)" },
    ...names.map((n) => ({ value: n, label: n })),
    ...(value && !names.includes(value) ? [{ value, label: `${value} (missing)` }] : []),
  ];
  return (
    <div className="qzk-pref-row">
      <div className="qzk-pref-lbl">
        Default graph template
        <span className="hint">
          {names.length
            ? "new graphs open with this saved template's look; its grid and line width win over the rows above"
            : "no saved templates yet — style a graph, then Plot ▸ Set as Default for New Graphs…"}
        </span>
      </div>
      <div className="qzk-pref-ctl">
        <Select
          aria-label="Default graph template"
          options={options}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setDefaultGraphTemplate(e.target.value || null);
          }}
        />
      </div>
    </div>
  );
}
