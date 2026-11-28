// Fit Y by X — the one-line stand-in for an optional sub-test section (Levene,
// Tukey, test chooser, Fisher) whose request failed, so the section never just
// vanishes (silent-failure audit 2026-10-01). Renders nothing without a reason.
//
// A too-small group (acceptance pass 15 U6: a level with one row) is the user's data, not a fault, so that refusal
// is explained instead of echoed raw.
const TOO_FEW = /every group needs at least (\d+) (?:finite )?observations/;

export default function SubtestFailedNote({ test, reason }: { test: string; reason: string | undefined }) {
  if (reason === undefined) return null;
  const few = TOO_FEW.exec(reason);
  return (
    <div className="qzk-ds-meta" role="note" style={{ marginTop: 10, color: "var(--warn)" }}>
      {few
        ? `${test} not run: every group needs at least ${few[1]} observations, and one group has fewer (see n in the group table). Exclude or merge that level to run it.`
        : `${test} failed: ${reason}`}
    </div>
  );
}
