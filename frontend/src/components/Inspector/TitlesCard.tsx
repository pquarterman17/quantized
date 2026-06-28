// Inspector control: a chart title + custom x/y axis labels for publication-ready
// figures. Blank reverts to the auto label derived from the data. Commits on
// blur / Enter (so typing isn't reformatted mid-edit); applied in uplotOpts.

import { useEffect, useState } from "react";

import { useApp } from "../../store/useApp";
import { Card } from "../primitives";

function LabelRow({
  label,
  placeholder,
  value,
  onCommit,
}: {
  label: string;
  placeholder: string;
  value: string;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  // Mirror store → field when it changes elsewhere (e.g. a dataset switch / reset).
  useEffect(() => {
    setDraft(value);
  }, [value]);
  const commit = (): void => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
      <span className="qzk-field-lbl" style={{ margin: 0, width: 48 }}>
        {label}
      </span>
      <input
        className="qz-input"
        style={{ flex: 1, minWidth: 0 }}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setDraft(value);
        }}
      />
    </div>
  );
}

export default function TitlesCard() {
  const plotTitle = useApp((s) => s.plotTitle);
  const xAxisLabel = useApp((s) => s.xAxisLabel);
  const yAxisLabel = useApp((s) => s.yAxisLabel);
  const setPlotTitle = useApp((s) => s.setPlotTitle);
  const setXAxisLabel = useApp((s) => s.setXAxisLabel);
  const setYAxisLabel = useApp((s) => s.setYAxisLabel);

  return (
    <Card title="Titles & labels" defaultOpen={false}>
      <LabelRow label="Title" placeholder="(none)" value={plotTitle} onCommit={setPlotTitle} />
      <LabelRow label="X label" placeholder="auto" value={xAxisLabel} onCommit={setXAxisLabel} />
      <LabelRow label="Y label" placeholder="auto" value={yAxisLabel} onCommit={setYAxisLabel} />
    </Card>
  );
}
