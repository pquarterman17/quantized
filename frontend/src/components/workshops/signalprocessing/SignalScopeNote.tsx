import { droppedRows } from "../../../lib/rowstate";
import type { Dataset } from "../../../lib/types";
import { fmtInt } from "../../../lib/locale";

interface Props {
  source: Dataset;
  secondary: Dataset | null;
  /** The single run's row choice (true = every worksheet row, the default). */
  useAllRows?: boolean;
  /** signalRangeNote(): how many input rows the optional X range keeps ("" = none set). */
  rangeNote?: string;
}

export default function SignalScopeNote({ source, secondary, useAllRows = true, rangeNote = "" }: Props) {
  if (secondary) {
    const sourceRows = source.data.time.length;
    const sourceDropped = droppedRows(source).size;
    const secondaryRows = secondary.data.time.length;
    const secondaryDropped = droppedRows(secondary).size;
    return (
      <div className="qz-signal-note">
        Inputs: <strong>{source.name}</strong> ({fmtInt(sourceRows)} rows; {fmtInt(sourceDropped)} excluded or filtered) and <strong>{secondary.name}</strong> ({fmtInt(secondaryRows)} rows; {fmtInt(secondaryDropped)} excluded or filtered). Correlation uses finite rows in their shared X range; {useAllRows ? "row exclusions and filters do not remove rows" : "excluded and filtered rows are left out of both"}. Both sources remain linked for recalculation.
      </div>
    );
  }
  // The single-source rows and policy are on the shared input line
  // (SignalInputSummary); only the recalculation link is said here.
  return (
    <div className="qz-signal-note">
      The output stays linked to <strong>{source.name}</strong> and can be recalculated.
      {rangeNote && <> {rangeNote}</>}
    </div>
  );
}
