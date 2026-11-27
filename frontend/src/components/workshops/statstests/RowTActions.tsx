// Statistical tests: the row-wise t-test "Add as worksheet" button
// (useRowTCommit). Rendered only for a row-wise result.

import { Button } from "../../primitives";
import { commitRowTRun, type RowTRun } from "./useRowTCommit";

export default function RowTActions({ run, stale }: { run: RowTRun | null; stale: boolean }) {
  const why = !run ? "Run the row-wise t-tests first: there is no current result to add."
    : stale ? "Out of date: the source rows changed after this result was computed. Run the test again." : null;
  return (
    <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
      <Button size="sm" disabled={!!why} title={why ?? "Write one row per tested row (n, means, difference, SE, t, df, p, CI) to a new worksheet linked to this source."}
        onClick={() => run && commitRowTRun(run)}>
        Add as worksheet
      </Button>
    </div>
  );
}
