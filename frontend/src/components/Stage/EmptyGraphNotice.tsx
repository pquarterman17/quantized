// The stage's centred reason for a live graph that draws nothing (every curve
// unresolved). Lazy: it renders only in that rare state.

export default function EmptyGraphNotice({ reason }: { reason: string }) {
  return (
    <div className="qzk-ds-meta" role="status" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none" }}>
      {reason}
    </div>
  );
}
