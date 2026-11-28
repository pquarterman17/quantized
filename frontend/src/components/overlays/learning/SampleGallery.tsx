// Help > Sample gallery: a few ready-made graphs, each with its worksheet,
// opened with one click through store/learningSamples.ts (the app's own
// actions, one undo step). Data is generated, nothing is downloaded.

import { useState } from "react";

import { SAMPLES, openSample } from "../../../store/learningSamples";
import { Button } from "../../primitives";
import LearningModal from "./LearningModal";

export default function SampleGallery({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = async (id: string) => {
    setBusy(id);
    setError(null);
    const r = await openSample(id);
    setBusy(null);
    if (r.ok) onClose();
    else setError(r.reason);
  };
  return (
    <LearningModal title="Sample gallery" onClose={onClose} wide>
      <p className="qzk-helptext">Each sample opens as a new worksheet with its graph. Edit and export them like your own data; Edit ▸ Undo removes the sample.</p>
      <ul aria-label="Samples" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {SAMPLES.map((s) => (
          <li key={s.id} className="qzk-glass" style={{ padding: 10, display: "flex", flexDirection: "column", gap: 4 }}>
            <strong>{s.title}</strong>
            <span className="qzk-helptext">{s.blurb}</span>
            <span className="qzk-helptext">{s.how}</span>
            <Button aria-label={`Open ${s.title}`} disabled={busy !== null} onClick={() => void open(s.id)}>{busy === s.id ? "Opening…" : "Open"}</Button>
          </li>
        ))}
      </ul>
      {error && <p role="alert" style={{ color: "var(--danger)" }}>{error}</p>}
    </LearningModal>
  );
}
