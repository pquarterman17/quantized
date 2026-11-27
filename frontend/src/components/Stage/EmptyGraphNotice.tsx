// The stage's centred reason for a live graph that draws nothing (every curve
// unresolved). Lazy: it renders only in that rare state.

// With no `reason`, the drawn payload has no row: every row misses its X or all of its Y values
// (an all-blank X column draws nothing, and its axis has no range to show).
const NO_POINTS = "Nothing to draw: no row has both an X value and a Y value";

export default function EmptyGraphNotice({ reason = NO_POINTS }: { reason?: string }) {
  return (
    <div className="qzk-ds-meta" role="status" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none" }}>
      {reason}
    </div>
  );
}
