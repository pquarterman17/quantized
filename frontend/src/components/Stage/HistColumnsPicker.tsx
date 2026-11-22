// "+ columns" for the Stat Stage histogram: the other columns to bin in the
// same graph as the value column (one translucent bar set each, shared bin
// edges; Origin's multi-column histogram). A fit applies to one column only.
import { Checkbox } from "../primitives/Checkbox";
import type { StatColumn } from "./useStatStageTypes";

export default function HistColumnsPicker({
  columns,
  valueCol,
  picked,
  onChange,
}: {
  columns: readonly StatColumn[];
  valueCol: number;
  picked: readonly number[];
  onChange: (cols: number[]) => void;
}) {
  const others = columns.filter((c) => c.index !== valueCol);
  if (!others.length) return null;
  const toggle = (index: number, on: boolean) =>
    onChange(on ? [...picked, index] : picked.filter((c) => c !== index));
  return (
    <details style={{ fontSize: 11, position: "relative" }}>
      <summary title="Bin more columns in this graph (shared bins)">
        {picked.length ? `+ ${picked.length} column${picked.length > 1 ? "s" : ""}` : "+ columns"}
      </summary>
      <div className="qzk-popover" style={{ position: "absolute", zIndex: 5, padding: 6, maxHeight: 220, overflow: "auto" }}>
        {others.map((c) => (
          <Checkbox key={c.index} checked={picked.includes(c.index)} onChange={(on) => toggle(c.index, on)}>
            {c.label}
          </Checkbox>
        ))}
      </div>
    </details>
  );
}
