// Peaks workshop — one value cell of the fitted-peak table, with its standard
// error when the durable table carries errors (audit P2.1: only a table the
// Peak analyzer's model fit published does — lib/peakTable.ts's header). A
// legacy table (the Peaks workshop's own fits, which measure no errors)
// renders the bare value exactly as before, never a column of "± —".
//
// A null error on a model-fit row is "± —" whose tooltip is the saved reason
// (fixed / tied / on a bound / undetermined / edited by hand) — the same
// dash-with-a-reason the Peak analyzer's results table shows.

import { fmtNum } from "../../../lib/format";
import { valueErrCells } from "../../../lib/valueErrCells";
import { ERR_COLUMNS, type PeakErrField, type PeakTableEntry } from "../../../lib/peakTable";

const faint = { color: "var(--text-faint)" } as const;

interface Props {
  value: number;
  field: PeakErrField;
  /** The durable row, when the table carries errors; omitted = bare value. */
  entry?: PeakTableEntry;
}

export default function PeakValueCell({ value, field, entry }: Props) {
  if (!entry) return <>{fmtNum(value)}</>;
  const err = entry[ERR_COLUMNS[field]] ?? null;
  // Curve Fit's value ± error rounding, as every peak table (lib/valueErrCells).
  const c = valueErrCells(value, err);
  if (c.inline !== null) return <span style={{ whiteSpace: "nowrap" }}>{c.inline}</span>;
  return (
    <span style={{ whiteSpace: "nowrap" }}>
      {c.value}{" "}
      {c.error !== null ? (
        <span style={faint}>± {c.error}</span>
      ) : (
        <span style={faint} title={entry.errReasons?.[field] ?? "no error reported"} data-no-error="">
          ± —
        </span>
      )}
    </span>
  );
}
