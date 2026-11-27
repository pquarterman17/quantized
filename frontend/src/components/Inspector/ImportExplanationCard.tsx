// Inspector card: how the active dataset was read in. The decisions an import
// made on the user's behalf (row-index X, text read as categories, error columns
// bound to values, what the reader skipped) outlive the toast that announced
// them. Shown only when there is something to explain. See lib/importExplanation.

import { importExplanation } from "../../lib/importExplanation";
import type { Dataset } from "../../lib/types";
import Card from "../primitives/Card";

export default function ImportExplanationCard({ active }: { active: Dataset | null }) {
  const why = active ? importExplanation(active) : null;
  if (!why) return null;
  return (
    <Card title="How this was imported" count={why.lines.length + why.notes.length} defaultOpen={false}>
      {why.lines.length > 0 && (
        <ul className="qz-import-why" style={{ margin: 0, paddingLeft: 16 }}>
          {why.lines.map((line) => <li key={line}>{line}</li>)}
        </ul>
      )}
      {why.notes.length > 0 && (
        <>
          <div className="qz-k" style={{ marginTop: 6 }}>Notes from the file reader</div>
          <ul className="qz-import-why" style={{ margin: 0, paddingLeft: 16 }}>
            {why.notes.map((note) => <li key={note}>{note}</li>)}
          </ul>
        </>
      )}
    </Card>
  );
}
