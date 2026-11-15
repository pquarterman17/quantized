// The header's "hidden columns" marker: a thin accent stripe on the right edge of
// the shown column that precedes a run of hidden ones (Excel's double line). It
// is deliberately NOT a pill over the header text, where a stray click would
// un-hide instead of selecting the column; click it to show the run.

export default function HiddenColumnsMarker({
  run,
  after,
  labels,
  onShow,
}: {
  run: readonly number[] | undefined;
  /** The shown column before the run (its label). */
  after: string;
  labels: readonly string[];
  onShow?: (cols: number[]) => void;
}) {
  if (!run?.length) return null;
  const names = run.map((c) => labels[c] ?? String(c)).join(", ");
  return (
    <button
      className="qzk-col-hidden"
      aria-label={`${run.length} hidden column${run.length === 1 ? "" : "s"} after ${after}: ${names}. Show`}
      title={`Hidden: ${names} — click to show`}
      onClick={(e) => {
        e.stopPropagation();
        onShow?.([...run]);
      }}
    />
  );
}
