// The profile as a result book (owner decision 2026-11-25, the RB3 shell):
// Save result against the saved Fit Model result, Open saved result, and the
// saved tables (current prediction, factor settings, one trace per factor)
// with the book's table actions. Collapsed: the profiler above is the view.

import { Button } from "../../primitives";
import BookTable, { LIVE_REST } from "../resultbook/BookTable";
import ResultBookShell, { type ResultBookSectionSpec } from "../resultbook/ResultBookShell";
import { OpenSavedResultButton, ToolTableActions } from "../resultbook/ToolBookActions";
import type { ProfilerState } from "./useProfiler";

export default function ProfilerResultBook({ p }: { p: ProfilerState }) {
  const { book } = p;
  const titles = book.liveTables()?.map((t) => t.title ?? "") ?? [];
  const sections = titles.map((title): ResultBookSectionSpec => ({
    key: `table:${title}`, kind: "table", title, startCollapsed: true,
    actions: <ToolTableActions book={book} title={title} />,
    render: () => {
      const found = book.liveTable(title);
      return found ? <BookTable table={found} restNote={LIVE_REST} /> : null;
    },
  }));
  return <div style={{ marginTop: 12 }}>
    <ResultBookShell method="Profile result" status={book.saved ? "Saved" : "Not saved"} initialOpen="all" label="Profile result"
      tools={<>
        <Button size="sm" disabled={!p.canSaveResult} title={p.saveResultDisabledReason ?? undefined} onClick={p.saveResult}>Save result</Button>
        <OpenSavedResultButton book={book} />
      </>}
      sections={sections} empty={<p className="qz-analysis-empty">The tables appear once the profile is evaluated.</p>} />
  </div>;
}
