// Small, client-only datasets for the empty-Library first-run path. They are
// intentionally synthetic and visibly named as examples: loading one must
// never look like importing owner data or depend on a running backend.

import type { DataStruct } from "./types";

export type FirstRunExampleKind = "line" | "grouped" | "map";

export interface FirstRunExample {
  kind: FirstRunExampleKind;
  name: string;
  description: string;
  data: DataStruct;
  groupKey: number | null;
  stageTab: "plot" | "map";
}

function lineData(): DataStruct {
  const time = Array.from({ length: 81 }, (_, i) => i * 0.25);
  return {
    time,
    values: time.map((x) => [Math.exp(-x / 9) * Math.sin(x * 1.35)]),
    labels: ["Signal"],
    units: ["a.u."],
    metadata: { x_column_name: "Time", x_column_unit: "s", source: "Quantized example" },
  };
}

function groupedData(): DataStruct {
  const lots = ["Lot A", "Lot B", "Lot C"];
  const time: number[] = [];
  const values: number[][] = [];
  for (let lot = 0; lot < lots.length; lot++) {
    for (let wafer = 1; wafer <= 8; wafer++) {
      time.push(wafer);
      values.push([10 + lot * 2.4 + Math.sin(wafer * 0.9 + lot) * 0.8, lot]);
    }
  }
  return {
    time,
    values,
    labels: ["Thickness", "Lot"],
    units: ["nm", ""],
    metadata: { x_column_name: "Wafer", source: "Quantized example" },
    cat_levels: { 1: lots },
  };
}

function mapData(): DataStruct {
  const time: number[] = [];
  const values: number[][] = [];
  const size = 25;
  for (let yi = 0; yi < size; yi++) {
    const y = -3 + (6 * yi) / (size - 1);
    for (let xi = 0; xi < size; xi++) {
      const x = -3 + (6 * xi) / (size - 1);
      const z = Math.exp(-((x - 0.65) ** 2 / 0.7 + (y + 0.35) ** 2 / 1.4));
      time.push(time.length);
      values.push([x, y, z]);
    }
  }
  return {
    time,
    values,
    labels: ["Qx", "Qz", "Intensity"],
    units: ["1/Å", "1/Å", "a.u."],
    metadata: { is2D: true, source: "Quantized example" },
  };
}

export function makeFirstRunExample(kind: FirstRunExampleKind): FirstRunExample {
  if (kind === "grouped") {
    return {
      kind,
      name: "example-grouped-lots.csv",
      description: "Three lots grouped on one plot",
      data: groupedData(),
      groupKey: 1,
      stageTab: "plot",
    };
  }
  if (kind === "map") {
    return {
      kind,
      name: "example-2d-map.csv",
      description: "A small 2-D intensity map",
      data: mapData(),
      groupKey: null,
      stageTab: "map",
    };
  }
  return {
    kind,
    name: "example-1d-signal.csv",
    description: "A simple publication-style line plot",
    data: lineData(),
    groupKey: null,
    stageTab: "plot",
  };
}
