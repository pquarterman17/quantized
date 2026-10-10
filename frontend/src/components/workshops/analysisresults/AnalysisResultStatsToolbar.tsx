import type { AnalysisResult } from "../../../lib/analysisResult";
import type { Dataset } from "../../../lib/types";
import { Button } from "../../primitives";

export default function AnalysisResultStatsToolbar({ result, source, recipeReady, outdated, busy, onOpen, onEdit, onDuplicate, onReport }: {
  result: AnalysisResult;
  source: Dataset | undefined;
  recipeReady: boolean;
  outdated: boolean;
  busy: string | null;
  onOpen: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onReport: () => void;
}) {
  const sourceMissing = result.sources.length > 0 && !source;
  return <>
    {result.sources.length > 0 && <Button disabled={sourceMissing || busy !== null} onClick={onOpen}>Open data</Button>}
    <Button disabled={!recipeReady || outdated || sourceMissing || busy !== null}
      title={outdated ? "The source changed; start a new test from the current data instead." : !recipeReady ? "This result does not contain a compatible saved question." : undefined}
      onClick={onEdit}>Edit / rerun…</Button>
    <Button disabled={!result.tables?.length || busy !== null} onClick={onDuplicate}>{busy === "duplicate" ? "Duplicating…" : "Duplicate"}</Button>
    <Button disabled={!result.tables?.length || outdated || busy !== null}
      title={outdated ? "Run the test again before adding these values to a report." : undefined}
      onClick={onReport}>{busy === "report" ? "Adding…" : "Send to report"}</Button>
  </>;
}
