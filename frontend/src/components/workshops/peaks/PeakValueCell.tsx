// Peaks workshop — one value cell of the fitted-peak table, with its standard
// error when the durable table carries errors (audit P2.1: only a table the
// Peak Analyzer's model fit published does — lib/peakTable.ts's header). A
// legacy table (the Peaks workshop's own fits, which measure no errors)
// renders the bare value exactly as before, never a column of "± —".
//
// A null error on a model-fit row is "± —" whose tooltip is the saved reason
// (fixed / tied / on a bound / undetermined / edited by hand) — the same
// dash-with-a-reason the Peak Analyzer's results table shows.

import { fmtNum } from "../../../lib/format";
import type { PeakErrField, PeakTableEntry } from "../../../lib/peakTable";

const ERR_KEY = { center: "centerErr", fwhm: "fwhmErr", height: "heightErr", area: "areaErr" } as const;
const faint = { color: "var(--text-faint)" } as const;

interface Props {
  value: number;
  field: PeakErrField;
  /** The durable row, when the table carries errors; omitted = bare value. */
  entry?: PeakTableEntry;
}

export default function PeakValueCell({ value, field, entry }: Props) {
  if (!entry) return <>{fmtNum(value)}</>;
  const err = entry[ERR_KEY[field]] ?? null;
  return (
    <span style={{ whiteSpace: "nowrap" }}>
      {fmtNum(value)}{" "}
      {err !== null ? (
        <span style={faint}>± {fmtNum(err)}</span>
      ) : (
        <span style={faint} title={entry.errReasons?.[field] ?? "no error reported"} data-no-error="">
          ± —
        </span>
      )}
    </span>
  );
}
