import { useCallback } from "react";

import { askParams } from "../../overlays/ParamDialog";
import { Button } from "../../primitives";
import type { Peak } from "../../../lib/types";
import { toast } from "../../../store/toasts";
import { useDetectedPeakPlotEdit } from "./useDetectedPeakPlotEdit";

interface Props {
  activeId: string | null;
  peaks: readonly Peak[];
  selected: ReadonlySet<number>;
  allowed: boolean;
  addPeakAt: (x: number) => void;
  removePeaks: (indices: ReadonlySet<number>) => void;
}

export default function DetectedPeakActions(props: Props) {
  const { activeId, peaks, selected, allowed, addPeakAt, removePeaks } = props;
  const removeOne = useCallback((index: number) => removePeaks(new Set([index])), [removePeaks]);
  const { editing, setEditing } = useDetectedPeakPlotEdit({
    activeId, allowed, peaks, addPeakAt, removePeak: removeOne,
  });

  const addByValue = async () => {
    const values = await askParams("Add detected peak", [
      { key: "center", label: "Approximate x position", type: "number", default: peaks[0]?.center ?? 0,
        hint: "The marker snaps to a nearby local maximum." },
    ]);
    if (!values) return;
    const center = Number(values.center);
    if (!Number.isFinite(center)) {
      toast("Peak position must be a finite number.", "danger");
      return;
    }
    addPeakAt(center);
  };

  if (!allowed) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Button size="sm" onClick={() => void addByValue()}>Add peak…</Button>
        <Button size="sm" disabled={selected.size === 0} onClick={() => removePeaks(selected)}>
          Remove selected
        </Button>
        <Button
          size="sm"
          aria-pressed={editing}
          title="Click the plot to add a peak; click an existing peak marker to remove it."
          onClick={() => setEditing(!editing)}
        >
          {editing ? "Stop plot editing" : "Edit peaks on plot"}
        </Button>
      </div>
      {editing && (
        <div className="qzk-ds-meta" style={{ color: "var(--text-faint)", marginTop: 4 }}>
          Click the plot to add a peak; click a peak marker to remove it. Press Esc to stop.
        </div>
      )}
    </div>
  );
}
