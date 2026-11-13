// The Map tab's centred notice when there is no map to draw: too few channels,
// or the backend refused the chosen columns (useMapPayload's `error`). Split
// out of MapStage.tsx (its .tsx line ceiling) when the second case landed.
// A refusal leaves the toolbar usable (pointer-events: none) so the user can
// pick other x, y and z columns right away.

interface Props {
  lines: string[];
  /** Let clicks through to the toolbar above (the refusal case). */
  passThrough?: boolean;
}

export default function MapStageNotice({ lines, passThrough = false }: Props) {
  return (
    <div
      className="qzk-ds-meta"
      role="status"
      style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center", padding: 24, pointerEvents: passThrough ? "none" : undefined }}
    >
      <div>
        {lines.map((line) => (
          <div key={line}>{line}</div>
        ))}
      </div>
    </div>
  );
}
