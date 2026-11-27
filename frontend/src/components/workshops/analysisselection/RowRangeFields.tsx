import { useEffect, useState } from "react";

import { rowRangeLabel, type RowRange } from "../../../lib/rowRange";

interface Props {
  range: RowRange | null | undefined;
  /** Rows in the worksheet, for the hint. */
  rows: number;
  onChange: (range: RowRange | null) => void;
}

const asText = (range: RowRange | null | undefined, end: "from" | "to"): string =>
  range && range.was === undefined ? String(range[end] + 1) : "";

/** "Rows from / to" (1-based, source rows) of the shared analysis input. Both
 *  blank = every row. An entry that is not a valid window is NOT applied, and
 *  the line says so (the previous window stays in force, visibly). */
export default function RowRangeFields({ range, rows, onChange }: Props) {
  const [from, setFrom] = useState(asText(range, "from"));
  const [to, setTo] = useState(asText(range, "to"));
  // A row insert or delete moves the window: show where it is now.
  useEffect(() => {
    setFrom(asText(range, "from"));
    setTo(asText(range, "to"));
  }, [range?.from, range?.to, range?.was]); // eslint-disable-line react-hooks/exhaustive-deps
  const apply = (nextFrom: string, nextTo: string): void => {
    setFrom(nextFrom);
    setTo(nextTo);
    if (nextFrom.trim() === "" && nextTo.trim() === "") return onChange(null);
    const a = Number(nextFrom);
    const b = Number(nextTo);
    if (nextFrom.trim() !== "" && nextTo.trim() !== "" && Number.isInteger(a) && Number.isInteger(b) && a >= 1 && b >= a && b <= rows) {
      onChange({ from: a - 1, to: b - 1 });
    }
  };
  const pending = from.trim() !== "" || to.trim() !== "";
  const typed = pending && Number.isInteger(Number(from)) && Number.isInteger(Number(to)) ? { from: Number(from) - 1, to: Number(to) - 1 } : null;
  const applied = range && range.was === undefined ? range : null;
  const mismatch = pending && (!applied || !typed || typed.from !== applied.from || typed.to !== applied.to);
  return (
    <div className="qzk-row-range">
      <label>Rows from
        <input className="qz-input" type="number" min={1} max={rows} value={from} placeholder="first" onChange={(event) => apply(event.target.value, to)} />
      </label>
      <label>to
        <input className="qz-input" type="number" min={1} max={rows} value={to} placeholder="last" onChange={(event) => apply(from, event.target.value)} />
      </label>
      {mismatch && <p className="qzk-analysis-input-issue warning">Not applied: enter both rows (1 to {rows.toLocaleString()}), from at most to.{applied ? ` Still using ${rowRangeLabel(applied)}.` : ""}</p>}
    </div>
  );
}
