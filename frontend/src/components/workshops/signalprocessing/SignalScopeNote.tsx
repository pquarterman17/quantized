import { droppedRows } from "../../../lib/rowstate";
import type { Dataset } from "../../../lib/types";

interface Props {
  source: Dataset;
  secondary: Dataset | null;
}

export default function SignalScopeNote({ source, secondary }: Props) {
  const sourceRows = source.data.time.length;
  const sourceDropped = droppedRows(source).size;
  if (secondary) {
    const secondaryRows = secondary.data.time.length;
    const secondaryDropped = droppedRows(secondary).size;
    return (
      <div className="qz-signal-note">
        Inputs: <strong>{source.name}</strong> ({sourceRows.toLocaleString()} rows; {sourceDropped.toLocaleString()} excluded or filtered) and <strong>{secondary.name}</strong> ({secondaryRows.toLocaleString()} rows; {secondaryDropped.toLocaleString()} excluded or filtered). Correlation uses finite rows in their shared X range; row exclusions and filters do not remove rows. Both sources remain linked for recalculation.
      </div>
    );
  }
  return (
    <div className="qz-signal-note">
      Scope: {sourceRows.toLocaleString()} total rows ({(sourceRows - sourceDropped).toLocaleString()} included, {sourceDropped.toLocaleString()} excluded or filtered). Signal Processing uses the full worksheet, including those {sourceDropped.toLocaleString()} rows. The output stays linked to <strong>{source.name}</strong> and can be recalculated.
    </div>
  );
}
