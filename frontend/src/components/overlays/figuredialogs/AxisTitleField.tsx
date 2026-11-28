// An axis title field: the rich-text label input (`$...$` sub/superscripts,
// the symbol palette) as a plain value / onChange control. Self-contained on
// purpose: the Axis dialog mounts it over its draft, and a docked panel card
// could mount the same field over the live setters (plan item 50, E11).

import RichLabelInput from "../../primitives/RichLabelInput";

export default function AxisTitleField({ value, onChange, axisName }: { value: string; onChange: (v: string) => void; axisName: string }) {
  return (
    <div className="qzk-field-lbl" style={{ display: "grid", gridTemplateColumns: "130px 1fr", alignItems: "start", gap: 8 }}>
      <span style={{ paddingTop: 4 }}>Title</span>
      {/* live: every keystroke goes to the draft (not the plot), so Apply never races a blur. */}
      <RichLabelInput live value={value} name={`${axisName} title`} placeholder="auto" onCommit={onChange} />
    </div>
  );
}
