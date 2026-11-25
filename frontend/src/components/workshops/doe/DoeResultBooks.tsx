// The DOE results as result books (owner decision 2026-11-25, the RB3 shell):
// the generated design (its summary, factors, aliases, model terms and runs)
// and the two-level effects analysis. Tables start collapsed: the workshop
// already shows the design and the effects above them.

import type { ReactNode } from "react";

import type { DoeEffectsResponse } from "../../../lib/api/doe";
import type { DoeMeta } from "../../../lib/doe";
import type { Dataset } from "../../../lib/types";
import { Button } from "../../primitives";
import BookTable, { LIVE_REST } from "../resultbook/BookTable";
import ResultBookShell, { type ResultBookSectionSpec } from "../resultbook/ResultBookShell";
import { OpenSavedResultButton, ToolTableActions } from "../resultbook/ToolBookActions";
import { useDoeDesignBook, useDoeEffectsBook, type GeneratedDesign, type ToolSave } from "./useDoeResultBridge";

function Book({ method, s, summary }: { method: string; s: ToolSave; summary?: () => ReactNode }) {
  const { book } = s;
  const titles = book.liveTables()?.map((t) => t.title ?? "") ?? [];
  const sections: ResultBookSectionSpec[] = [
    ...(summary ? [{ key: "summary", kind: "summary" as const, title: "Summary", render: summary }] : []),
    ...titles.map((title): ResultBookSectionSpec => ({
      key: `table:${title}`, kind: "table", title, startCollapsed: true,
      actions: <ToolTableActions book={book} title={title} />,
      render: () => {
        const found = book.liveTable(title);
        return found ? <BookTable table={found} restNote={LIVE_REST} /> : null;
      },
    })),
  ];
  return <ResultBookShell method={method} status={book.saved ? "Saved" : "Not saved"} initialOpen="all" label={method}
    tools={<>
      <Button size="sm" disabled={!s.canSave} title={s.saveBlocked ?? undefined} onClick={s.save}>Save result</Button>
      <OpenSavedResultButton book={book} />
    </>}
    sections={sections} />;
}

export function DoeDesignBook({ active, meta, generated }: { active: Dataset; meta: DoeMeta; generated: GeneratedDesign | null }) {
  const s = useDoeDesignBook(active, meta, generated);
  return <div style={{ marginTop: 10 }}><Book method="Design result" s={s} /></div>;
}

export function DoeEffectsBook({ active, meta, out, children }: { active: Dataset; meta: DoeMeta; out: DoeEffectsResponse; children: ReactNode }) {
  const s = useDoeEffectsBook(active, meta, out);
  return <Book method="Effects result" s={s} summary={() => children} />;
}
