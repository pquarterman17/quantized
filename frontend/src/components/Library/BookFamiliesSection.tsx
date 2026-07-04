// Library sidebar section (plan item 17): a lightweight bulk-manage affordance
// for multi-book Origin imports. `useApp.importFiles` fans an Origin project
// out into one dataset per workbook (named "<stem>:<Book>"); this surfaces
// each such family with a "Manage…" action so the user can prune books they
// don't need without hunting them down individually in the flat list. Never
// interrupts the import itself — this only appears afterward, in the Library.

import { useState } from "react";

import { originBookFamilies } from "../../lib/grouping";
import type { Dataset } from "../../lib/types";
import { askParams, type ParamField } from "../overlays/ParamDialog";
import { useApp } from "../../store/useApp";

export default function BookFamiliesSection() {
  const datasets = useApp((s) => s.datasets);
  const removeDatasets = useApp((s) => s.removeDatasets);
  const [collapsed, setCollapsed] = useState(false);

  const families = originBookFamilies(datasets);
  if (families.length === 0) return null;

  const manage = async (stem: string, members: Dataset[]) => {
    const fields: ParamField[] = members.map((d) => ({
      key: d.id,
      label: d.name,
      type: "boolean",
      default: true,
    }));
    const picked = await askParams(`Manage "${stem}" books`, fields);
    if (!picked) return;
    const drop = members.filter((d) => picked[d.id] === false).map((d) => d.id);
    if (drop.length) removeDatasets(drop);
  };

  return (
    <div className="qzk-lib-group">
      <button className="qzk-group-head" onClick={() => setCollapsed((c) => !c)}>
        <span className="qzk-group-caret">{collapsed ? "▸" : "▾"}</span>
        <span className="qzk-group-name">Book families</span>
        <span className="qzk-group-count">{families.length}</span>
      </button>
      {!collapsed &&
        families.map((f) => (
          <div key={f.stem} className="qzk-fam-row">
            <span
              className="qzk-fam-name"
              title={`${f.members.length} books imported from ${f.stem}`}
            >
              {f.stem}
            </span>
            <span className="qzk-fam-count">{f.members.length} books</span>
            <button className="qz-btn qz-sm" onClick={() => void manage(f.stem, f.members)}>
              Manage…
            </button>
          </div>
        ))}
    </div>
  );
}
