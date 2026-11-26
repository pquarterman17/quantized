// The map card's provenance note: a dataset that Map gridding produced says how it
// was made (method, grid size), so the card's own Grid method / Resolution, which
// only set how a scattered dataset is drawn, are not mistaken for it. Lazy: it is
// the only reader of the dataset's `map_op` record. Renders nothing for any other map.
import { useApp } from "../../store/useApp";
import { METHOD_OPTIONS } from "../workshops/mapgrid/mapGridForm";

export default function MapProvenance({ datasetId }: { datasetId?: string }) {
  const op = useApp((s) => {
    const d = s.datasets.find((x) => x.id === (datasetId ?? s.activeId));
    return d?.data.metadata?.map_op as Record<string, unknown> | undefined;
  });
  if (op?.op !== "grid_xyz") return null;
  const method = METHOD_OPTIONS.find((m) => m.value === op.method)?.label ?? String(op.method);
  const size = typeof op.nx === "number" && typeof op.ny === "number" ? `, ${op.nx} × ${op.ny} cells` : "";
  return (
    <p className="qzk-field-lbl" role="note" aria-label="Map provenance" style={{ margin: "0 0 8px" }}>
      Made by Map gridding: {method}
      {size}. The settings below only change how the map is drawn on screen.
    </p>
  );
}
