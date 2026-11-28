// The Clustering result as a result book (the Time series pattern, RB3 shell):
// the same header and table actions as the saved book. Sections in the book's
// one order: the summary (the tool's readout and dendrogram), then the tables
// the save writes (collapsed: the summary shows the key numbers). Save result
// is explicit; nothing is saved on the user's behalf.

import { clusterResultTables, CLUSTER_TOOL_LABEL } from "../../../../lib/clusterAnalysisResult";
import { Button } from "../../../primitives";
import BookTable, { LIVE_REST } from "../../resultbook/BookTable";
import ResultBookShell, { type ResultBookSectionSpec } from "../../resultbook/ResultBookShell";
import { OpenSavedResultButton, ToolTableActions } from "../../resultbook/ToolBookActions";
import ClusterResults from "./ClusterResults";
import type { ClusterState } from "./useCluster";

export default function ClusterResultBook({ x }: { x: ClusterState }) {
  const { result, meta, bridge } = x;
  if (!result || !meta) return null;
  const { book } = bridge;
  const titles = clusterResultTables({ run: result, sourceRows: meta.sourceRows, dropped: meta.dropped, columns: meta.columns, startCentres: meta.startCentres })
    .map((t) => t.title ?? "");
  const sections: ResultBookSectionSpec[] = [
    { key: "summary", kind: "summary", title: "Summary", render: () => <ClusterResults result={result} meta={meta} /> },
    ...titles.map((title): ResultBookSectionSpec => ({
      key: `table:${title}`, kind: "table", title, startCollapsed: true,
      actions: <ToolTableActions book={book} title={title} />,
      render: () => {
        const table = book.liveTable(title);
        return table ? <BookTable table={table} restNote={LIVE_REST} /> : null;
      },
    })),
  ];
  return (
    <div style={{ marginTop: 12 }}>
      <ResultBookShell method={`Clustering: ${CLUSTER_TOOL_LABEL[result.tool]}`} status={book.saved ? "Saved" : "Not saved"} initialOpen="all"
        meta={`${meta.columns.length} columns, ${meta.sourceRows.length} rows`}
        tools={<>
          <Button size="sm" disabled={!bridge.canSaveResult} title={bridge.saveResultDisabledReason ?? undefined} onClick={() => bridge.saveResult()}>Save result</Button>
          <OpenSavedResultButton book={book} />
        </>}
        sections={sections} />
    </div>
  );
}
