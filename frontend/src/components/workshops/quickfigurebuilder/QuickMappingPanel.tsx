import type { DragEvent } from "react";

import type { ErrorSide } from "../../../lib/errorRoles";
import type { QuickFigureMapping } from "../../../lib/quickFigureMapping";
import { assignmentFor, type QuickColumnAssignment } from "../../../lib/quickFigureMappingActions";
import type { DataStruct } from "../../../lib/types";

interface Props {
  data: DataStruct;
  mapping: QuickFigureMapping;
  onAssign: (channel: number, assignment: QuickColumnAssignment) => void;
  onUseAcquisitionX: () => void;
}

const dragType = "application/x-quantized-column";

function roleValue(assignment: QuickColumnAssignment): string {
  if (assignment.role !== "error") return assignment.role;
  return `error:${assignment.axis}:${assignment.target}:${assignment.side}`;
}

function parseRole(value: string): QuickColumnAssignment {
  if (!value.startsWith("error:")) return { role: value as "unassigned" | "x" | "y" | "ignore" };
  const [, axis, target, side] = value.split(":");
  return { role: "error", axis: axis as "x" | "y", target: Number(target), side: side as ErrorSide };
}

function droppedChannel(event: DragEvent): number | null {
  event.preventDefault();
  const channel = Number(event.dataTransfer.getData(dragType));
  return Number.isInteger(channel) ? channel : null;
}

export default function QuickMappingPanel({ data, mapping, onAssign, onUseAcquisitionX }: Props) {
  const assignDropped = (event: DragEvent, assignment: QuickColumnAssignment): void => {
    const channel = droppedChannel(event);
    if (channel !== null) onAssign(channel, assignment);
  };
  return (
    <>
      <div className="qzk-quick-builder-dropzones" aria-label="Column role drop zones">
        <button
          type="button"
          className={mapping.xKey === null ? "qzk-quick-builder-zone qzk-active" : "qzk-quick-builder-zone"}
          onClick={onUseAcquisitionX}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => assignDropped(event, { role: "x" })}
        >
          <span>X axis</span><strong>{mapping.xKey === null ? "Acquisition axis" : data.labels[mapping.xKey]}</strong>
        </button>
        <div
          className="qzk-quick-builder-zone"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => assignDropped(event, { role: "y" })}
        ><span>Y series</span><strong>{mapping.yKeys.length || "Drop here"}</strong></div>
        <div
          className="qzk-quick-builder-zone"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => assignDropped(event, { role: "ignore" })}
        ><span>Ignore</span><strong>{mapping.ignoredKeys.length || "Drop here"}</strong></div>
      </div>

      <ul className="qzk-quick-builder-columns">
        {data.labels.map((label, channel) => {
          const assignment = assignmentFor(mapping, channel);
          return (
            <li
              key={channel}
              draggable
              onDragStart={(event) => event.dataTransfer.setData(dragType, String(channel))}
            >
              <span><strong>{label}</strong>{data.units[channel] ? ` (${data.units[channel]})` : ""}</span>
              <select
                aria-label={`Role for ${label}`}
                value={roleValue(assignment)}
                onChange={(event) => onAssign(channel, parseRole(event.target.value))}
              >
                <option value="unassigned">Unassigned</option>
                <option value="x">X axis</option>
                <option value="y">Y series</option>
                <option value="ignore">Ignore</option>
                <option value="error:x:-1:both">X error (±)</option>
                <option value="error:x:-1:+">X error (+)</option>
                <option value="error:x:-1:-">X error (−)</option>
                {mapping.yKeys.filter((target) => target !== channel).flatMap((target) =>
                  (["both", "+", "-"] as const).map((side) => (
                    <option key={`${target}:${side}`} value={`error:y:${target}:${side}`}>
                      {`Y error ${side === "both" ? "(±)" : `(${side === "-" ? "−" : side})`} for ${data.labels[target]}`}
                    </option>
                  )),
                )}
              </select>
            </li>
          );
        })}
      </ul>
      <p className="qzk-quick-builder-help">Drag columns into X, Y, or Ignore, or use each column’s role menu. Error roles always name their target.</p>
    </>
  );
}
