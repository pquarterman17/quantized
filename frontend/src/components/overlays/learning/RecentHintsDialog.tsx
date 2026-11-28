// Help > Recent hints: the last status messages and toasts of this session
// (store/hintLog.ts), newest first. Memory only; Clear empties it.

import { useHintLog, type HintTone } from "../../../store/hintLog";
import { Button } from "../../primitives";
import LearningModal from "./LearningModal";

const TONE: Record<HintTone, string> = { ok: "", info: "", warn: "warning", danger: "problem" };
const time = (at: number): string => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export default function RecentHintsDialog({ onClose }: { onClose: () => void }) {
  const entries = useHintLog((s) => s.entries);
  const clear = useHintLog((s) => s.clear);
  const rows = [...entries].reverse();
  return (
    <LearningModal title="Recent hints" onClose={onClose} wide footer={<Button onClick={clear} disabled={!rows.length}>Clear</Button>}>
      <p className="qzk-helptext">Status messages and notifications from this session, kept in memory only. They are gone when you quit.</p>
      {rows.length === 0 ? (
        <p className="qzk-helptext" role="status">Nothing yet. Messages appear here as the app shows them.</p>
      ) : (
        <ul aria-label="Recent hints" style={{ listStyle: "none", margin: 0, padding: 0, maxHeight: 360, overflowY: "auto" }}>
          {rows.map((e) => (
            <li key={e.id} style={{ display: "flex", gap: 10, padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-faint)", whiteSpace: "nowrap" }}>{time(e.at)}</span>
              <span style={{ flex: 1 }}>
                {TONE[e.tone] && <strong>{TONE[e.tone]}: </strong>}
                {e.text}
                {e.actions.map((a) => <span key={a} className="qzk-helptext" style={{ marginLeft: 8 }}>(offered: {a})</span>)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </LearningModal>
  );
}
