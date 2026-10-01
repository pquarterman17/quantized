// Fit Y by X — the one-line stand-in for an optional sub-test section (Levene,
// Tukey, test chooser, Fisher) whose request failed, so the section never just
// vanishes (silent-failure audit 2026-10-01). Renders nothing without a reason.

export default function SubtestFailedNote({ test, reason }: { test: string; reason: string | undefined }) {
  if (reason === undefined) return null;
  return (
    <div className="qzk-ds-meta" role="note" style={{ marginTop: 10, color: "var(--warn)" }}>
      {`${test} failed: ${reason}`}
    </div>
  );
}
