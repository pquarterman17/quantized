// OK / Cancel / Apply, in Origin's order (plan item 44). Apply writes and keeps
// the popup open; OK writes and closes; Cancel closes and keeps what was
// already applied (only edits since the last Apply are dropped).

export default function ApplyButtons({
  onOk, onApply, onCancel, disabled, describedBy,
}: { onOk: () => void; onApply: () => void; onCancel: () => void; disabled?: boolean; describedBy?: string }) {
  return (
    <span style={{ display: "flex", gap: 6 }}>
      <button type="button" className="qz-btn qz-primary" onClick={onOk} disabled={disabled} aria-describedby={describedBy}>OK</button>
      <button type="button" className="qz-btn" onClick={onCancel}>Cancel</button>
      <button type="button" className="qz-btn" onClick={onApply} disabled={disabled} aria-describedby={describedBy}>Apply</button>
    </span>
  );
}
