// The marker-shape pickers' labelled list, moved verbatim out of
// lib/markers.ts in bundle diet slice 24: only the lazy Inspector style card
// and plot menu read it, so it ships with them instead of in the eager
// bundle. Import it by this path; markers.ts does not re-export it
// (architecture.test.ts, DRAGGED_OUT).
import type { MarkerShape } from "./types";

export const MARKER_SHAPES: { value: MarkerShape; label: string }[] = [
  { value: "circle", label: "● circle" },
  { value: "square", label: "■ square" },
  { value: "triangle", label: "▲ triangle" },
  { value: "downtriangle", label: "▼ triangle (down)" },
  { value: "diamond", label: "◆ diamond" },
  { value: "plus", label: "+ plus" },
  { value: "cross", label: "✕ cross" },
  { value: "star", label: "✳ asterisk" },
];
