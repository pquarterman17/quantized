// Inspector control: a chart title + custom x/y axis labels for publication-ready
// figures. Blank reverts to the auto label derived from the data. Commits on
// blur / Enter (so typing isn't reformatted mid-edit); applied in uplotOpts.
// Labels support the rich-text micro-syntax (GOTO #5): `$...$` math regions
// with sub/superscript, Greek, italics — the Ω button opens the symbol
// palette and a live preview renders under the field while markup is present.

import { useApp } from "../../store/useApp";
import { Card, RichLabelInput } from "../primitives";

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
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 6, marginTop: 6 }}>
      <span className="qzk-field-lbl" style={{ margin: 0, width: 48, paddingTop: 4 }}>
        {label}
      </span>
      <RichLabelInput value={value} placeholder={placeholder} onCommit={onCommit} />
    </div>
  );
}

export default function TitlesCard() {
  const plotTitle = useApp((s) => s.plotTitle);
  const xAxisLabel = useApp((s) => s.xAxisLabel);
  const yAxisLabel = useApp((s) => s.yAxisLabel);
  const y2AxisLabel = useApp((s) => s.y2AxisLabel);
  const y2Keys = useApp((s) => s.y2Keys);
  const setPlotTitle = useApp((s) => s.setPlotTitle);
  const setXAxisLabel = useApp((s) => s.setXAxisLabel);
  const setYAxisLabel = useApp((s) => s.setYAxisLabel);
  const setY2AxisLabel = useApp((s) => s.setY2AxisLabel);

  return (
    <Card title="Titles & labels" defaultOpen={false}>
      <LabelRow label="Title" placeholder="(none)" value={plotTitle} onCommit={setPlotTitle} />
      <LabelRow label="X label" placeholder="auto" value={xAxisLabel} onCommit={setXAxisLabel} />
      <LabelRow label="Y label" placeholder="auto" value={yAxisLabel} onCommit={setYAxisLabel} />
      {y2Keys && y2Keys.length > 0 && (
        <LabelRow label="Y2 label" placeholder="auto" value={y2AxisLabel} onCommit={setY2AxisLabel} />
      )}
    </Card>
  );
}
