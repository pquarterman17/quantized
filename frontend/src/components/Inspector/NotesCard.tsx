// Inspector card: free-text notes about the active dataset (sample, measurement
// conditions, caveats). Held in a local draft and committed to the store on blur
// — so typing doesn't mutate the dataset on every keystroke (which would refetch
// the plot). Notes live on the Dataset object, so they round-trip through .dwk.

import { useEffect, useState } from "react";

import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import { Card } from "../primitives";

export default function NotesCard({ active }: { active: Dataset | null }) {
  const setDatasetNotes = useApp((s) => s.setDatasetNotes);
  const [draft, setDraft] = useState(active?.notes ?? "");

  // Resync the draft when the active dataset changes (id-keyed so an edit to the
  // current dataset's notes elsewhere doesn't clobber an in-progress edit).
  useEffect(() => {
    setDraft(active?.notes ?? "");
  }, [active?.id]);

  if (!active) return null;

  return (
    <Card title="Notes" count={active.notes ? 1 : undefined} defaultOpen={false}>
      <textarea
        className="qz-input"
        style={{ width: "100%", minHeight: 64, resize: "vertical", fontFamily: "inherit" }}
        placeholder="Notes about this dataset — sample, conditions, caveats…"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => setDatasetNotes(active.id, draft)}
      />
    </Card>
  );
}
